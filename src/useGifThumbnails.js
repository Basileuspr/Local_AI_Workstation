import {useEffect, useRef, useState} from 'react';
import {createGifThumbnailCache, thumbnailKey} from './gifThumbnailCache';

export function useGifThumbnails(frames, options, enabled) {
  const cacheRef = useRef(null);
  if (!cacheRef.current) cacheRef.current = createGifThumbnailCache();
  const cache = cacheRef.current;
  const [items,setItems] = useState({}), [revision,setRevision] = useState(0);
  const key = JSON.stringify(options);
  useEffect(()=>{
    if (!enabled) { cache.clear(); setItems({}); return; }
    let canceled = false;
    cache.retain(frames, options);
    const initial = Object.fromEntries(frames.map(frame=>{
      const result = cache.peek(frame,options);
      return [frame.id,{status:result?'ready':'loading',result,key:thumbnailKey(frame,options)}];
    }));
    setItems(initial);
    for (const frame of frames) cache.get(frame,options).then(result=>{
      if (!canceled) setItems(current=>({...current,[frame.id]:{status:'ready',result,key:thumbnailKey(frame,options)}}));
    }).catch(error=>{
      if (!canceled && error.name !== 'AbortError') setItems(current=>({...current,[frame.id]:{status:'error',error:error.message,key:thumbnailKey(frame,options)}}));
    });
    return ()=>{canceled=true;};
  },[frames,key,enabled,revision,cache]);
  useEffect(()=>()=>cache.clear(),[cache]);
  const current = Object.fromEntries(frames.map(frame=>[frame.id,items[frame.id]?.key===thumbnailKey(frame,options)?items[frame.id]:{status:'loading'}]));
  return {items:current,cache,retry:frame=>{cache.invalidate(frame);setRevision(value=>value+1);}};
}
