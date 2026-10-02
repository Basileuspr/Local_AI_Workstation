"""DOCX import/model/export. Only editable runs in document.xml are rewritten.

Other ZIP members are copied byte-for-byte (uncompressed); nothing is extracted
or executed. Unsupported paragraph children remain in their original XML tree.
"""
from copy import deepcopy
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import tempfile
import zipfile

from lxml import etree as ET

NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{' + NS['w'] + '}'
MAX_BYTES = 64 * 1024**2
MAX_EXPANDED = 128 * 1024**2


def digest(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def read_package(path):
    if Path(path).stat().st_size > MAX_BYTES:
        raise ValueError('DOCX files must be 64 MiB or smaller.')
    try:
        with zipfile.ZipFile(path) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries]
            if len(entries) > 4096 or len(set(names)) != len(names) or sum(e.file_size for e in entries) > MAX_EXPANDED:
                raise ValueError('Document package exceeds safe complexity or size limits.')
            for entry in entries:
                parts = PurePosixPath(entry.filename).parts
                if entry.flag_bits & 1 or '\\' in entry.filename or ':' in entry.filename or '..' in parts or entry.filename.startswith('/'):
                    raise ValueError('Unsafe or encrypted document package.')
            members = [(entry, archive.read(entry)) for entry in entries]
        raw = dict((entry.filename, content) for entry, content in members)
        if 'word/document.xml' not in raw or '[Content_Types].xml' not in raw:
            raise ValueError('This package is not a supported Word DOCX document.')
        xml = raw['word/document.xml']
        if len(xml) > 16 * 1024**2:
            raise ValueError('Document XML exceeds the 16 MiB editing limit.')
        root = ET.fromstring(xml, ET.XMLParser(resolve_entities=False, load_dtd=False, no_network=True))
        if root.getroottree().docinfo.doctype or root.tag != W + 'document':
            raise ValueError('Document DTDs and nonstandard Word XML are unsupported.')
        return members, root
    except (zipfile.BadZipFile, KeyError, ET.XMLSyntaxError, RuntimeError) as exc:
        raise ValueError('The DOCX container or document XML is damaged or unsupported.') from exc


class Document:
    def __init__(self, path):
        self.path = Path(path)
        self.fingerprint = digest(path)
        self.members, self.root = read_package(path)
        self.runs = {}
        self.blocks = []
        self.warnings = ['Layout and inherited styles are preserved but this editor is not a page-layout preview. Make a copy with Save As for important documents.']
        body = self.root.find('w:body', NS)
        if body is None:
            raise ValueError('Document body is missing.')
        if len(body) > 2000 or len(body.findall('.//w:tc', NS)) > 2000 or len(body.findall('.//w:r', NS)) > 10000:
            raise ValueError('Document exceeds the initial editor limits (2,000 blocks/cells or 10,000 text runs).')
        names = [entry.filename.lower() for entry, _ in self.members]
        if any('_xmlsignatures/' in name for name in names):
            self.warnings.append('This document has digital signatures. Saving edits invalidates those signatures; use Save As and re-sign in your document application if needed.')
        if any(any(part in name for part in ('vba', 'embeddings/', 'comments', 'header', 'footer')) for name in names):
            self.warnings.append('Macros, embedded objects, comments, headers or footers are retained but cannot be edited or executed here.')
        if self.root.xpath('.//w:ins | .//w:del | .//w:drawing | .//w:pict | .//w:fldChar | .//w:hyperlink | .//w:sdt', namespaces=NS):
            self.warnings.append('Tracked changes, drawings, fields, hyperlinks or content controls are preserved as protected content. Their text may be omitted from the editing controls.')
        for child in body:
            if child.tag == W + 'p':
                self.blocks.append(self.paragraph(child))
            elif child.tag == W + 'tbl':
                complex_table = bool(child.xpath('.//w:gridSpan | .//w:vMerge | .//w:tbl/w:tr/w:tc/w:tbl', namespaces=NS))
                if complex_table:
                    self.warnings.append('Merged or nested tables are shown read-only and preserved.')
                rows = [[{'paragraphs': [self.paragraph(p, not complex_table) for p in cell.findall('w:p', NS)]}
                         for cell in row.findall('w:tc', NS)] for row in child.findall('w:tr', NS)]
                self.blocks.append({'type': 'table', 'rows': rows, 'editable': not complex_table})
            elif child.tag != W + 'sectPr':
                self.blocks.append({'type': 'protected', 'text': 'Unsupported document structure preserved.'})
        if len(self.runs) > 10000 or len(self.blocks) > 2000:
            raise ValueError('This document is too large for the initial editor (2,000 blocks / 10,000 runs).')

    def paragraph(self, paragraph, editable=True):
        style = paragraph.find('w:pPr/w:pStyle', NS)
        if editable and all(child.tag == W + 'pPr' for child in paragraph):
            # An empty paragraph/table cell still needs an editable text run.
            ET.SubElement(ET.SubElement(paragraph, W + 'r'), W + 't')
        runs = []
        for child in paragraph:
            if child.tag == W + 'pPr':
                continue
            safe = editable and child.tag == W + 'r' and all(c.tag in {W + 'rPr', W + 't'} for c in child)
            text = ''.join(child.itertext()) if child.tag == W + 'r' else ''.join(child.xpath('.//w:t/text()', namespaces=NS))
            # Preserve line breaks/tabs and field/drawing runs as protected elements.
            if not safe:
                runs.append({'text': text or '[Protected content]', 'editable': False})
                continue
            identifier = str(len(self.runs))
            self.runs[identifier] = child
            def enabled(name):
                flag = child.find('w:rPr/w:' + name, NS)
                return flag is not None and flag.get(W + 'val', 'true') not in {'0', 'false', 'off'}
            runs.append({'id': identifier, 'text': text, 'bold': enabled('b'), 'italic': enabled('i'), 'editable': True})
        return {'type': 'paragraph', 'style': style.get(W + 'val') if style is not None else 'Normal', 'runs': runs}

    def model(self):
        return {'name': self.path.name, 'blocks': self.blocks, 'warnings': list(dict.fromkeys(self.warnings)),
                'read_only': not bool(self.path.stat().st_mode & stat.S_IWRITE)}

    def save(self, target, changes, expected_target, acknowledged=False):
        target = Path(target)
        if target.suffix.lower() != '.docx':
            raise ValueError('Save documents with a .docx extension.')
        if not acknowledged:
            raise ValueError('Review and acknowledge the preservation warning before saving.')
        if len(changes) > 10000 or sum(len(str(change.get('text', ''))) for change in changes) > 8 * 1024**2:
            raise ValueError('Document edits exceed the supported limit.')
        if target.exists() and not target.stat().st_mode & stat.S_IWRITE:
            raise ValueError('The destination is read-only. Use Save As to choose a writable copy.')
        original = target.resolve() == self.path.resolve()
        expected = self.fingerprint if original else expected_target
        def check_target():
            actual = digest(target) if target.exists() else None
            if actual != expected:
                raise ValueError('The destination changed since it was opened or selected. Reopen it or choose another Save As destination; your edits are still available.')
        check_target()
        root = deepcopy(self.root)
        seen = set()
        for change in changes:
            identifier = change.get('id')
            if identifier not in self.runs or identifier in seen or not isinstance(change.get('text'), str):
                raise ValueError('Invalid document edit.')
            seen.add(identifier)
            source = self.runs[identifier]
            # Match element positions rather than relying on original namespace prefixes.
            positions = []
            node = source
            while node.getparent() is not None:
                positions.append(node.getparent().index(node)); node = node.getparent()
            run = root
            for position in reversed(positions): run = run[position]
            for child in list(run):
                if child.tag == W + 't': run.remove(child)
            node = ET.SubElement(run, W + 't')
            node.set('{http://www.w3.org/XML/1998/namespace}space', 'preserve')
            node.text = change['text']
            props = run.find('w:rPr', NS)
            if props is None:
                props = ET.Element(W + 'rPr'); run.insert(0, props)
            for field, tag in [('bold', 'b'), ('italic', 'i')]:
                if not isinstance(change.get(field), bool): raise ValueError('Invalid text formatting.')
                old = source.find('w:rPr/w:' + tag, NS)
                old_enabled = old is not None and old.get(W + 'val', 'true') not in {'0', 'false', 'off'}
                if change[field] == old_enabled: continue
                flag = props.find(W + tag)
                if flag is None:
                    # Word's run properties have a schema order: insert emphasis
                    # ahead of color/size/etc., retaining all existing properties.
                    predecessors = {W + 'rStyle', W + 'rFonts'}
                    if tag == 'i': predecessors.update({W + 'b', W + 'bCs'})
                    position = next((i for i, child in enumerate(props) if child.tag not in predecessors), len(props))
                    flag = ET.Element(W + tag); props.insert(position, flag)
                flag.set(W + 'val', '1' if change[field] else '0')
        xml = ET.tostring(root, xml_declaration=True, encoding='UTF-8', standalone=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix='.law-docx-', suffix='.tmp', dir=target.parent, delete=False) as handle:
                temporary = Path(handle.name)
            with zipfile.ZipFile(temporary, 'w') as archive:
                for entry, content in self.members:
                    archive.writestr(entry, xml if entry.filename == 'word/document.xml' else content)
            read_package(temporary)
            with temporary.open('r+b') as handle: os.fsync(handle.fileno())
            check_target()
            os.replace(temporary, target)
        except PermissionError as exc:
            raise ValueError('Cannot replace this document. It may be read-only or open in another application. Use Save As.') from exc
        finally:
            if temporary is not None: temporary.unlink(missing_ok=True)
        self.__init__(target)
        return self.model()
