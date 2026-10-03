"""A bounded, flat catalog of named paragraph styles for the editor."""
from copy import deepcopy
import hashlib
import math
import re

from docx.enum.style import WD_STYLE_TYPE
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

FONTS = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas',
         'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana']
BASE = dict(fontFamily='Calibri', fontSize=12, color='#17202A', bold=False, italic=False,
            textAlign='left', indent=0, spaceBefore=0, spaceAfter=8, lineSpacing=1.15, level=0)
DEFAULT_STYLES = [
    dict(BASE, id='normal', name='Normal'),
    dict(BASE, id='heading-1', name='Heading 1', level=1, fontSize=20, color='#2F5496', bold=True, spaceBefore=12),
    dict(BASE, id='heading-2', name='Heading 2', level=2, fontSize=16, color='#2F5496', bold=True, spaceBefore=10),
    dict(BASE, id='heading-3', name='Heading 3', level=3, fontSize=14, color='#2F5496', bold=True, spaceBefore=8),
    dict(BASE, id='title', name='Title', fontSize=28, spaceAfter=12),
    dict(BASE, id='subtitle', name='Subtitle', fontSize=16, color='#667182', spaceAfter=12),
    dict(BASE, id='quote', name='Quote', italic=True, color='#526079', indent=1, spaceBefore=8),
    dict(BASE, id='no-spacing', name='No Spacing', spaceAfter=0, lineSpacing=1),
]
BUILTINS = {item['id']: item for item in DEFAULT_STYLES}
ALIGNMENTS = {'left': WD_ALIGN_PARAGRAPH.LEFT, 'center': WD_ALIGN_PARAGRAPH.CENTER,
              'right': WD_ALIGN_PARAGRAPH.RIGHT, 'justify': WD_ALIGN_PARAGRAPH.JUSTIFY}
STYLE_ID = re.compile(r'[a-z][a-z0-9-]{0,63}')
LIMITS = {'fontSize': (6, 96), 'indent': (0, 6), 'spaceBefore': (0, 72), 'spaceAfter': (0, 72), 'lineSpacing': (1, 3), 'level': (0, 3)}


def style_catalog(model):
    attrs = model.get('attrs') or {}
    if not isinstance(attrs, dict): raise ValueError('Invalid document attributes.')
    values = attrs.get('styles', [])
    if not isinstance(values, list) or len(values) > 40: raise ValueError('A document supports eight built-in and 32 custom paragraph styles.')
    catalog, ids = deepcopy(BUILTINS), set()
    for value in values:
        if not isinstance(value, dict): raise ValueError('Invalid paragraph style.')
        sid, name = value.get('id'), value.get('name')
        if not isinstance(sid, str) or not STYLE_ID.fullmatch(sid) or sid in ids: raise ValueError('Paragraph styles require unique supported identifiers.')
        if not isinstance(name, str) or not 1 <= len(name) <= 60 or name != name.strip() or re.search(r'[\x00-\x1f]', name): raise ValueError('Style names must contain 1–60 characters.')
        spec = {**BASE, **value}
        for key, (low, high) in LIMITS.items():
            n = spec[key]
            if isinstance(n, bool) or not isinstance(n, (int, float)) or not math.isfinite(n) or not low <= n <= high or (key == 'level' and not isinstance(n, int)):
                raise ValueError('Invalid paragraph style measurement.')
        if spec['fontFamily'] not in FONTS or spec['textAlign'] not in tuple(ALIGNMENTS): raise ValueError('Invalid paragraph style font or alignment.')
        if not isinstance(spec['color'], str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', spec['color']): raise ValueError('Style colors must use six-digit hexadecimal notation.')
        if not isinstance(spec['bold'], bool) or not isinstance(spec['italic'], bool): raise ValueError('Style emphasis must be true or false.')
        if sid in BUILTINS and (name != BUILTINS[sid]['name'] or spec['level'] != BUILTINS[sid]['level']): raise ValueError('Built-in style names and heading levels cannot change.')
        ids.add(sid); catalog[sid] = spec
    if len(catalog) > 40 or len({spec['name'].casefold() for spec in catalog.values()}) != len(catalog):
        raise ValueError('Use unique style names and no more than 32 custom styles.')
    return catalog


def write_styles(document, catalog):
    result = {}
    for sid, spec in catalog.items():
        if sid in BUILTINS:
            style = document.styles[spec['name']]
        else:
            # Stable IDs keep same-name template styles from stealing references.
            style = document.styles.add_style('LAW5_' + sid, WD_STYLE_TYPE.PARAGRAPH)
            style.style_id, style.name = 'LAW5_' + sid, spec['name']
        style.base_style = None if sid == 'normal' else document.styles['Normal']
        style.quick_style = True
        style.next_paragraph_style = document.styles['Normal'] if spec['level'] or sid in ('title', 'subtitle') else style
        style.font.name, style.font.size = spec['fontFamily'], Pt(spec['fontSize'])
        for fonts in style.element.xpath('./w:rPr/w:rFonts'):
            for key in ('asciiTheme', 'hAnsiTheme', 'eastAsiaTheme', 'cstheme'):
                fonts.attrib.pop(qn('w:' + key), None)
        style.font.color.rgb = RGBColor.from_string(spec['color'][1:])
        style.font.bold, style.font.italic = spec['bold'], spec['italic']
        fmt = style.paragraph_format
        fmt.alignment, fmt.left_indent = ALIGNMENTS[spec['textAlign']], Inches(spec['indent'] * .25)
        fmt.space_before, fmt.space_after, fmt.line_spacing = Pt(spec['spaceBefore']), Pt(spec['spaceAfter']), spec['lineSpacing']
        props = style.element.get_or_add_pPr()
        for old in props.findall(qn('w:outlineLvl')): props.remove(old)
        outline = OxmlElement('w:outlineLvl'); outline.set(qn('w:val'), str(spec['level'] - 1 if spec['level'] else 9)); props.append(outline)
        if spec['level']:
            fmt.keep_with_next, fmt.keep_together = True, True
        result[sid] = style
    return result


class StyleReader:
    """Resolve used paragraph styles, flattening their supported inheritance."""
    def __init__(self, document, warn):
        self.document, self.warn = document, warn
        self.catalog, self.source_ids = deepcopy(BUILTINS), {}
        for spec in DEFAULT_STYLES:
            try: source = document.styles[spec['name']]
            except KeyError: continue
            if source.type == WD_STYLE_TYPE.PARAGRAPH: self.read(source, spec['id'])
        # Keep authored custom styles even when no paragraph currently uses them.
        for style in document.styles:
            if style.type == WD_STYLE_TYPE.PARAGRAPH and style.style_id.startswith('LAW5_'): self.read(style)

    def read(self, source, builtin_id=None):
        if source is None: return self.catalog['normal']
        if source.style_id in self.source_ids: return self.catalog[self.source_ids[source.style_id]]
        own_id = source.style_id.removeprefix('LAW5_')
        sid = builtin_id or (own_id if source.style_id.startswith('LAW5_') and STYLE_ID.fullmatch(own_id) and own_id not in BUILTINS else 'imported-' + hashlib.sha256(source.style_id.encode()).hexdigest()[:16])
        if sid not in self.catalog and len(self.catalog) >= 40: raise ValueError('This document uses more than 32 custom paragraph styles.')
        seed = deepcopy(BUILTINS.get(sid, BASE))
        chain, visited, current = [], set(), source
        while current is not None and current.style_id not in visited and len(chain) < 64:
            chain.append(current); visited.add(current.style_id); current = current.base_style
        if current is not None: self.warn('A cyclic or unusually deep style chain was truncated.')
        def inherited(group, attribute, fallback):
            for ancestor in chain:
                value = getattr(getattr(ancestor, group), attribute)
                if value is not None: return value
            return fallback
        def bounded(key, value):
            low, high = LIMITS[key]
            safe = min(high, max(low, value))
            if safe != value: self.warn('Some paragraph style measurements were adjusted to the supported range.')
            return safe
        family = inherited('font', 'name', seed['fontFamily'])
        if family not in FONTS:
            family = seed['fontFamily']; self.warn('Some style fonts are unavailable in the ribbon and use a supported default.')
        seed['fontFamily'] = family
        size = inherited('font', 'size', None)
        if size is not None: seed['fontSize'] = bounded('fontSize', size.pt)
        for key in ('bold', 'italic'): seed[key] = bool(inherited('font', key, seed[key]))
        for ancestor in chain:
            if ancestor.font.color.rgb is not None:
                seed['color'] = '#' + str(ancestor.font.color.rgb); break
        if any(ancestor.element.xpath('./w:rPr/w:rFonts[@w:asciiTheme or @w:hAnsiTheme] | ./w:rPr/w:color[@w:themeColor]') for ancestor in chain):
            self.warn('Theme-based style fonts and colors use available direct values or editor defaults; document themes are not imported.')
        alignment = inherited('paragraph_format', 'alignment', None)
        seed['textAlign'] = next((key for key, value in ALIGNMENTS.items() if value == alignment), seed['textAlign'])
        for key, attribute, unit in [('indent', 'left_indent', 'inches'), ('spaceBefore', 'space_before', 'pt'), ('spaceAfter', 'space_after', 'pt')]:
            measurement = inherited('paragraph_format', attribute, None)
            if measurement is not None: seed[key] = bounded(key, getattr(measurement, unit) * (4 if key == 'indent' else 1))
        spacing = inherited('paragraph_format', 'line_spacing', None)
        if isinstance(spacing, float): seed['lineSpacing'] = bounded('lineSpacing', spacing)
        elif spacing is not None: self.warn('Fixed or minimum line spacing in styles was approximated with multiple-line spacing.')
        level = seed['level']
        if sid not in BUILTINS:
            for ancestor in chain:
                nodes = ancestor.element.xpath('./w:pPr/w:outlineLvl')
                if nodes:
                    raw = int(nodes[0].get(qn('w:val'), '9'))
                    level = min(3, max(0, raw + 1)) if raw < 9 else 0
                    if 3 <= raw < 9: self.warn('Heading styles deeper than level 3 were reduced to level 3.')
                    break
        name = BUILTINS[sid]['name'] if sid in BUILTINS else re.sub(r'[\x00-\x1f]', '', source.name or 'Imported style').strip()[:60] or 'Imported style'
        original, suffix = name, 2
        while any(spec['name'].casefold() == name.casefold() for key, spec in self.catalog.items() if key != sid):
            name = original[:54] + f' ({suffix})'; suffix += 1
        if name != (source.name or ''): self.warn('Some imported style names were normalized to unique supported names.')
        seed.update(id=sid, name=name, level=level)
        self.catalog[sid], self.source_ids[source.style_id] = seed, sid
        return seed
