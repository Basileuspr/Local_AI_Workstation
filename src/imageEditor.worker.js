import { adjustPixels, MAX_EDITOR_PIXELS } from "./imageEditor";
import { colorRegion } from "./imageEditorColors";

let original, preview, previewPixels;
self.onmessage = async ({ data: { id, action, bitmap, settings } }) => {
  try {
    if (action === "load") {
      const { width, height } = bitmap;
      if (width * height > MAX_EDITOR_PIXELS) { bitmap.close(); throw new Error("Choose an image up to 24 megapixels."); }
      original = new OffscreenCanvas(width, height);
      original.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
      bitmap.close();
      const scale = Math.min(1, 1400 / Math.max(width, height));
      preview = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
      const context = preview.getContext("2d", { willReadFrequently: true });
      context.imageSmoothingQuality = "high";
      context.drawImage(original, 0, 0, preview.width, preview.height);
      previewPixels = context.getImageData(0, 0, preview.width, preview.height);
      self.postMessage({ id, width, height, blob: await preview.convertToBlob({ type: "image/png" }) });
      return;
    }
    if (!original) throw new Error("Open an image first.");
    if (action === "original") {
      self.postMessage({id, width:original.width, height:original.height, blob:await original.convertToBlob({type:"image/png"})});
      return;
    }
    const full = [settings, ...(settings?.stages || [])].some(p => p?.sharpness || p?.clarity || p?.deblur || p?.refinement) || action === "export" || action === "inspect" || settings?.colorEdits?.length || settings?.stages?.some(pass => pass.colorEdits?.length);
    const source = full ? original.getContext("2d").getImageData(0, 0, original.width, original.height) : previewPixels;
    let pixels = source;
    let output;
    for (const pass of [...(settings?.stages || []), settings || {}]) {
      const canvas = new OffscreenCanvas(pixels.width, pixels.height);
      canvas.getContext("2d").putImageData(new ImageData(adjustPixels(pixels.data, pass, pixels.width, pixels.height), pixels.width, pixels.height), 0, 0);
      const angle = ((Math.round((pass.rotation || 0) / 90) % 4 + 4) % 4) * 90;
      output = new OffscreenCanvas(angle % 180 ? canvas.height : canvas.width, angle % 180 ? canvas.width : canvas.height);
      const context = output.getContext("2d", { willReadFrequently: true });
      context.translate(output.width / 2, output.height / 2);
      context.rotate(angle * Math.PI / 180);
      context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      pixels = context.getImageData(0, 0, output.width, output.height);
      // Named samples find their areas against the same pass source, so another
      // sample cannot merge or split a fill by changing its boundary colors.
      const areaSource = pixels.data;
      for (const edit of pass.colorEdits || []) pixels = new ImageData(colorRegion(pixels.data, pixels.width, pixels.height, edit, edit.sampleId ? areaSource : pixels.data), pixels.width, pixels.height);
      context.putImageData(pixels, 0, 0);
    }
    const width=output.width,height=output.height;
    if(action!=="export" && action!=="inspect" && Math.max(width,height)>1400){
      const scale=1400/Math.max(width,height),small=new OffscreenCanvas(Math.round(width*scale),Math.round(height*scale));
      const context=small.getContext('2d');context.imageSmoothingQuality='high';context.drawImage(output,0,0,small.width,small.height);output=small;
    }
    self.postMessage({ id, width, height, blob: await output.convertToBlob({ type: "image/png" }) });
  } catch (error) { self.postMessage({ id, error: error.message || "Could not process this image." }); }
};
