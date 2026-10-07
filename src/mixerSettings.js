export const mixerChannels = [
  {id:'speech', name:'Speech', detail:'Chat read-aloud & generated voices', color:'#a78bfa'},
  {id:'audio', name:'Audio', detail:'Audio workspace & voice previews', color:'#60a5fa'},
  {id:'video', name:'Video', detail:'Local videos & review previews', color:'#34d399'},
  {id:'alerts', name:'Alerts', detail:'Timer & output test', color:'#fbbf24'},
  {id:'browser', name:'Browser', detail:'Desktop browser players', color:'#fb923c', native:true},
  {id:'media-manager', name:'Media Manager', detail:'Desktop media previews', color:'#f472b6', native:true},
  {id:'integrations', name:'Linked apps', detail:'Spotify & embedded players', color:'#2dd4bf', native:true},
  {id:'microphone', name:'Microphone', detail:'Live input · monitoring starts off', color:'#f87171'},
];
export const trackIds = Array.from({length:8},(_,i)=>`track-${i+1}`);
export const mixerChannelIds = [...mixerChannels.map(channel=>channel.id), ...trackIds];
export const flatChannel = {volume:1, muted:false, solo:false, pan:0, low:0, mid:0, high:0};
const number=(value,fallback,min,max)=>typeof value==='number' && Number.isFinite(value) ? Math.min(max,Math.max(min,value)) : fallback;
export function normalizeMixerSettings(value) {
  return {limiter:value?.limiter!==false, channels:Object.fromEntries(mixerChannelIds.map(id=>{
    const item=value?.channels?.[id];
    return [id,{volume:number(item?.volume,1,0,1), muted:item?.muted===true, solo:item?.solo===true,
      pan:number(item?.pan,0,-1,1), low:number(item?.low,0,-12,12), mid:number(item?.mid,0,-12,12), high:number(item?.high,0,-12,12)}];
  }))};
}
export const defaultMixerSettings = normalizeMixerSettings();
export function channelIsMuted(settings,id) {
  const value=settings.channels[id] || flatChannel;
  return value.muted || (Object.values(settings.channels).some(channel=>channel.solo) && !value.solo);
}
export function mixerPreset(name) {
  const settings=normalizeMixerSettings();
  const volumes=name==='voice' ? {speech:1,audio:.35,video:.35,alerts:.3,microphone:.8} : name==='music' ? {speech:.6,alerts:.25,microphone:.65} : {};
  for(const [id,volume] of Object.entries(volumes))settings.channels[id].volume=volume;
  if(name==='voice') {settings.channels.speech.low=-3;settings.channels.speech.mid=2;settings.channels.microphone.low=-4;}
  return settings;
}
export function mediaMixerChannel(media) {
  const explicit=media?.dataset?.mixerChannel;
  if(mixerChannelIds.includes(explicit))return explicit;
  const tab=media?.closest?.('[data-capture-tab]')?.dataset?.captureTab;
  if(tab==='sound-mixer')return 'audio';
  if(['browser','media-manager','integrations'].includes(tab))return tab;
  if(tab==='chats')return 'speech';
  return media?.tagName?.toLowerCase()==='video' ? 'video' : 'audio';
}
export function pcmMeter(samples) {
  let peak=0, total=0;
  for(const value of samples){const sample=Number.isFinite(value)?value:0;peak=Math.max(peak,Math.abs(sample));total+=sample*sample;}
  const rms=samples.length ? Math.sqrt(total/samples.length) : 0;
  return {peak,rms,db:Math.max(-60,20*Math.log10(Math.max(rms,.001))),clipping:peak>=.99};
}
