import { useCallback, useEffect, useState } from "react";
import * as api from "./imageLibraryApi";
import { sharedPollingObserver } from './polling';
import { mediaJobsObserver } from './appPolling';

const observer = () => sharedPollingObserver('image-library', {
  read: async ({signal}) => ({value: await api.list({signal})}),
  interval: (_value, {failures}) => failures ? 5000 : 30000,
});

export default function useImageLibrary(active = true, {watchMedia = false} = {}) {
  const [data, setData] = useState({ folders: [], images: [], tags: [] });
  const [error, setError] = useState("");
  const [mediaError, setMediaError] = useState('');
  const refresh = useCallback(() => observer().invalidate(), []);
  useEffect(() => {
    if (!active) return;
    const detach = observer().subscribe({
      data: value => { setData({ ...value, images: value.images.map(image => ({ ...api.imageUrl(image), library: true })) }); setError(''); },
      error: failure => setError(failure.message),
    });
    const storage = event => { if (event.key === "image-library-revision") refresh(); };
    window.addEventListener("image-library-changed", refresh); window.addEventListener("storage", storage);
    return () => { detach(); window.removeEventListener("image-library-changed", refresh); window.removeEventListener("storage", storage); };
  }, [active, refresh]);
  useEffect(() => {
    if (!active || !watchMedia) return;
    let previous;
    return mediaJobsObserver().subscribe({data: value => {
      const completed = JSON.stringify(value.jobs.filter(job => job.kind === 'image' && job.status === 'completed' && job.url).map(job => job.id).sort());
      if (completed !== previous) { previous = completed; refresh(); }
      setMediaError('');
    }, recovered: () => setMediaError(''), error: () => setMediaError('Generation updates are unavailable. Gallery will retry automatically.')});
  }, [active, watchMedia, refresh]);
  return { ...data, error: error || mediaError, refresh };
}
