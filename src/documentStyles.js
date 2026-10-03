import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const DOCUMENT_FONTS = ['Aptos', 'Arial', 'Calibri', 'Cambria', 'Comic Sans MS', 'Consolas', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const base = { fontFamily: 'Calibri', fontSize: 12, color: '#17202A', bold: false, italic: false, textAlign: 'left', indent: 0, spaceBefore: 0, spaceAfter: 8, lineSpacing: 1.15, level: 0 };
export const DEFAULT_STYLES = [
  { ...base, id: 'normal', name: 'Normal' },
  { ...base, id: 'heading-1', name: 'Heading 1', level: 1, fontSize: 20, color: '#2F5496', bold: true, spaceBefore: 12 },
  { ...base, id: 'heading-2', name: 'Heading 2', level: 2, fontSize: 16, color: '#2F5496', bold: true, spaceBefore: 10 },
  { ...base, id: 'heading-3', name: 'Heading 3', level: 3, fontSize: 14, color: '#2F5496', bold: true, spaceBefore: 8 },
  { ...base, id: 'title', name: 'Title', fontSize: 28, spaceAfter: 12 },
  { ...base, id: 'subtitle', name: 'Subtitle', fontSize: 16, color: '#667182', spaceAfter: 12 },
  { ...base, id: 'quote', name: 'Quote', italic: true, color: '#526079', indent: 1, spaceBefore: 8 },
  { ...base, id: 'no-spacing', name: 'No Spacing', spaceAfter: 0, lineSpacing: 1 },
];
export const PARAGRAPH_STYLE_KEYS = ['textAlign', 'indent', 'spaceBefore', 'spaceAfter', 'lineSpacing'];
const resetAttrs = { ...Object.fromEntries(PARAGRAPH_STYLE_KEYS.map(key => [key, null])), keepWithNext: null, keepTogether: null, pageBreakBefore: null, widowControl: null };
export const MAX_CUSTOM_STYLES = 32;

export function documentStyles(doc) {
  const overrides = Array.isArray(doc.attrs.styles) ? doc.attrs.styles : [];
  return [...DEFAULT_STYLES.map(style => overrides.find(item => item.id === style.id) || style), ...overrides.filter(item => !DEFAULT_STYLES.some(style => style.id === item.id))];
}
export function paragraphStyle(doc, node) {
  const styles = documentStyles(doc);
  return styles.find(style => style.id === node?.attrs.styleId) || styles.find(style => style.id === (node?.type.name === 'heading' ? `heading-${node.attrs.level}` : 'normal'));
}
export function selectedParagraphs(state) {
  const result = [], seen = new Set();
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos) => {
      if (!['paragraph', 'heading'].includes(node.type.name)) return;
      if (!seen.has(pos)) { result.push({ node, pos }); seen.add(pos); }
      return false;
    });
  }
  return result;
}
export function currentStyle(editor) { return paragraphStyle(editor.state.doc, selectedParagraphs(editor.state)[0]?.node); }
export function effectiveParagraph(editor) {
  const node = selectedParagraphs(editor.state)[0]?.node, style = paragraphStyle(editor.state.doc, node);
  return { ...style, ...Object.fromEntries(Object.entries(node?.attrs || {}).filter(([, value]) => value !== null && value !== undefined)) };
}
export function effectiveText(editor) {
  const style = currentStyle(editor), direct = editor.getAttributes('textStyle');
  return { ...style, ...Object.fromEntries(Object.entries(direct).filter(([, value]) => value != null)), fontSize: direct.fontSize ? parseFloat(direct.fontSize) * (direct.fontSize.endsWith('px') ? .75 : 1) : style.fontSize,
    bold: direct.fontWeight ? direct.fontWeight === 'bold' : editor.isActive('bold') || style.bold || editor.isActive('tableHeader'),
    italic: direct.fontStyle ? direct.fontStyle === 'italic' : editor.isActive('italic') || style.italic };
}
export function toggleStyleEmphasis(editor, kind) {
  if (editor.isEditable === false) return false;
  const active = effectiveText(editor)[kind], key = kind === 'bold' ? 'fontWeight' : 'fontStyle';
  return editor.chain().focus().unsetMark(kind).setMark('textStyle', { [key]: active ? 'normal' : kind }).run();
}
export function styleError(style, styles) {
  if (!style.name?.trim() || style.name.trim().length > 60 || /[\x00-\x1f]/.test(style.name)) return 'Use a style name with 1–60 characters.';
  if (styles.some(item => item.id !== style.id && item.name.trim().toLocaleLowerCase() === style.name.trim().toLocaleLowerCase())) return 'A style with this name already exists.';
  if (!DOCUMENT_FONTS.includes(style.fontFamily) || !/^#[0-9a-f]{6}$/i.test(style.color)) return 'Choose a supported font and a six-digit color such as #2F5496.';
  for (const [key, low, high] of [['fontSize', 6, 96], ['indent', 0, 6], ['spaceBefore', 0, 72], ['spaceAfter', 0, 72], ['lineSpacing', 1, 3], ['level', 0, 3]]) {
    if (!Number.isFinite(style[key]) || style[key] < low || style[key] > high || (key === 'level' && !Number.isInteger(style[key]))) return 'One or more style measurements are outside the supported range.';
  }
  return '';
}
export function applyParagraphStyle(editor, id, resetText = false) {
  if (editor.isEditable === false) return false;
  const style = documentStyles(editor.state.doc).find(item => item.id === id);
  if (!style) return false;
  const transaction = editor.state.tr;
  for (const { node, pos } of selectedParagraphs(editor.state)) {
    // A list item's first block must remain a paragraph in the list schema.
    const parent = editor.state.doc.resolve(pos).parent;
    const headingNode = style.level && !(parent.type.name === 'listItem' && parent.firstChild === node);
    transaction.setNodeMarkup(pos, editor.state.schema.nodes[headingNode ? 'heading' : 'paragraph'], { ...node.attrs, ...resetAttrs, styleId: id, ...(headingNode ? { level: style.level } : {}) });
    if (resetText) {
      for (const mark of ['bold', 'italic', 'underline', 'strike', 'subscript', 'superscript', 'textStyle', 'highlight']) transaction.removeMark(pos + 1, pos + node.nodeSize - 1, editor.state.schema.marks[mark]);
    }
  }
  if (!transaction.docChanged) return false;
  if (resetText) transaction.setStoredMarks(null);
  editor.view.dispatch(transaction); editor.commands.focus(); return true;
}
export function saveParagraphStyle(editor, value) {
  const styles = documentStyles(editor.state.doc), builtin = DEFAULT_STYLES.find(style => style.id === value.id);
  const style = { ...value, name: value.name.trim(), color: value.color.toUpperCase() };
  const error = styleError(style, styles);
  if (error) throw new Error(error);
  if (builtin && (style.name !== builtin.name || style.level !== builtin.level)) throw new Error('Built-in style names and heading levels cannot be changed.');
  if (!styles.some(item => item.id === style.id) && styles.length >= DEFAULT_STYLES.length + MAX_CUSTOM_STYLES) throw new Error('This document already has 32 custom styles.');
  const existing = styles.find(item => item.id === style.id);
  if (existing && existing.level !== style.level) throw new Error('A saved style keeps its heading level. Create another style to change it.');
  editor.view.dispatch(editor.state.tr.setDocAttribute('styles', [...(editor.state.doc.attrs.styles || []).filter(item => item.id !== style.id), style]));
  return true;
}
export function removeParagraphStyle(editor, id) {
  if (DEFAULT_STYLES.some(style => style.id === id)) return false;
  const removed = documentStyles(editor.state.doc).find(style => style.id === id);
  if (!removed) return false;
  const transaction = editor.state.tr;
  transaction.doc.descendants((node, pos) => {
    if (node.attrs.styleId === id) transaction.setNodeMarkup(pos, undefined, { ...node.attrs, styleId: removed.level ? `heading-${removed.level}` : 'normal' });
  });
  transaction.setDocAttribute('styles', (editor.state.doc.attrs.styles || []).filter(style => style.id !== id));
  editor.view.dispatch(transaction); return true;
}
export function stylePreview(style) {
  return { fontFamily: style.fontFamily, fontSize: `${style.fontSize}pt`, color: style.color, fontWeight: style.bold ? '700' : '400', fontStyle: style.italic ? 'italic' : 'normal', textAlign: style.textAlign, lineHeight: style.lineSpacing };
}
function styleDecorations(state) {
  const styles = new Map(documentStyles(state.doc).map(style => [style.id, style])), decorations = [];
  state.doc.descendants((node, pos) => {
    if (!['paragraph', 'heading'].includes(node.type.name)) return;
    const style = styles.get(node.attrs.styleId) || styles.get(node.type.name === 'heading' ? `heading-${node.attrs.level}` : 'normal');
    // Inline paragraph overrides take precedence over inherited style properties.
    const inHeader = state.doc.resolve(pos).parent.type.name === 'tableHeader';
    const css = [`font-family:${style.fontFamily}`, `font-size:${style.fontSize}pt`, `color:${style.color}`, `font-weight:${style.bold || inHeader ? 700 : 400}`, `font-style:${style.italic ? 'italic' : 'normal'}`];
    for (const [key, property, unit, scale] of [['textAlign', 'text-align', '', 1], ['indent', 'margin-left', 'in', .25], ['spaceBefore', 'margin-top', 'pt', 1], ['spaceAfter', 'margin-bottom', 'pt', 1], ['lineSpacing', 'line-height', '', 1]]) {
      const value = node.attrs[key] ?? style[key]; css.push(`${property}:${typeof value === 'number' ? value * scale : value}${unit}`);
    }
    decorations.push(Decoration.node(pos, pos + node.nodeSize, { style: css.join(';'), 'data-resolved-style': style.id }));
  });
  return DecorationSet.create(state.doc, decorations);
}
export const DocumentStyles = Extension.create({
  name: 'documentStyles', priority: 1100,
  addGlobalAttributes() { return [
    { types: ['doc'], attributes: { styles: { default: [], rendered: false } } },
    { types: ['paragraph', 'heading'], attributes: { styleId: { default: null,
      parseHTML: el => this.editor?.state && documentStyles(this.editor.state.doc).some(style => style.id === el.dataset.styleId) ? el.dataset.styleId : null,
      renderHTML: attrs => attrs.styleId ? { 'data-style-id': attrs.styleId } : {} } } },
    { types: ['textStyle'], attributes: {
      fontWeight: { default: null, parseHTML: el => ['normal', '400'].includes(el.style.fontWeight) ? 'normal' : null, renderHTML: attrs => attrs.fontWeight ? { style: `font-weight:${attrs.fontWeight}` } : {} },
      fontStyle: { default: null, parseHTML: el => el.style.fontStyle === 'normal' ? 'normal' : null, renderHTML: attrs => attrs.fontStyle ? { style: `font-style:${attrs.fontStyle}` } : {} },
    } },
  ]; },
  addKeyboardShortcuts() { return {
    'Mod-b': () => toggleStyleEmphasis(this.editor, 'bold'), 'Mod-i': () => toggleStyleEmphasis(this.editor, 'italic'),
    'Mod-Alt-0': () => applyParagraphStyle(this.editor, 'normal'),
    ...Object.fromEntries([1, 2, 3].map(level => [`Mod-Alt-${level}`, () => applyParagraphStyle(this.editor, `heading-${level}`)])),
    Enter: () => {
      const { selection } = this.editor.state, style = currentStyle(this.editor);
      if (!this.editor.isEditable || !selection.empty || !selection.$from.parent.isTextblock || selection.$from.parentOffset !== selection.$from.parent.content.size || this.editor.isActive('listItem') || (!style.level && !['title', 'subtitle'].includes(style.id))) return false;
      return this.editor.chain().splitBlock().updateAttributes('paragraph', { ...resetAttrs, styleId: 'normal' }).run();
    },
  }; },
  addProseMirrorPlugins() { return [new Plugin({
    state: { init: (_, state) => styleDecorations(state), apply: (transaction, previous, _old, state) => transaction.docChanged ? styleDecorations(state) : previous },
    props: { decorations(state) { return this.getState(state); } },
  })]; },
});
