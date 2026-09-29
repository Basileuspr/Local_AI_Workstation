import {renderGifThumbnail} from './gifMaker';

export function thumbnailKey(frame, options) {
  return JSON.stringify([frame.hash || frame.id, options.mode || 'framed', options.width, options.height, options.fit, options.background, options.maxSide ?? 320]);
}

// Cache compressed previews, never full decoded bitmaps. Obsolete queued jobs
// are skipped and active decodes always close their bitmap in the renderer.
export function createGifThumbnailCache({render = renderGifThumbnail, concurrency = 2, maxBytes = 32 * 1024 ** 2, maxEntries = 128} = {}) {
  const entries = new Map(), queue = [];
  let active = 0;
  const canceled = () => new DOMException('Thumbnail no longer needed.', 'AbortError');
  function trim() {
    let bytes = [...entries.values()].reduce((sum, entry)=>sum+(entry.result?.blob.size || 0),0);
    for (const [key,entry] of entries) {
      if (bytes <= maxBytes && entries.size <= maxEntries) break;
      if (entry.result || entry.error) { bytes -= entry.result?.blob.size || 0; entries.delete(key); }
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      if (entries.get(job.key) !== job.entry) { job.reject(canceled()); continue; }
      active++;
      Promise.resolve().then(()=>render(job.frame.file,job.options)).then(result=>{
        if (entries.get(job.key) !== job.entry) throw canceled();
        job.entry.result = result; trim(); job.resolve(result);
      }).catch(error=>{job.entry.error = error; job.reject(error);}).finally(()=>{active--; pump();});
    }
  }
  return {
    get(frame, options) {
      const key = thumbnailKey(frame,options);
      if (entries.has(key)) return entries.get(key).promise;
      const entry = {};
      entries.set(key,entry);
      entry.promise = new Promise((resolve,reject)=>queue.push({key,entry,frame,options:{...options},resolve,reject}));
      pump(); return entry.promise;
    },
    peek(frame, options) { return entries.get(thumbnailKey(frame,options))?.result; },
    invalidate(frame) { for (const key of entries.keys()) if (JSON.parse(key)[0] === (frame.hash || frame.id)) entries.delete(key); },
    retain(frames, options) {
      const wanted = new Set(frames.map(frame=>thumbnailKey(frame,options)));
      for (const key of entries.keys()) if (!wanted.has(key)) entries.delete(key);
    },
    clear() { entries.clear(); },
  };
}
