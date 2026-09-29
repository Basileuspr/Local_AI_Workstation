import {useEffect, useRef, useState} from 'react';

// Decode the exported GIF itself: playback and captured thumbnails include its
// actual framing, palette and frame durations, rather than the input images.
export default function GifPlayer({blob, loop, onCapture}) {
  const canvas = useRef(null);
  const [decoder, setDecoder] = useState(null), [count, setCount] = useState(0);
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let disposed = false, instance;
    setError(''); setIndex(0); setCount(0); setDecoder(null); setReady(false); setPlaying(true);
    (async () => {
      if (!('ImageDecoder' in window)) throw new Error('GIF playback needs an updated desktop app or Chromium browser. You can still save the GIF.');
      instance = new ImageDecoder({data: await blob.arrayBuffer(), type: 'image/gif', preferAnimation: true});
      if (disposed) { instance.close(); return; }
      await instance.tracks.ready;
      if (!disposed) { setCount(instance.tracks.selectedTrack.frameCount); setDecoder(instance); }
    })().catch(failure => { if (!disposed) setError(`Could not preview the GIF: ${failure.message}`); });
    return () => { disposed = true; instance?.close(); };
  }, [blob]);
  useEffect(() => {
    if (!decoder) return;
    let disposed = false, timer;
    setReady(false);
    decoder.decode({frameIndex: index}).then(({image}) => {
      try {
        if (disposed) return;
        const node = canvas.current;
        node.width = image.displayWidth; node.height = image.displayHeight;
        node.getContext('2d').drawImage(image, 0, 0);
        setReady(true);
        if (playing) timer = setTimeout(() => {
          if (index + 1 < count) setIndex(index + 1);
          else if (loop && count > 1) setIndex(0);
          else setPlaying(false);
        }, Math.max(10, (image.duration || 100000) / 1000));
      } finally { image.close(); }
    }).catch(failure => { if (!disposed) { setError(`Could not play the GIF: ${failure.message}`); setPlaying(false); } });
    return () => { disposed = true; clearTimeout(timer); };
  }, [decoder, index, playing, count, loop]);
  function seek(value) { setPlaying(false); setIndex(Number(value)); }
  return <section className="gif-player" aria-label="GIF animation player">
    <canvas ref={canvas} aria-label="Animated GIF preview" data-frame={index + 1} role="img" />
    {error ? <p role="alert">{error}</p> : !decoder && <p role="status">Loading animation preview…</p>}
    <div className="gif-player-controls">
      <button type="button" disabled={!decoder || !!error} onClick={() => { if (!playing && index === count - 1) setIndex(0); setPlaying(value => !value); }}>{playing ? 'Pause' : 'Play'}</button>
      <button type="button" disabled={!decoder || !!error} onClick={() => { setIndex(0); setPlaying(true); }}>Restart</button>
      <label>Frame<input aria-label="GIF preview frame" type="range" min="0" max={Math.max(0,count - 1)} value={index} disabled={!decoder || !!error} onChange={event => seek(event.target.value)} /></label>
      <output>Frame {count ? index + 1 : 0} / {count}</output>
      <button type="button" disabled={!ready || !!error} onClick={() => {
        setPlaying(false);
        canvas.current.toBlob(value => { if (value) onCapture(value, index + 1); }, 'image/png');
      }}>Capture thumbnail</button>
    </div>
  </section>;
}
