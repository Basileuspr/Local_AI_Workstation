import {apiUrl} from './api';
export async function webSystem(path,body,method) {
  const response=await fetch(apiUrl('/web-system'+path),{method:method||(body===undefined?'GET':'POST'),
    headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/knowledge'?180000:40000)});
  const data=await response.json();if(!response.ok)throw Error(typeof data.detail==='string'?data.detail:'Check the source address, limits and configuration.');return data;
}
export const sourceDefaults={name:'',seed_url:'',enabled:true,interval_minutes:1440,allowed_domains:[],include_patterns:['*'],exclude_patterns:[],
  max_depth:1,max_pages:20,request_interval_seconds:10,policy:'monitor_only',discover_feeds:true,discover_sitemaps:true};
export function sourceFields(row) {return Object.fromEntries(Object.keys(sourceDefaults).map(k=>[k,row[k]??sourceDefaults[k]]));}
export const webTime=value=>value?new Date(value*1000).toLocaleString():'—';
