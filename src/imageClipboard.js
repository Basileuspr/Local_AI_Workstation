export function blobDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(blob);
  });
}

export async function copyImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Could not load this image for copying.");
  const blob = await response.blob();
  if (!blob.type.startsWith("image/") || blob.size > 48 * 1024 * 1024) throw new Error("The image cannot be copied (invalid format or larger than 48 MB).");
  if (window.workstationDesktop?.copyImage) {
    const result = await window.workstationDesktop.copyImage(await blobDataUrl(blob));
    if (result?.error) throw new Error(result.error);
    return result;
  }
  if (!navigator.clipboard?.write || !globalThis.ClipboardItem) throw new Error("Open the desktop app to copy images.");
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d").drawImage(bitmap, 0, 0);
    const png = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("Could not prepare the clipboard image.");
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
  } finally { bitmap.close(); }
}
