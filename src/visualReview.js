import {apiUrl} from './api';
export async function reviewRequest(path, body) {
  const response=await fetch(apiUrl(`/visual-review${path}`),{method:body===undefined?'GET':'POST',cache:'no-store',
    ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(typeof error.detail==='string'?error.detail:'Review request failed.');}
  return path==='/export'?response.blob():response.json();
}
export function reviewImageUrl(source,id,full=false){
  return apiUrl(source==='library'?`/image-library/images/${encodeURIComponent(id)}/content`:`/image-manager/images/${encodeURIComponent(id)}/${full?'file':'thumbnail?large=true'}`);
}
