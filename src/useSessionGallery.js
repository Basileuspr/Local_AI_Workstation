import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from './useStore';
import { listSessionImages } from './api';
import { sharedPollingObserver } from './polling';

const observer = () => sharedPollingObserver('session-gallery', {
  read: async ({signal}) => ({value: await listSessionImages(false, {signal})}),
  interval: (_value, {failures}) => failures ? 5000 : 30000,
});

// Visibility includes side panes. Invalidation during a read discards its stale
// response and schedules a fresh read; it never cancels generation or chat work.
export default function useSessionGallery(active) {
  const dispatch = useDispatch();
  const [error, setError] = useState('');
  const refresh = useCallback(() => observer().invalidate(), []);
  useEffect(() => {
    if (!active) return;
    return observer().subscribe({
      data: images => { dispatch({type: 'SET_SESSION_IMAGES', payload: images}); setError(''); },
      error: () => setError('Chat images could not be refreshed. Showing the last loaded images; reconnecting…'),
    });
  }, [active, dispatch]);
  useEffect(() => {
    const storage = event => { if (event.key === 'image-library-revision') refresh(); };
    window.addEventListener('image-library-changed', refresh);
    window.addEventListener('storage', storage);
    return () => { window.removeEventListener('image-library-changed', refresh); window.removeEventListener('storage', storage); };
  }, [refresh]);
  return {error, refresh};
}
