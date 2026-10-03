import { createMessageId } from './messageIds';
import { getCanvas } from './canvasStore';
import { drawCanvas } from './canvasDrawing';
import { paintDimensions, paintRect, floodPaint, hexRGBA, removePaintColor } from './paintPixels';
import { readPaintDraft, writePaintDraft } from './paintPersistence';

const HISTORY_BYTES = 128 * 1024 * 1024;
export function paintSurface(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
function cloneSurface(source) { const canvas = paintSurface(source.width, source.height); canvas.getContext('2d').drawImage(source, 0, 0); return canvas; }
function layer(width, height, name = 'Layer 1') { return { id: createMessageId(), name, visible: true, opacity: 100, canvas: paintSurface(width, height) }; }
export function validatePaintProject(value) {
  if (!value || value.format !== 'law-paint' || value.version !== 1 || !Array.isArray(value.layers)) throw Error('This is not a supported Canvas project.');
  paintDimensions(value.width, value.height, value.layers.length);
  if (value.background !== 'transparent' && !/^#[a-f0-9]{6}$/i.test(value.background)) throw Error('Invalid project background.');
  const ids = new Set(); let size = 0;
  for (const item of value.layers) {
    if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || ids.has(item.id) || typeof item.name !== 'string' || item.name.length > 100 || typeof item.visible !== 'boolean' || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 100)
      throw Error('Invalid project layer.');
    ids.add(item.id);
    if (typeof item.png !== 'string' || !/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(item.png)) throw Error('Project layers must be embedded PNG images.');
    // Check IHDR before decoding to reject huge images disguised as small layers.
    const header = atob(item.png.slice(22, 66));
    if (header.length < 24 || header.slice(1, 4) !== 'PNG' || header.slice(12, 16) !== 'IHDR') throw Error('Invalid layer PNG.');
    const dimension = start => [0, 1, 2, 3].reduce((n, i) => n * 256 + header.charCodeAt(start + i), 0);
    if (dimension(16) !== value.width || dimension(20) !== value.height) throw Error('Project layer dimensions do not match the canvas.');
    size += item.png.length;
    if (size > 128 * 1024 * 1024) throw Error('The project is larger than 128 MB.');
  }
  if (!ids.has(value.activeLayerId)) throw Error('Invalid active layer.');
  if (typeof value.name !== 'string' || value.name.length > 180) throw Error('Invalid project name.');
  return value;
}
export async function decodePaintProject(value) {
  validatePaintProject(value);
  const layers = [];
  for (const item of value.layers) {
    const image = new Image(); image.src = item.png;
    try { await image.decode(); } catch { throw Error('A project layer could not be decoded.'); }
    if (image.naturalWidth !== value.width || image.naturalHeight !== value.height) throw Error('Invalid layer dimensions.');
    const canvas = paintSurface(value.width, value.height); canvas.getContext('2d').drawImage(image, 0, 0);
    layers.push({ id: item.id, name: item.name, visible: item.visible, opacity: item.opacity, canvas });
  }
  return { width: value.width, height: value.height, background: value.background, name: value.name, activeLayerId: value.activeLayerId, layers };
}

export class PaintDocument {
  constructor() {
    this.listeners = new Set(); this.past = []; this.future = []; this.selection = null;
    const first = layer(1200, 800);
    this.doc = { width: 1200, height: 800, background: '#ffffff', name: 'Untitled', layers: [first], activeLayerId: first.id };
    this.revision = createMessageId(); this.savedRevision = this.revision; this.ready = false; this.file = null;
    this.draftStatus = 'Restoring draft…'; this.error = ''; this.saveQueue = Promise.resolve(); this.publish();
  }
  subscribe = listener => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = () => this.state;
  publish() {
    this.state = { ...this.doc, revision: this.revision, ready: this.ready, selection: this.selection,
      dirty: this.revision !== this.savedRevision, canUndo: !!this.past.length, canRedo: !!this.future.length,
      undoLabel: this.past.at(-1)?.label || '', redoLabel: this.future.at(-1)?.label || '', draftStatus: this.draftStatus, error: this.error };
    this.listeners.forEach(listener => listener());
  }
  async initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = (async () => {
      try {
        const draft = await readPaintDraft();
        if (draft) { this.doc = await decodePaintProject(draft); this.draftStatus = 'Draft restored'; this.savedRevision = ''; }
        else {
          const legacy = getCanvas();
          if (legacy.objects.length) {
            drawCanvas(this.doc.layers[0].canvas.getContext('2d'), legacy.objects);
            this.doc.layers[0].name = 'Previous Canvas'; this.draftStatus = 'Previous Canvas imported'; this.savedRevision = '';
          } else this.draftStatus = 'Local draft ready';
        }
      } catch (error) {
        this.error = error.message; this.draftStatus = 'Draft recovery failed'; this.autosaveBlocked = true;
      }
      this.ready = true; this.publish();
      if (!this.autosaveBlocked) this.scheduleSave();
    })();
    return this.initializing;
  }
  currentLayer() { return this.doc.layers.find(item => item.id === this.doc.activeLayerId); }
  requireEditable() { if (!this.ready) throw Error('Wait for the Canvas draft to finish restoring.'); if (!this.currentLayer().visible) throw Error('Show the active layer before drawing on it.'); }
  checkpoint(label) { return { label, doc: { ...this.doc, layers: this.doc.layers.map(item => ({ ...item, canvas: cloneSurface(item.canvas) })) }, revision: this.revision }; }
  trimHistory() {
    const bytes = entry => entry.doc.width * entry.doc.height * entry.doc.layers.length * 4;
    while (this.past.length > 30 || (this.past.length > 1 && [...this.past, ...this.future].reduce((total, item) => total + bytes(item), 0) > HISTORY_BYTES)) this.past.shift();
    while (this.future.length > 1 && [...this.past, ...this.future].reduce((total, item) => total + bytes(item), 0) > HISTORY_BYTES) this.future.shift();
  }
  transact(label, action) {
    if (!this.ready) throw Error('Wait for the Canvas draft to finish restoring.');
    const before = this.checkpoint(label), selection = this.selection;
    try {
      if (action() === false) return false;
      paintDimensions(this.doc.width, this.doc.height, this.doc.layers.length);
    } catch (error) { this.doc = before.doc; this.selection = selection; this.publish(); throw error; }
    this.past.push(before); this.future = []; this.trimHistory(); this.revision = createMessageId(); this.error = '';
    this.publish(); this.scheduleSave(); return true;
  }
  undo() {
    if (!this.past.length) return;
    const next = this.past.pop(); this.future.push(this.checkpoint(next.label)); this.doc = next.doc; this.revision = createMessageId(); this.selection = null;
    this.trimHistory(); this.publish(); this.scheduleSave();
  }
  redo() {
    if (!this.future.length) return;
    const next = this.future.pop(); this.past.push(this.checkpoint(next.label)); this.doc = next.doc; this.revision = createMessageId(); this.selection = null;
    this.trimHistory(); this.publish(); this.scheduleSave();
  }
  serialize() {
    return { format: 'law-paint', version: 1, width: this.doc.width, height: this.doc.height, name: this.doc.name, background: this.doc.background,
      activeLayerId: this.doc.activeLayerId, layers: this.doc.layers.map(({ canvas, ...item }) => ({ ...item, png: canvas.toDataURL('image/png') })) };
  }
  scheduleSave() {
    if (this.autosaveBlocked) return;
    clearTimeout(this.saveTimer); this.draftStatus = 'Saving draft…'; this.publish();
    this.saveTimer = setTimeout(() => { this.flushDraft(); }, 600);
  }
  flushDraft() {
    clearTimeout(this.saveTimer);
    if (!this.ready || this.autosaveBlocked) return this.saveQueue;
    const revision = this.revision;
    let snapshot;
    try { snapshot = this.serialize(); } catch (error) { this.error = error.message; this.publish(); return this.saveQueue; }
    this.saveQueue = this.saveQueue.catch(() => {}).then(() => writePaintDraft(snapshot)).then(() => {
      if (revision === this.revision) { this.draftStatus = 'Draft saved locally'; this.publish(); }
    }).catch(error => { this.error = error.message; this.draftStatus = 'Draft save failed'; this.publish(); });
    return this.saveQueue;
  }
  composite({ white = false, preview = null, omitLayer = null } = {}) {
    const canvas = paintSurface(this.doc.width, this.doc.height), ctx = canvas.getContext('2d');
    if (white || this.doc.background !== 'transparent') { ctx.fillStyle = white && this.doc.background === 'transparent' ? '#ffffff' : this.doc.background; ctx.fillRect(0, 0, canvas.width, canvas.height); }
    for (const item of this.doc.layers) {
      if (!item.visible) continue;
      ctx.save(); ctx.globalAlpha = item.opacity / 100;
      if (item.id !== omitLayer) ctx.drawImage(item.canvas, 0, 0);
      if (preview && item.id === this.doc.activeLayerId) ctx.drawImage(preview, 0, 0);
      ctx.restore();
    }
    return canvas;
  }
  setActive(id) { if (!this.doc.layers.some(item => item.id === id)) return; this.doc = { ...this.doc, activeLayerId: id }; this.selection = null; this.publish(); this.scheduleSave(); }
  editLayer(id, changes) {
    this.transact('Layer settings', () => {
      this.doc.layers = this.doc.layers.map(item => item.id === id ? { ...item,
        ...(typeof changes.name === 'string' ? { name: changes.name.trim().slice(0, 100) || 'Layer' } : {}),
        ...(typeof changes.visible === 'boolean' ? { visible: changes.visible } : {}),
        ...(Number.isFinite(changes.opacity) ? { opacity: Math.max(0, Math.min(100, changes.opacity)) } : {}) } : item);
    });
  }
  addLayer(duplicate = false) {
    this.transact(duplicate ? 'Duplicate layer' : 'Add layer', () => {
      paintDimensions(this.doc.width, this.doc.height, this.doc.layers.length + 1);
      const item = layer(this.doc.width, this.doc.height, duplicate ? `${this.currentLayer().name} copy`.slice(0, 100) : `Layer ${this.doc.layers.length + 1}`);
      if (duplicate) item.canvas.getContext('2d').drawImage(this.currentLayer().canvas, 0, 0);
      const position = this.doc.layers.findIndex(item => item.id === this.doc.activeLayerId) + 1;
      this.doc.layers.splice(position, 0, item); this.doc.activeLayerId = item.id; this.selection = null;
    });
  }
  removeLayer() {
    if (this.doc.layers.length === 1) throw Error('Keep at least one layer. Use Clear layer to erase it.');
    this.transact('Delete layer', () => { const position = this.doc.layers.findIndex(item => item.id === this.doc.activeLayerId); this.doc.layers.splice(position, 1); this.doc.activeLayerId = this.doc.layers[Math.max(0, position - 1)].id; this.selection = null; });
  }
  reorderLayer(direction) {
    const index = this.doc.layers.findIndex(item => item.id === this.doc.activeLayerId), next = index + direction;
    if (next < 0 || next >= this.doc.layers.length) return;
    this.transact('Reorder layer', () => { [this.doc.layers[index], this.doc.layers[next]] = [this.doc.layers[next], this.doc.layers[index]]; });
  }
  mergeDown() {
    const index = this.doc.layers.findIndex(item => item.id === this.doc.activeLayerId);
    if (!index) return;
    if (!this.doc.layers[index].visible || !this.doc.layers[index - 1].visible) throw Error('Show both layers before merging them.');
    this.transact('Merge layers', () => {
      const below = this.doc.layers[index - 1], above = this.doc.layers[index], canvas = paintSurface(this.doc.width, this.doc.height), ctx = canvas.getContext('2d');
      ctx.globalAlpha = below.opacity / 100; ctx.drawImage(below.canvas, 0, 0); ctx.globalAlpha = above.opacity / 100; ctx.drawImage(above.canvas, 0, 0);
      below.canvas = canvas; below.opacity = 100; this.doc.layers.splice(index, 1); this.doc.activeLayerId = below.id; this.selection = null;
    });
  }
  paint(label, source, erase = false) {
    this.requireEditable();
    this.transact(label, () => {
      const ctx = this.currentLayer().canvas.getContext('2d'); ctx.save();
      if (this.selection) { ctx.beginPath(); ctx.rect(this.selection.rect.x, this.selection.rect.y, this.selection.rect.width, this.selection.rect.height); ctx.clip(); }
      if (erase) ctx.globalCompositeOperation = 'destination-out';
      // A mask keeps free-form / inverted selections exact for every pixel tool.
      const actual = this.selection ? cloneSurface(source) : source;
      if (this.selection) { const c = actual.getContext('2d'); c.globalCompositeOperation = 'destination-in'; c.drawImage(this.selection.mask, 0, 0); }
      ctx.drawImage(actual, 0, 0); ctx.restore();
    });
  }
  fill(x, y, color, opacity, tolerance) {
    this.requireEditable();
    this.transact('Fill', () => {
      const ctx = this.currentLayer().canvas.getContext('2d'), pixels = ctx.getImageData(0, 0, this.doc.width, this.doc.height);
      const mask = this.selection?.mask.getContext('2d').getImageData(0, 0, this.doc.width, this.doc.height).data;
      if (!floodPaint(pixels, x, y, hexRGBA(color, opacity), tolerance, mask)) return false;
      ctx.putImageData(pixels, 0, 0);
    });
  }
  pick(x, y) {
    const pixels = this.composite({ white: true }).getContext('2d').getImageData(Math.min(this.doc.width - 1, Math.max(0, Math.floor(x))), Math.min(this.doc.height - 1, Math.max(0, Math.floor(y))), 1, 1).data;
    return '#' + [...pixels.slice(0, 3)].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  select(rect, points = null) {
    if (!rect?.width || !rect?.height) { this.selection = null; this.publish(); return; }
    const mask = paintSurface(this.doc.width, this.doc.height), ctx = mask.getContext('2d'); ctx.fillStyle = '#ffffff';
    if (points?.length >= 3) { ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.fill(); }
    else ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.selection = { rect, mask, points }; this.publish();
  }
  selectAll() { this.select({ x: 0, y: 0, width: this.doc.width, height: this.doc.height }); }
  invertSelection() {
    if (!this.selection) return this.selectAll();
    const mask = paintSurface(this.doc.width, this.doc.height), ctx = mask.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(this.selection.mask, 0, 0);
    this.selection = { rect: { x: 0, y: 0, width: mask.width, height: mask.height }, mask, inverse: true }; this.publish();
  }
  selectionSurface(transparentColor = null) {
    if (!this.selection) return this.composite();
    const { rect, mask } = this.selection, canvas = paintSurface(rect.width, rect.height), ctx = canvas.getContext('2d');
    ctx.drawImage(this.currentLayer().canvas, -rect.x, -rect.y); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, -rect.x, -rect.y);
    if (transparentColor) ctx.putImageData(removePaintColor(ctx.getImageData(0, 0, canvas.width, canvas.height), transparentColor), 0, 0);
    return canvas;
  }
  clearSelection() {
    this.requireEditable();
    this.transact(this.selection ? 'Delete selection' : 'Clear layer', () => {
      const ctx = this.currentLayer().canvas.getContext('2d');
      if (this.selection) { ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(this.selection.mask, 0, 0); ctx.restore(); }
      else ctx.clearRect(0, 0, this.doc.width, this.doc.height);
    });
  }
  selectionPreview(target, transparentColor = null, transformed = null) {
    const { rect, mask } = this.selection, source = transformed || this.selectionSurface(transparentColor), canvas = cloneSurface(this.currentLayer().canvas), ctx = canvas.getContext('2d');
    ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mask, 0, 0); ctx.restore();
    ctx.imageSmoothingEnabled = false; ctx.drawImage(source, target.x, target.y, target.width, target.height);
    const nextMask = paintSurface(this.doc.width, this.doc.height), c = nextMask.getContext('2d');
    if (transformed) { c.fillStyle = '#ffffff'; c.fillRect(target.x, target.y, target.width, target.height); }
    else c.drawImage(mask, rect.x, rect.y, rect.width, rect.height, target.x, target.y, target.width, target.height);
    return { canvas, selection: { rect: paintRect(target, { x: target.x + target.width, y: target.y + target.height }, this.doc.width, this.doc.height), mask: nextMask } };
  }
  moveSelection(target, transparentColor = null, transformed = null) {
    this.requireEditable(); if (!this.selection) return;
    const next = this.selectionPreview(target, transparentColor, transformed);
    this.transact('Move / resize selection', () => { this.currentLayer().canvas = next.canvas; this.selection = next.selection.rect.width && next.selection.rect.height ? next.selection : null; });
  }
  crop() {
    if (!this.selection) throw Error('Select the area to keep before cropping.');
    const { rect, mask } = this.selection;
    this.transact('Crop image', () => {
      this.doc.layers = this.doc.layers.map(item => {
        const canvas = paintSurface(rect.width, rect.height), ctx = canvas.getContext('2d'); ctx.drawImage(item.canvas, -rect.x, -rect.y);
        ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, -rect.x, -rect.y); return { ...item, canvas };
      });
      this.doc.width = rect.width; this.doc.height = rect.height; this.selection = null;
    });
  }
  resizeRaw(width, height, scale = false, smooth = true, skewX = 0, skewY = 0) {
    const tx = Math.tan(skewX * Math.PI / 180), ty = Math.tan(skewY * Math.PI / 180);
    const targetWidth = Math.ceil(width + Math.abs(tx) * height), targetHeight = Math.ceil(height + Math.abs(ty) * width);
    paintDimensions(targetWidth, targetHeight, this.doc.layers.length);
    if (!Number.isFinite(tx) || !Number.isFinite(ty) || Math.abs(skewX) > 80 || Math.abs(skewY) > 80 || Math.abs(1 - tx * ty) < .01) throw Error('Use skew angles between -80° and 80° that preserve an image area.');
    this.doc.layers = this.doc.layers.map(item => {
      const canvas = paintSurface(targetWidth, targetHeight), ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = smooth;
      ctx.setTransform(1, ty, tx, 1, tx < 0 ? -tx * height : 0, ty < 0 ? -ty * width : 0);
      if (scale) ctx.drawImage(item.canvas, 0, 0, width, height); else ctx.drawImage(item.canvas, 0, 0);
      return { ...item, canvas };
    });
    this.doc.width = targetWidth; this.doc.height = targetHeight; this.selection = null;
  }
  resize(width, height, options = {}) {
    paintDimensions(width, height, this.doc.layers.length);
    this.transact(options.scale ? 'Resize / skew image' : 'Canvas properties', () => {
      this.resizeRaw(width, height, options.scale, options.smooth, options.skewX || 0, options.skewY || 0);
      if (options.background) this.doc.background = options.background;
    });
  }
  transform(angle = 0, flip = null) {
    const rotate = source => {
      const swap = Math.abs(angle) % 180 === 90, canvas = paintSurface(swap ? source.height : source.width, swap ? source.width : source.height), ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2); ctx.rotate(angle * Math.PI / 180); ctx.scale(flip === 'horizontal' ? -1 : 1, flip === 'vertical' ? -1 : 1);
      ctx.drawImage(source, -source.width / 2, -source.height / 2); return canvas;
    };
    if (this.selection) {
      const canvas = rotate(this.selectionSurface()), rect = this.selection.rect;
      this.moveSelection({ ...rect, width: canvas.width, height: canvas.height }, null, canvas); return;
    }
    this.transact(flip ? 'Flip image' : 'Rotate image', () => {
      this.doc.layers = this.doc.layers.map(item => ({ ...item, canvas: rotate(item.canvas) }));
      this.doc.width = this.doc.layers[0].canvas.width; this.doc.height = this.doc.layers[0].canvas.height;
    });
  }
  importImage(image, name, replace = false) {
    paintDimensions(image.width, image.height);
    this.transact(replace ? 'Open image' : 'Import image', () => {
      if (replace) {
        const first = layer(image.width, image.height, 'Image'); first.canvas.getContext('2d').drawImage(image, 0, 0);
        this.doc = { width: image.width, height: image.height, name: name.slice(0, 180), background: 'transparent', layers: [first], activeLayerId: first.id }; this.selection = null; this.file = null;
      } else {
        const width = Math.max(this.doc.width, image.width), height = Math.max(this.doc.height, image.height);
        paintDimensions(width, height, this.doc.layers.length + 1);
        if (width !== this.doc.width || height !== this.doc.height) this.resizeRaw(width, height);
        const imported = layer(width, height, name.slice(0, 100)); imported.canvas.getContext('2d').drawImage(image, 0, 0);
        this.doc.layers.push(imported); this.doc.activeLayerId = imported.id;
        this.select({ x: 0, y: 0, width: image.width, height: image.height });
      }
      this.autosaveBlocked = false;
    });
  }
  newDocument(width, height, background) {
    paintDimensions(width, height);
    this.transact('New image', () => { const first = layer(width, height); this.doc = { width, height, background, name: 'Untitled', layers: [first], activeLayerId: first.id }; this.selection = null; this.file = null; this.autosaveBlocked = false; });
  }
  async openProject(value) {
    const next = await decodePaintProject(value);
    this.transact('Open project', () => { this.doc = next; this.selection = null; this.file = null; this.autosaveBlocked = false; });
  }
  markSaved(revision, file) {
    this.file = file;
    if (revision === this.revision) { this.savedRevision = revision; this.doc = { ...this.doc, name: file.name || this.doc.name }; }
    this.publish(); this.scheduleSave();
  }
}
let shared;
export function getPaintDocument() {
  if (!shared) {
    shared = new PaintDocument();
    window.addEventListener('pagehide', () => shared.flushDraft());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') shared.flushDraft(); });
  }
  return shared;
}
export function paintCanvasInUse() { return !!shared; }
