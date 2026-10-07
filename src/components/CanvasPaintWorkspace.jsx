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
  async function openFiles(files, mode) { if (mode === 'open' && value.dirty && !window.confirm('Replace the current canvas? Save a project first to keep its layers.')) return; setBusy(true); try { if (textDraft) applyText(); for (const file of files) await importFile(file, mode); } finally { setBusy(false); } }
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
      if (dialog === 'new') { if (value.dirty && !window.confirm('Replace the current canvas? Save a project first to keep its layers.')) return; engine.newDocument(width, height, fields.background); }
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
  return <section ref={root} className={`paint-workspace ${fullScreen ? 'paint-fullscreen' : ''}`} tabIndex={0} aria-label="Paint workspace" onKeyDown={keyDown}>
    <header className="paint-title"><strong>Paint · {value.name}{value.dirty ? ' *' : ''}</strong><WorkspaceInfo tab="canvas"/><span>{value.draftStatus}</span></header>
    <div className="paint-menu-bar" ref={menuRef}>
      {['File','Edit','View'].map(name=><button key={name} type="button" aria-haspopup="menu" aria-expanded={menu===name} onClick={()=>setMenu(menu===name?null:name)}>{name}</button>)}
      <PaintButton name="Undo" icon="undo" disabled={!value.canUndo||busy} onClick={()=>action(()=>engine.undo())}/><PaintButton name="Redo" icon="redo" disabled={!value.canRedo||busy} onClick={()=>action(()=>engine.redo())}/>
      <button type="button" onClick={()=>setToolbarOpen(!toolbarOpen)}>{toolbarOpen?'Hide tools':'Show tools'}</button><button type="button" disabled={!value.ready||busy} onClick={()=>action(useInChat)}>Use in chat</button>
      {menu&&<div className="paint-menu" role="menu">
        {menu==='File'&&<>{menuItem('New',()=>openDialog('new'),'Ctrl+N')}{menuItem('Open',()=>chooseFile('open'),'Ctrl+O')}{menuItem('Import to canvas',()=>chooseFile('import'))}{menuItem('Save',()=>save(),'Ctrl+S')}{menuItem('Save project',()=>save('lawpaint',true),'Ctrl+Shift+S')}{menuItem('Export / Save as',()=>openDialog('export'))}{menuItem('Print',print,'Ctrl+P')}{menuItem('Properties',()=>openDialog('properties'),'Ctrl+E')}</>}
        {menu==='Edit'&&<>{menuItem('Select all',()=>{chooseTool('select');engine.selectAll();},'Ctrl+A')}{menuItem('Invert selection',()=>engine.invertSelection(),'',!selectionRect)}{menuItem('Copy',()=>copy(),'Ctrl+C')}{menuItem('Cut',async()=>{await copy();engine.clearSelection();},'Ctrl+X',!selectionRect)}{menuItem('Paste',paste,'Ctrl+V')}{menuItem('Delete selection',()=>engine.clearSelection(),'Delete',!selectionRect)}{menuItem('Crop',()=>engine.crop(),'',!selectionRect)}{menuItem('Resize / skew',()=>openDialog('resize'))}{menuItem('Rotate clockwise',()=>engine.transform(90))}{menuItem('Rotate counterclockwise',()=>engine.transform(-90))}{menuItem('Flip horizontal',()=>engine.transform(0,'horizontal'))}{menuItem('Flip vertical',()=>engine.transform(0,'vertical'))}</>}
        {menu==='View'&&<>{menuItem('Fit canvas',fit)}{menuItem('Actual size',()=>setZoom(1))}{['rulers','grid','status','thumbnail','layers','pixelated','pressure'].map(key=><span key={key}>{menuItem(key[0].toUpperCase()+key.slice(1),()=>preferences({[key]:!view[key]}),'',false,view[key])}</span>)}{menuItem('Full screen',()=>setFullScreen(!fullScreen),'Escape to exit',false,fullScreen)}</>}
      </div>}
    </div>
    {toolbarOpen&&<div className="paint-ribbon">
      <fieldset disabled={busy||!value.ready}><legend>Tools</legend><div className="paint-tools">{['select','lasso','brush','pencil','eraser','fill','text','picker','magnifier'].map(next=><PaintButton key={next} name={paintToolLabel(next)} icon={next} active={tool===next} onClick={()=>chooseTool(next)}/>)}</div>
        <label>Brush<select aria-label="Brush style" value={brush} onChange={e=>{setBrush(e.target.value);chooseTool('brush');}}>{PAINT_BRUSHES.map(([key,name])=><option key={key} value={key}>{name}</option>)}</select></label>
        <label>Size <input aria-label="Brush size" type="number" min="1" max="200" value={size} onChange={e=>setSize(Math.max(1,Math.min(200,Number(e.target.value))))}/></label><label>Opacity <input aria-label="Brush opacity" type="range" min="1" max="100" value={opacity} onChange={e=>setOpacity(Number(e.target.value))}/>{opacity}%</label>
      </fieldset>
      <fieldset disabled={busy||!value.ready}><legend>Shapes</legend><div className="paint-shapes">{PAINT_SHAPES.map(([key,name])=><PaintButton key={key} name={name} icon={key} active={tool===key} onClick={()=>chooseTool(key)}/>)}</div><label>Outline<select value={outline} onChange={e=>setOutline(e.target.value)}><option value="solid">Solid</option><option value="none">None</option></select></label><label>Fill<select value={fill} onChange={e=>setFill(e.target.value)}><option value="none">None</option><option value="solid">Solid</option></select></label></fieldset>
      <fieldset><legend>Colors</legend><div className="paint-colors"><button type="button" aria-pressed={colorSlot==='primary'} onClick={()=>setColorSlot('primary')}><i style={{background:primary}}/>Color 1</button><button type="button" aria-pressed={colorSlot==='secondary'} onClick={()=>setColorSlot('secondary')}><i style={{background:secondary}}/>Color 2</button><PaintButton name="Swap colors" icon="swap" onClick={()=>{setPrimary(secondary);setSecondary(primary);}}/><div className="paint-palette">{COLORS.map(([name,color])=><button key={color} type="button" aria-label={name} title={name} style={{background:color}} onClick={()=>colorSlot==='primary'?setPrimary(color):setSecondary(color)} onContextMenu={e=>{e.preventDefault();setSecondary(color);}}/>)}</div><label>Custom color<input aria-label="Custom color" type="color" value={colorSlot==='primary'?primary:secondary} onChange={e=>colorSlot==='primary'?setPrimary(e.target.value):setSecondary(e.target.value)}/></label></div></fieldset>
    </div>}
    {tool==='fill'&&<label className="paint-options">Fill tolerance<input type="range" min="0" max="255" value={tolerance} onChange={e=>setTolerance(Number(e.target.value))}/>{tolerance}</label>}
    {['select','lasso'].includes(tool)&&<label className="paint-options"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>Transparent selection (Color 2)</label>}
    {tool==='text'&&<div className="paint-options"><label>Font<select value={font.family} onChange={e=>setFont({...font,family:e.target.value})}>{['Segoe UI','Arial','Georgia','Courier New'].map(name=><option key={name}>{name}</option>)}</select></label><label>Size<input type="number" min="6" max="300" value={font.size} onChange={e=>setFont({...font,size:Math.max(6,Math.min(300,Number(e.target.value)))})}/></label>{['bold','italic','underline','opaque'].map(key=><label key={key}><input type="checkbox" checked={font[key]} onChange={e=>setFont({...font,[key]:e.target.checked})}/>{key}</label>)}{textDraft&&<button type="button" onClick={applyText}>Apply text</button>}</div>}
    {(error||value.error)&&<p role="alert" className="paint-error">{error||value.error}</p>}{notice&&<p role="status" className="paint-notice">{notice}</p>}
    <div className="paint-body"><div ref={viewport} className="paint-viewport" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();action(()=>openFiles([...e.dataTransfer.files],'import'));}}>
      <div className="paint-sheet" style={{width:value.width*zoom,height:value.height*zoom,margin:view.rulers?38:24}}>
        {view.rulers&&<><div className="paint-ruler-x">{Array.from({length:Math.ceil(value.width/rulerStep)},(_,i)=><span key={i} style={{left:i*rulerStep*zoom}}>{i*rulerStep}</span>)}</div><div className="paint-ruler-y">{Array.from({length:Math.ceil(value.height/rulerStep)},(_,i)=><span key={i} style={{top:i*rulerStep*zoom}}>{i*rulerStep}</span>)}</div></>}
        <canvas ref={canvas} aria-label="Drawing canvas" className={view.pixelated?'paint-pixelated':''} style={{width:value.width*zoom,height:value.height*zoom,cursor:tool==='text'?'text':'crosshair'}} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelGesture} onLostPointerCapture={()=>{if(gesture.current)cancelGesture();}} onContextMenu={e=>e.preventDefault()} onDoubleClick={()=>{if(tool==='polygon')acceptPolygon();}}/>
        {view.grid&&<div className="paint-grid" style={{backgroundSize:`${Math.max(8,10*zoom)}px ${Math.max(8,10*zoom)}px`}}/>}
        {selectionRect&&<div className="paint-selection" style={{left:selectionRect.x*zoom,top:selectionRect.y*zoom,width:selectionRect.width*zoom,height:selectionRect.height*zoom}}>{['nw','ne','sw','se'].map(corner=><button key={corner} className={`paint-handle ${corner}`} aria-label={`Resize selection ${corner}`} onPointerDown={e=>{capture(e);gesture.current={type:'selectionResize',start:point(e,false),rect:selectionRect,corner};}} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelGesture}/>)}</div>}
        {['width','height','both'].map(axis=><button key={axis} type="button" className={`paint-canvas-handle paint-${axis}`} aria-label={`Resize canvas ${axis}`} disabled={!value.ready||busy} onPointerDown={e=>{capture(e);gesture.current={type:'canvasResize',axis,width:value.width,height:value.height,clientX:e.clientX,clientY:e.clientY};}} onPointerMove={move} onPointerUp={up} onPointerCancel={cancelGesture}/>)}
        {textDraft&&<textarea autoFocus aria-label="Canvas text" className="paint-text" style={{left:textDraft.x*zoom,top:textDraft.y*zoom,fontSize:font.size*zoom,color:primary}} value={textDraft.text} onChange={e=>setTextDraft({...textDraft,text:e.target.value})} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();applyText();}}}/>}
      </div>
    </div>{(view.layers||view.thumbnail)&&<aside className="paint-side">{view.thumbnail&&<canvas ref={thumbnail} aria-label="Canvas thumbnail"/>}{view.layers&&<><h3>Layers</h3>{[...value.layers].reverse().map(layer=><div key={layer.id} className="paint-layer"><button type="button" aria-pressed={layer.id===value.activeLayerId} onClick={()=>engine.setActive(layer.id)}>{layer.name}</button><label><input aria-label={`Show ${layer.name}`} type="checkbox" checked={layer.visible} onChange={e=>action(()=>engine.editLayer(layer.id,{visible:e.target.checked}))}/>Show</label></div>)}<label>Layer name<input aria-label="Layer name" key={activeLayer.id} defaultValue={activeLayer.name} maxLength="100" onBlur={e=>{if(e.target.value!==activeLayer.name)action(()=>engine.editLayer(activeLayer.id,{name:e.target.value}));}}/></label><label>Layer opacity<input type="range" aria-label="Layer opacity" value={activeLayer.opacity} min="0" max="100" onChange={e=>action(()=>engine.editLayer(activeLayer.id,{opacity:Number(e.target.value)}))}/></label><div className="paint-options"><button onClick={()=>action(()=>engine.addLayer())}>Add layer</button><button onClick={()=>action(()=>engine.addLayer(true))}>Duplicate</button><button disabled={value.layers.length===1} onClick={()=>action(()=>engine.removeLayer())}>Delete layer</button><button disabled={!activeIndex} onClick={()=>action(()=>engine.mergeDown())}>Merge down</button><button disabled={activeIndex===value.layers.length-1} onClick={()=>action(()=>engine.reorderLayer(1))}>Up</button><button disabled={!activeIndex} onClick={()=>action(()=>engine.reorderLayer(-1))}>Down</button></div></>}</aside>}</div>
    {view.status&&<footer className="paint-status"><span>{value.width} × {value.height} px{resizePreview?` → ${resizePreview.width} × ${resizePreview.height}`:''}</span><span>{cursor?`${cursor.x}, ${cursor.y}`:''}{selectionRect?` · Selection ${selectionRect.width} × ${selectionRect.height}`:''}</span><button onClick={fit}>Fit</button><button onClick={()=>setZoom(1)}>100%</button><label>Zoom<input aria-label="Canvas zoom" type="range" min="12.5" max="800" step="12.5" value={zoom*100} onChange={e=>setZoom(Number(e.target.value)/100)}/>{Math.round(zoom*100)}%</label></footer>}
    <FreshFileInput ref={chooser} hidden type="file" accept=".lawpaint,image/png,image/jpeg,image/webp,image/bmp,image/gif" onChange={e=>{const files=[...e.target.files];e.target.value='';action(()=>openFiles(files,importMode.current));}}/>
    <dialog ref={modal} aria-label="Canvas settings" onCancel={()=>setDialog(null)}><form onSubmit={submitDialog}><h2>{({new:'New canvas',resize:'Resize / skew',properties:'Canvas properties',export:'Export / Save as'})[dialog]}</h2>
      {dialog==='export'?<><label>File name<input required value={fields.name||''} maxLength="180" onChange={e=>setFields({...fields,name:e.target.value})}/></label><label>Format<select value={fields.format} onChange={e=>setFields({...fields,format:e.target.value,name:paintFileName(fields.name,e.target.value)})}>{['png','jpeg','webp','bmp','lawpaint'].map(key=><option key={key}>{key}</option>)}</select></label>{['jpeg','webp'].includes(fields.format)&&<label>Quality<input type="range" min="1" max="100" value={fields.quality} onChange={e=>setFields({...fields,quality:Number(e.target.value)})}/>{fields.quality}%</label>}<p>PNG and projects preserve transparency. Projects preserve layers. JPEG and BMP use a white background.</p></>:<><label>Units<select value={fields.units} onChange={e=>changeUnits(e.target.value)}>{(dialog==='resize'?['pixels','percent','inches','cm']:['pixels','inches','cm']).map(key=><option key={key}>{key}</option>)}</select></label>{['width','height'].map(key=><label key={key}>{key}<input aria-label={`Canvas ${key}`} required type="number" min="0.01" step="any" value={fields[key]??''} onChange={e=>dimensionField(key,e.target.value)}/></label>)}{dialog==='resize'&&<><label><input type="checkbox" checked={!!fields.lock} onChange={e=>setFields({...fields,lock:e.target.checked})}/>Keep aspect ratio</label><label><input type="checkbox" checked={!!fields.smooth} onChange={e=>setFields({...fields,smooth:e.target.checked})}/>Smooth scaling</label>{['skewX','skewY'].map(key=><label key={key}>{key} (degrees)<input type="number" min="-60" max="60" value={fields[key]} onChange={e=>setFields({...fields,[key]:e.target.value})}/></label>)}</>}<label>Background<select value={fields.background==='transparent'?'transparent':'color'} onChange={e=>setFields({...fields,background:e.target.value==='transparent'?'transparent':'#ffffff'})}><option value="color">Color</option><option value="transparent">Transparent</option></select>{fields.background!=='transparent'&&<input aria-label="Canvas background" type="color" value={fields.background||'#ffffff'} onChange={e=>setFields({...fields,background:e.target.value})}/>}</label><p>96 pixels per inch; maximum 8192 per side. Total memory limits also apply.</p></>}
      {error&&<p role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={()=>setDialog(null)}>Cancel</button><button type="submit" disabled={busy}>{dialog==='export'?'Save':'Apply'}</button></footer>
    </form></dialog><img className="paint-print-image" alt="Canvas for printing"/>
  </section>;
}
