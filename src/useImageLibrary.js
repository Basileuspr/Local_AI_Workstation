import { useCallback, useEffect, useState } from "react";
import * as api from "./imageLibraryApi";

export default function useImageLibrary(active = true) {
  const [data, setData] = useState({ folders: [], images: [], tags: [] });
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const value = await api.list();
      setData({ ...value, images: value.images.map(image => ({ ...api.imageUrl(image), library: true })) }); setError("");
    } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => {
    if (!active) return;
    refresh();
    const storage = event => { if (event.key === "image-library-revision") refresh(); };
    window.addEventListener("image-library-changed", refresh); window.addEventListener("storage", storage);
    return () => { window.removeEventListener("image-library-changed", refresh); window.removeEventListener("storage", storage); };
  }, [active, refresh]);
  return { ...data, error, refresh };
}
