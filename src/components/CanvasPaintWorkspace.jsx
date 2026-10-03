import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getPaintDocument, paintSurface } from '../paintDocument';
import { paintDimensions, paintRect } from '../paintPixels';
import { PAINT_SHAPES, PAINT_BRUSHES, drawPaintShape, drawPaintStroke } from '../paintShapes';
import { readPaintView, writePaintView } from '../paintPersistence';
import { paintBlob, paintFileName, savePaintFile } from '../paintFiles';
import { useDispatch } from '../useStore';
import { useDismissiblePopup } from '../useDismissiblePopup';
import { PaintButton, paintToolLabel } from './PaintIcon';
import WorkspaceInfo from './WorkspaceInfo';
import FreshFileInput from './FreshFileInput';
import './CanvasWorkspace.css';

const COLORS = [
  ['Black', '#000000'], ['Gray', '#808080'], ['Dark red', '#800000'], ['Red', '#ed1c24'], ['Orange', '#ff7f27'],
  ['Yellow', '#fff200'], ['Green', '#22b14c'], ['Turquoise', '#00a2e8'], ['Indigo', '#3f48cc'], ['Purple', '#a349a4'],
  ['White', '#ffffff'], ['Light gray', '#c3c3c3'], ['Brown', '#b97a57'], ['Rose', '#ffaec9'], ['Gold', '#ffc90e'],
  ['Light yellow', '#efe4b0'], ['Lime', '#b5e61d'], ['Light turquoise', '#99d9ea'], ['Blue-gray', '#7092be'], ['Lavender', '#c8bfe7'],
];
const SHORTCUT_TOOLS = { b: 'brush', p: 'pencil', e: 'eraser', f: 'fill', t: 'text', i: 'picker', s: 'select', m: 'magnifier' };

export default function CanvasPaintWorkspace() {
  const engine = useMemo(getPaintDocument, []), value = useSyncExternalStore(engine.subscribe, engine.getSnapshot), dispatch = useDispatch();
  const root = useRef(null), canvas = useRef(null), viewport = useRef(null), thumbnail = useRef(null), chooser = useRef(null), modal = useRef(null), menuRef = useRef(null), gesture = useRef(null), fitted = useRef(false);
  const [tool, setTool] = useState('brush'), [brush, setBrush] = useState('brush'), [size, setSize] = useState(4), [opacity, setOpacity] = useState(100);
  const [primary, setPrimary] = useState('#000000'), [secondary, setSecondary] = useState('#ffffff'), [colorSlot, setColorSlot] = useState('primary');
  const [fill, setFill] = useState('none'), [outline, setOutline] = useState('solid'), [tolerance, setTolerance] = useState(0), [transparent, setTransparent] = useState(false);
  const [zoom, setZoom] = useState(1), [view, setView] = useState(readPaintView), [toolbarOpen, setToolbarOpen] = useState(true), [fullScreen, setFullScreen] = useState(false);
  const [menu, setMenu] = useState(null), [dialog, setDialog] = useState(null), [fields, setFields] = useState({}), [notice, setNotice] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [cursor, setCursor] = useState(null);
  const [textDraft, setTextDraft] = useState(null), [font, setFont] = useState({ family: 'Segoe UI', size: 22, bold: false, italic: false, underline: false, opaque: false, align: 'left' });
  const [curve, setCurve] = useState(null), [polygon, setPolygon] = useState([]), [resizePreview, setResizePreview] = useState(null);
  const importMode = useRef('open');
  const activeLayer = value.layers.find(item => item.id === value.activeLayerId), activeIndex = value.layers.findIndex(item => item.id === value.activeLayerId);
  const settings = { tool, brush, size, opacity, primary, secondary, fill, outline, pressure: view.pressure };
  useDismissiblePopup({ open: !!menu, container: menuRef, onDismiss: () => setMenu(null) });
  useEffect(() => { void engine.initialize(); }, [engine]);
  useEffect(() => { if (dialog) modal.current?.showModal(); else modal.current?.close(); }, [dialog]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (!fitted.current && engine.ready && viewport.current.clientWidth > 0) { fit(); fitted.current = true; } });
    observer.observe(viewport.current); return () => observer.disconnect();
  }, [value.ready, value.width, value.height]);
  useLayoutEffect(() => { render(); }, [value.revision, value.selection, value.activeLayerId, value.width, value.height, zoom]);
  useEffect(() => {
    if (!view.thumbnail || !thumbnail.current) return;
    const image = engine.composite(), target = thumbnail.current; target.width = 160; target.height = Math.max(1, Math.round(value.height * 160 / value.width));
    target.getContext('2d').drawImage(image, 0, 0, target.width, target.height);
  }, [value.revision, view.thumbnail, value.width, value.height]);
  useEffect(() => {
    const element = viewport.current;
    const wheel = event => { if (event.ctrlKey) { event.preventDefault(); setZoom(old => Math.max(.125, Math.min(8, old * (event.deltaY < 0 ? 1.2 : 1 / 1.2)))); } };
    element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel);
  }, []);
  async function action(callback) { try { setError(''); await callback(); } catch (failure) { setError(failure.message || 'Canvas could not complete this action.'); render(); } }
  function preferences(changes) { const next = { ...view, ...changes }; setView(next); action(() => writePaintView(next)); }
  function fit() { const box = viewport.current; if (box?.clientWidth && box?.clientHeight) setZoom(Math.max(.125, Math.min(1, (box.clientWidth - 76) / engine.doc.width, (box.clientHeight - 76) / engine.doc.height))); }
  function render(preview = null, omitLayer = null) {
    const target = canvas.current; if (!target) return; const image = engine.composite({ preview, omitLayer });
    if (target.width !== image.width || target.height !== image.height) { target.width = image.width; target.height = image.height; }
    const ctx = target.getContext('2d'); ctx.clearRect(0, 0, target.width, target.height); ctx.drawImage(image, 0, 0);
  }
  function point(event, clamp = true) {
    const rect = canvas.current.getBoundingClientRect(), x = (event.clientX - rect.left) * value.width / rect.width, y = (event.clientY - rect.top) * value.height / rect.height;
    return { x: clamp ? Math.max(0, Math.min(value.width - .001, x)) : x, y: clamp ? Math.max(0, Math.min(value.height - .001, y)) : y, pressure: event.pointerType === 'pen' ? event.pressure : 1 };
  }
  function constrained(start, end, shift) {
    if (!shift) return end; const dx = end.x - start.x, dy = end.y - start.y;
    if (['line', 'curve'].includes(tool)) { const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, distance = Math.hypot(dx, dy); return { x: start.x + Math.cos(angle) * distance, y: start.y + Math.sin(angle) * distance }; }
    const distance = Math.max(Math.abs(dx), Math.abs(dy)); return { x: start.x + Math.sign(dx || 1) * distance, y: start.y + Math.sign(dy || 1) * distance };
  }
  function capture(event) { event.currentTarget.setPointerCapture(event.pointerId); root.current.focus({ preventScroll: true }); event.preventDefault(); }
  function chooseTool(next) {
    if (textDraft) applyText(); setTool(next); setMenu(null); setCurve(null); setPolygon([]); gesture.current = null; render();
    if (!['select', 'lasso'].includes(next)) engine.select(null);
  }
  function down(event) {
    if (busy || !value.ready || ![0, 2].includes(event.button)) return;
    if (textDraft) { applyText(); return; } const start = point(event); capture(event);
    if (event.altKey || tool === 'picker') { action(() => event.button === 2 ? setSecondary(engine.pick(start.x, start.y)) : setPrimary(engine.pick(start.x, start.y))); return; }
    if (tool === 'magnifier') { setZoom(old => Math.max(.125, Math.min(8, old * (event.button === 2 || event.shiftKey ? .5 : 2)))); return; }
    if (tool === 'fill') { action(() => engine.fill(start.x, start.y, event.button === 2 ? secondary : primary, opacity, tolerance)); return; }
    if (tool === 'text') { setTextDraft({ ...start, text: '' }); return; }
    if (['select', 'lasso'].includes(tool)) {
      const rect = value.selection?.rect;
      if (rect && start.x >= rect.x && start.y >= rect.y && start.x <= rect.x + rect.width && start.y <= rect.y + rect.height) gesture.current = { type: 'move', start, rect };
      else { engine.select(null); gesture.current = { type: 'select', start, points: [start] }; } return;
    }
    const options = { ...settings, primary: event.button === 2 ? secondary : primary };
    if (tool === 'polygon') { setPolygon(old => [...old, start]); return; }
    if (tool === 'curve' && curve) { gesture.current = { type: 'bend', start, options }; return; }
    gesture.current = { type: ['brush', 'pencil', 'eraser'].includes(tool) ? 'stroke' : 'shape', start, end: start, points: [start], preview: paintSurface(value.width, value.height), options };
    updateDrawing(gesture.current);
  }
  function updateDrawing(g) {
    const ctx = g.preview.getContext('2d'); ctx.clearRect(0, 0, value.width, value.height);
    if (g.type === 'stroke') drawPaintStroke(ctx, g.points, { ...g.options, tool: tool === 'eraser' ? 'brush' : tool, brush: tool === 'eraser' ? 'brush' : g.options.brush });
    else drawPaintShape(ctx, tool, g.start, g.end, g.options);
    if (tool === 'eraser') { const layer = paintSurface(value.width, value.height), c = layer.getContext('2d'); c.drawImage(activeLayer.canvas, 0, 0); c.globalCompositeOperation = 'destination-out'; c.drawImage(g.preview, 0, 0); render(layer, value.activeLayerId); }
    else render(g.preview);
  }
  function move(event) {
    const p = point(event); setCursor({ x: Math.floor(p.x), y: Math.floor(p.y) }); const g = gesture.current;
    if (!g) { if (polygon.length) { const preview = paintSurface(value.width, value.height); drawPaintShape(preview.getContext('2d'), 'polygon', polygon[0], p, settings, null, [...polygon, p]); render(preview); } return; }
    if (g.type === 'canvasResize') {
      const width = Math.max(1, Math.min(8192, Math.round(g.width + (event.clientX - g.clientX) / zoom))), height = Math.max(1, Math.min(8192, Math.round(g.height + (event.clientY - g.clientY) / zoom)));
      g.target = { width: g.axis === 'height' ? g.width : width, height: g.axis === 'width' ? g.height : height }; setResizePreview(g.target); return;
    }
    if (g.type === 'select') { g.end = p; if (tool === 'lasso') g.points.push(p); engine.select(paintRect(g.start, p, value.width, value.height), tool === 'lasso' ? g.points : null); return; }
    if (g.type === 'move' || g.type === 'selectionResize') {
      const raw = point(event, false), dx = Math.round(raw.x - g.start.x), dy = Math.round(raw.y - g.start.y); let target = { ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy };
      if (g.type === 'selectionResize') { const west = g.corner.includes('w'), north = g.corner.includes('n'); target = { x: west ? Math.min(g.rect.x + g.rect.width - 1, g.rect.x + dx) : g.rect.x, y: north ? Math.min(g.rect.y + g.rect.height - 1, g.rect.y + dy) : g.rect.y, width: Math.max(1, g.rect.width + (west ? -dx : dx)), height: Math.max(1, g.rect.height + (north ? -dy : dy)) }; }
      target.width = Math.min(value.width, target.width); target.height = Math.min(value.height, target.height); target.x = Math.max(0, Math.min(value.width - target.width, target.x)); target.y = Math.max(0, Math.min(value.height - target.height, target.y));
      g.target = target; const preview = engine.selectionPreview(target, transparent ? secondary : null); render(preview.canvas, value.activeLayerId); return;
    }
    if (g.type === 'bend') { g.control = p; const preview = paintSurface(value.width, value.height); drawPaintShape(preview.getContext('2d'), 'curve', curve.start, curve.end, g.options, p); render(preview); return; }
    g.end = constrained(g.start, p, event.shiftKey);
    if (g.type === 'stroke') { const samples = event.getCoalescedEvents?.() || [event]; g.points.push(...samples.map(sample => point(sample))); if (g.points.length > 12000) g.points = g.points.filter((_, i) => i % 2 === 0 || i === g.points.length - 1); }
    updateDrawing(g);
  }
  function up(event) {
    const g = gesture.current; gesture.current = null; if (!g) return;
    if (g.type === 'canvasResize') { setResizePreview(null); if (g.target) action(() => engine.resize(g.target.width, g.target.height)); return; }
    if (g.type === 'select') return;
    if (g.type === 'move' || g.type === 'selectionResize') { if (g.target) action(() => engine.moveSelection(g.target, transparent ? secondary : null)); else render(); return; }
    if (g.type === 'bend') { acceptCurve(g.control || point(event)); return; }
    if (g.type === 'shape' && tool === 'curve') { setCurve({ start: g.start, end: g.end, options: g.options }); setNotice('Click to bend the curve. Enter accepts; Escape cancels.'); return; }
    action(() => engine.paint(tool === 'eraser' ? 'Erase' : g.type === 'stroke' ? 'Brush stroke' : 'Shape', g.preview, tool === 'eraser'));
  }
  function cancelGesture() { gesture.current = null; setResizePreview(null); render(); }
  function acceptCurve(control = null) { if (!curve) return; const preview = paintSurface(value.width, value.height); drawPaintShape(preview.getContext('2d'), 'curve', curve.start, curve.end, curve.options, control); action(() => engine.paint('Curve', preview)); setCurve(null); setNotice(''); }
  function acceptPolygon() { if (polygon.length >= 3) { const preview = paintSurface(value.width, value.height); drawPaintShape(preview.getContext('2d'), 'polygon', polygon[0], polygon.at(-1), settings, null, polygon); action(() => engine.paint('Polygon', preview)); } setPolygon([]); render(); }
  function applyText() {
    if (!textDraft) return;
    if (textDraft.text.trim()) action(() => {
      const preview = paintSurface(value.width, value.height), ctx = preview.getContext('2d'), lines = textDraft.text.split('\n'), spacing = font.size * 1.3;
      ctx.font = `${font.italic ? 'italic ' : ''}${font.bold ? 'bold ' : ''}${font.size}px "${font.family}"`;
      const width = Math.max(...lines.map(line => ctx.measureText(line).width), 1), height = lines.length * spacing;
      ctx.globalAlpha = opacity / 100; ctx.textBaseline = 'top'; ctx.textAlign = font.align;
      if (font.opaque) { ctx.fillStyle = secondary; ctx.fillRect(textDraft.x, textDraft.y, width + 6, height); }
      ctx.fillStyle = primary; ctx.strokeStyle = primary; ctx.lineWidth = 1;
      const x = textDraft.x + (font.align === 'center' ? width / 2 : font.align === 'right' ? width : 0);
      lines.forEach((line, i) => { const y = textDraft.y + i * spacing; ctx.fillText(line, x, y); if (font.underline) { const length = ctx.measureText(line).width, left = x - (font.align === 'center' ? length / 2 : font.align === 'right' ? length : 0); ctx.beginPath(); ctx.moveTo(left, y + font.size); ctx.lineTo(left + length, y + font.size); ctx.stroke(); } });
      engine.paint('Text', preview);
    });
    setTextDraft(null);
  }
  function openDialog(kind) {
    if (textDraft) applyText(); setMenu(null); setError('');
    setFields({ width: kind === 'new' ? 1200 : value.width, height: kind === 'new' ? 800 : value.height, units: 'pixels', background: kind === 'new' ? '#ffffff' : value.background,
      lock: true, smooth: true, skewX: 0, skewY: 0, format: 'png', name: paintFileName(value.name, 'png'), quality: 92 });
    setDialog(kind);
  }
  function chooseFile(mode) { importMode.current = mode; setMenu(null); chooser.current.click(); }
  async function importFile(file, mode) {
    if (!file) return;
    if (file.size > 128 * 1024 * 1024) throw Error('Choose a file smaller than 128 MB.');
    if (/\.lawpaint$/i.test(file.name)) { if (mode !== 'open') throw Error('Use Open to restore a Canvas project.'); await engine.openProject(JSON.parse(await file.text())); }
    else {
      if (file.size > 32 * 1024 * 1024) throw Error('Choose an image smaller than 32 MB.');
      if (!/^image\/(png|jpeg|webp|bmp|gif)$/.test(file.type) && !/\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) throw Error('Choose PNG, JPEG, WebP, BMP or GIF. GIF imports its first frame.');
      const image = await createImageBitmap(file);
      try { paintDimensions(image.width, image.height); engine.importImage(image, file.name, mode === 'open'); } finally { image.close(); }
    }
    setNotice(mode === 'open' ? `Opened ${file.name}.` : `Imported ${file.name} as a layer.`); setTool('select'); setCurve(null); setPolygon([]); fitted.current = false; fit();
  }
  async function openFiles(files, mode) { setBusy(true); try { if (textDraft) applyText(); for (const file of files) await importFile(file, mode); } finally { setBusy(false); } }
  async function save(format = engine.file?.format || 'png', saveAs = false, name = value.name, quality = .92) {
    if (textDraft) applyText(); setBusy(true);
    try {
      const revision = engine.revision, blob = format === 'lawpaint' ? new Blob([JSON.stringify(engine.serialize())], { type: 'application/json' }) : await paintBlob(engine.composite({ white: format === 'jpeg' || format === 'bmp' }), format, quality);
      const result = await savePaintFile(blob, format, name, !saveAs && engine.file?.format === format ? engine.file.ticket : null);
      if (result.saved) { engine.markSaved(revision, { ...result, format }); setNotice(`Saved ${result.name}.`); setDialog(null); }
    } finally { setBusy(false); }
  }
  async function copy(whole = false) {
    const image = whole ? engine.composite() : engine.selectionSurface(transparent ? secondary : null);
    if (window.workstationDesktop?.copyImage) { const result = await window.workstationDesktop.copyImage(image.toDataURL('image/png')); if (result?.error) throw Error(result.error); }
    else await navigator.clipboard.write([new ClipboardItem({ 'image/png': await paintBlob(image) })]);
    setNotice(whole || !value.selection ? 'Canvas copied.' : 'Selection copied.');
  }
  async function paste() {
    const items = await navigator.clipboard.read(); let found = false;
    for (const item of items) { const type = item.types.find(type => /^image\/(png|jpeg|webp|bmp)$/.test(type)); if (type) { const blob = await item.getType(type); await importFile(new File([blob], 'Pasted image.' + type.split('/')[1], { type }), 'import'); found = true; } }
    if (!found) throw Error('Copy an image first, or use Import to canvas.');
  }
  async function useInChat() {
    if (textDraft) applyText();
    const blob = await paintBlob(engine.composite()); if (blob.size > 10 * 1024 * 1024) throw Error('The chat attachment limit is 10 MB. Resize a copy before attaching it.');
    const file = new File([blob], paintFileName(value.name, 'png'), { type: 'image/png' }); dispatch({ type: 'SET_SIDEBAR_TAB', payload: 'chats' });
    let accepted = false;
    for (let attempt = 0; attempt < 20 && !accepted; attempt++) { await new Promise(resolve => setTimeout(resolve, 50)); const event = new CustomEvent('stage-function-result', { detail: [file], cancelable: true }); window.dispatchEvent(event); accepted = event.defaultPrevented; }
    if (!accepted) throw Error('Open a chat and paste the copied canvas, or try Use in chat again.');
    setNotice('Added to chat attachments. Review it, then Send.');
  }
  async function print() {
    if (textDraft) applyText();
    if (window.workstationDesktop?.printPaint) { const blob = await paintBlob(engine.composite({ white: true })); const result = await window.workstationDesktop.printPaint({ bytes: new Uint8Array(await blob.arrayBuffer()), name: 'Canvas.png' }); if (result.error) throw Error(result.error); }
    else { const image = root.current.querySelector('.paint-print-image'); image.src = engine.composite({ white: true }).toDataURL('image/png'); await image.decode(); document.body.dataset.printPaint = 'true'; try { window.print(); } finally { delete document.body.dataset.printPaint; } }
  }
  function submitDialog(event) {
    event.preventDefault(); action(async () => {
      if (dialog === 'export') return save(fields.format, true, fields.name, fields.quality / 100);
      const factor = fields.units === 'inches' ? 96 : fields.units === 'cm' ? 96 / 2.54 : 1;
      const width = fields.units === 'percent' ? Math.round(value.width * Number(fields.width) / 100) : Math.round(Number(fields.width) * factor);
      const height = fields.units === 'percent' ? Math.round(value.height * Number(fields.height) / 100) : Math.round(Number(fields.height) * factor);
      if (dialog === 'new') engine.newDocument(width, height, fields.background);
      else engine.resize(width, height, { scale: dialog === 'resize', background: fields.background, smooth: fields.smooth, skewX: Number(fields.skewX), skewY: Number(fields.skewY) });
      setDialog(null); fitted.current = false; fit();
    });
  }
  function dimensionField(key, input) {
    const number = Number(input); setFields(old => ({ ...old, [key]: input,
      ...(dialog === 'resize' && old.lock && number > 0 ? { [key === 'width' ? 'height' : 'width']: Math.round(number * (old.units === 'percent' ? 1 : key === 'width' ? value.height / value.width : value.width / value.height) * 100) / 100 } : {}) }));
  }
  function changeUnits(units) {
    const factor = name => name === 'inches' ? 96 : name === 'cm' ? 96 / 2.54 : 1;
    setFields(old => ({ ...old, units, width: units === 'percent' ? 100 : Math.round((old.units === 'percent' ? value.width * Number(old.width) / 100 : Number(old.width) * factor(old.units)) / factor(units) * 100) / 100,
      height: units === 'percent' ? 100 : Math.round((old.units === 'percent' ? value.height * Number(old.height) / 100 : Number(old.height) * factor(old.units)) / factor(units) * 100) / 100 }));
  }
  function nudge(dx, dy, shift) { if (value.selection) { const rect = value.selection.rect; engine.moveSelection({ ...rect, x: Math.max(0, Math.min(value.width - rect.width, rect.x + dx * (shift ? 10 : 1))), y: Math.max(0, Math.min(value.height - rect.height, rect.y + dy * (shift ? 10 : 1))) }, transparent ? secondary : null); } }
  function keyDown(event) {
    if (event.key === 'Escape') { if (dialog) { setDialog(null); return; } setMenu(null); setTextDraft(null); setCurve(null); setPolygon([]); engine.select(null); cancelGesture(); setFullScreen(false); return; }
    if (event.target.closest('input,textarea,select,[contenteditable="true"]') || dialog || busy || !value.ready) return;
    const key = event.key.toLowerCase(), control = event.ctrlKey || event.metaKey;
    const commands = control ? {
      z: () => event.shiftKey ? engine.redo() : engine.undo(), y: () => engine.redo(), a: () => { setTool('select'); engine.selectAll(); },
      c: () => copy(), x: async () => { await copy(); if (value.selection) engine.clearSelection(); }, v: () => paste(), n: () => openDialog('new'), o: () => chooseFile('open'),
      s: () => event.shiftKey ? save('lawpaint', true) : save(), p: () => print(), r: () => preferences({ rulers: !view.rulers }), g: () => preferences({ grid: !view.grid }), e: () => openDialog('properties'),
    } : { ...Object.fromEntries(Object.entries(SHORTCUT_TOOLS).map(([key, next]) => [key, () => chooseTool(next)])), x: () => { setPrimary(secondary); setSecondary(primary); },
      delete: () => { if (value.selection) engine.clearSelection(); }, enter: () => curve ? acceptCurve() : acceptPolygon(), '+': () => setZoom(old => Math.min(8, old * 1.25)), '-': () => setZoom(old => Math.max(.125, old / 1.25)),
      arrowleft: () => nudge(-1, 0, event.shiftKey), arrowright: () => nudge(1, 0, event.shiftKey), arrowup: () => nudge(0, -1, event.shiftKey), arrowdown: () => nudge(0, 1, event.shiftKey) };
    if (commands[key]) { event.preventDefault(); action(commands[key]); }
  }
  function menuAction(callback) { setMenu(null); action(callback); }
  function menuItem(label, callback, shortcut = '', disabled = false, checked = null) { return <button type="button" role={checked === null ? 'menuitem' : 'menuitemcheckbox'} {...(checked !== null ? { 'aria-checked': checked } : {})} disabled={disabled || busy} onClick={() => menuAction(callback)}><span>{checked === null ? '' : checked ? '✓ ' : '　'}{label}</span>{shortcut && <kbd>{shortcut}</kbd>}</button>; }
  const selectionRect = value.selection?.rect, rulerStep = zoom < .5 ? 200 : zoom > 3 ? 20 : 100;
  // RENDER_BODY
}
