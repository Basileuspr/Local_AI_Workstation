import {useEffect,useState} from 'react';
import ProtectedImage from '../ImagePrivacy';

export default function GifFrameThumbnail({frame,index,item,blocked,onOpen,onRetry}) {
  const [source,setSource] = useState(null), [failed,setFailed] = useState(false);
  const blob = item?.result?.blob;
  useEffect(()=>{
    setFailed(false);
    if (!blob) {setSource(null);return;}
    const url = URL.createObjectURL(blob); setSource({url,blob});
    return ()=>URL.revokeObjectURL(url);
  },[blob]);
  const ready = item?.status==='ready' && source?.blob===blob && !failed;
  return <>
    <button type="button" className="gif-frame-preview" disabled={blocked || !ready} aria-label={`View frame ${index+1}: ${frame.file.name}`} onClick={onOpen}>
      {blocked ? <span>Locked image</span> : ready ? <ProtectedImage src={source.url} alt={`Frame ${index+1}: ${frame.file.name}`} rotateView={false} onError={()=>setFailed(true)} /> : <span>{item?.status==='error' || failed ? 'Thumbnail unavailable' : 'Building thumbnail…'}</span>}
    </button>
    {!blocked && (item?.status==='error' || failed) && <div className="gif-thumbnail-error"><span role="alert">{item.error || 'The thumbnail could not be displayed.'}</span><button type="button" aria-label={`Retry thumbnail for frame ${index+1}`} onClick={()=>{setFailed(false);onRetry();}}>Retry thumbnail</button></div>}
    {item?.result && <small className="gif-frame-dimensions">{item.result.sourceWidth} × {item.result.sourceHeight} source</small>}
  </>;
}
