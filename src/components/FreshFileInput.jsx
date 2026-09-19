import { useRef } from "react";

// Retain the native input, its ref, and existing change handlers. Browser-only
// builds use their normal chooser; desktop always opens at the fixed home folder.
export default function FreshFileInput({ ref, onClick, ...props }) {
  const opening = useRef(false);
  async function choose(event) {
    onClick?.(event);
    const picker = window.workstationDesktop?.pickUploadFiles;
    if (!picker || event.defaultPrevented) return;
    event.preventDefault();
    const input = event.currentTarget;
    if (opening.current || input.matches(":disabled")) return;
    opening.current = true;
    try {
      const result = await picker({ accept: input.accept, multiple: input.multiple });
      if (result.error) throw new Error(result.error);
      if (result.canceled || !input.isConnected) return;
      const transfer = new DataTransfer();
      for (const file of result.files) transfer.items.add(new File([file.bytes], file.name, { type: file.type, lastModified: file.lastModified }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (error) {
      window.alert(error.message || "Could not open the file chooser.");
    } finally { opening.current = false; }
  }
  return <input {...props} type="file" ref={ref} onClick={choose} />;
}
