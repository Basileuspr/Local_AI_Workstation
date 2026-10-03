const DB_NAME = 'local-ai-workstation-paint';
let opening;
export function openPaintDB() {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('documents');
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); opening = null; }; resolve(db); };
    request.onerror = () => { opening = null; reject(Error('Local draft storage is unavailable. Save a project file to keep your artwork.')); };
    request.onblocked = () => { opening = null; reject(Error('Close the other app window before restoring the Canvas draft.')); };
  });
  return opening;
}
export async function readPaintDraft() {
  const db = await openPaintDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction('documents').objectStore('documents').get('draft');
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(Error('The Canvas draft could not be read.'));
  });
}
export async function writePaintDraft(document) {
  const db = await openPaintDB();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('documents', 'readwrite');
    transaction.objectStore('documents').put(document, 'draft');
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(Error('Canvas could not save its local draft. Save a project file to keep your artwork.'));
  });
}

export const defaultPaintView = { rulers: false, grid: false, status: true, thumbnail: false, layers: false, autoHide: false, theme: 'app', pixelated: true, pressure: false };
export function readPaintView() {
  try {
    const saved = JSON.parse(localStorage.getItem('law-paint-view')) || {};
    return Object.fromEntries(Object.entries(defaultPaintView).map(([key, value]) => [key, key === 'theme' ? (['app', 'light', 'dark'].includes(saved[key]) ? saved[key] : value) : (typeof saved[key] === 'boolean' ? saved[key] : value)]));
  } catch { return { ...defaultPaintView }; }
}
export function writePaintView(view) { localStorage.setItem('law-paint-view', JSON.stringify(view)); }
