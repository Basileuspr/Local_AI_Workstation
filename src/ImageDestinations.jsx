import { createContext, useContext, useRef, useState } from "react";
import { useDispatch } from "./useStore";
import { useImagePrivacy } from "./ImagePrivacy";
import { localImageUrl } from "./chatImages";
import { sourceFor } from "./imageLibraryApi";
import * as workflows from "./imageWorkflowApi";
import * as library from "./imageLibraryApi";
import FileImagesDialog from "./components/ImageFolderTools";

const Context = createContext(null);
export const useImageDestinations = () => useContext(Context);

export function ImageDestinationsProvider({ children }) {
  const dispatch = useDispatch(), privacy = useImagePrivacy(), currentPrivacy = useRef(privacy);
  currentPrivacy.current = privacy;
  const [editorInput, setEditorInput] = useState(null);
  const [filing, setFiling] = useState(null), [chatEdit, setChatEdit] = useState(null);
  const lock = useRef(false);
  async function readImage(image) {
      const url = localImageUrl(image.url);
      if (!url) throw new Error("Import this image into the app first.");
      const response = await fetch(url);
      if (!response.ok) throw new Error("This image is unavailable or locked.");
      const blob = await response.blob();
      if (!blob.type.startsWith("image/") || blob.size > 40 * 1024 ** 2) throw new Error("Choose an image smaller than 40 MiB.");
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, "0")).join("");
      if (!currentPrivacy.current.ready || currentPrivacy.current.hashes.includes(digest)) throw new Error("Unlock this image before using it elsewhere.");
      return new File([blob], image.name || "Chat image.png", { type: blob.type });
  }
  async function take(image, destination) {
    if (lock.current) throw new Error("Wait for the current image to open.");
    lock.current = true;
    try {
      const file = await readImage(image);
      if (destination === "editor") {
        setEditorInput({ file, id: crypto.randomUUID() });
        dispatch({ type: "SET_SIDEBAR_TAB", payload: "image-editor" });
      } else if (destination === "chat-edit") {
        setChatEdit({ image, file, sessionId: image.chat_session_id || image.session_id });
        window.dispatchEvent(new Event("focus-chat-edit"));
      } else if (destination === "folder" || destination === "new-folder") {
        const data = await library.list();
        setFiling({ images: [{ ...image, file }], folders: data.folders, createNew: destination === "new-folder" });
      } else {
        let workflow = await workflows.create();
        if (image.session_id || image.library || image.run) workflow = await workflows.importSource(workflow, sourceFor(image));
        else workflow = await workflows.upload(workflow, file);
        dispatch({ type: "OPEN_IMAGE_WORKFLOW", payload: workflow.id });
      }
    } finally { lock.current = false; }
  }
  return <Context.Provider value={{ take, readImage, editorInput, chatEdit, clearChatEdit: () => setChatEdit(null), consumed: id => setEditorInput(value => value?.id === id ? null : value) }}>{children}{filing && <FileImagesDialog {...filing} onClose={() => setFiling(null)} />}</Context.Provider>;
}
