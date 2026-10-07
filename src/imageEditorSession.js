import { MAX_EDITOR_PIXELS } from "./imageEditor";

export async function openEditorImage(file) {
  if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type)) throw new Error("Choose a PNG, JPEG, or WebP image.");
  if (file.size > 40 * 1024 ** 2) throw new Error("Choose an image smaller than 40 MiB.");
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  if (bitmap.width * bitmap.height > MAX_EDITOR_PIXELS) { bitmap.close(); throw new Error("Choose an image up to 24 megapixels."); }
  let worker;
  try { worker = new Worker(new URL("./imageEditor.worker.js", import.meta.url), { type: "module" }); }
  catch (error) { bitmap.close(); throw error; }
  let counter = 0, closed = false;
  const pending = new Map();
  function close(reason = new Error("Image closed.")) {
    if (closed) return;
    closed = true; worker.terminate();
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(reason); }
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(data.error)); else entry.resolve(data);
  };
  worker.onerror = () => close(new Error("Image worker failed. Reopen the image to continue."));
  worker.onmessageerror = () => close(new Error("Image worker response could not be read. Reopen the image to continue."));
  function request(action, settings, image) {
    if (closed) return Promise.reject(new Error("Image closed. Reopen it to continue."));
    return new Promise((resolve, reject) => {
      const id = ++counter;
      const timer = setTimeout(() => close(new Error("Image processing timed out. Reopen the image to retry.")), 120000);
      pending.set(id, { resolve, reject, timer });
      try { worker.postMessage({ id, action, settings, bitmap: image }, image ? [image] : []); }
      catch (error) { close(error); }
    });
  }
  try { return { ...(await request("load", null, bitmap)), request, close, name: file.name }; }
  catch (error) { close(); bitmap.close(); throw error; }
}
