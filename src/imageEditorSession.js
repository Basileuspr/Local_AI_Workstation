import { MAX_EDITOR_PIXELS } from "./imageEditor";

export async function openEditorImage(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 40 * 1024 ** 2) throw new Error("Choose an image smaller than 40 MiB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  if (bitmap.width * bitmap.height > MAX_EDITOR_PIXELS) { bitmap.close(); throw new Error("Choose an image up to 24 megapixels."); }
  const worker = new Worker(new URL("./imageEditor.worker.js", import.meta.url), { type: "module" });
  let counter = 0, closed = false;
  const pending = new Map();
  function close() {
    closed = true; worker.terminate();
    for (const entry of pending.values()) entry.reject(new Error("Image closed."));
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data);
  };
  worker.onerror = () => close();
  function request(action, settings, image) {
    if (closed) return Promise.reject(new Error("Image closed. Reopen it to continue."));
    return new Promise((resolve, reject) => {
      const id = ++counter; pending.set(id, { resolve, reject });
      worker.postMessage({ id, action, settings, bitmap: image }, image ? [image] : []);
    });
  }
  try { return { ...(await request("load", null, bitmap)), request, close, name: file.name }; }
  catch (error) { close(); bitmap.close(); throw error; }
}
