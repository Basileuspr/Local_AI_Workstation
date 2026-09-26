export const FRAME_STEPS = Array.from({length:10}, (_,i)=>i+1);
export const TIME_STEPS = [...FRAME_STEPS, ...Array.from({length:10}, (_,i)=>15+i*5)];

export function frameAt(times, seconds) {
  let lo=0, hi=times.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(times[mid]<=seconds+0.00001)lo=mid+1;else hi=mid;}
  return Math.max(0,lo-1);
}

// Both viewers use presentation timestamps, including variable-rate videos.
export function attachPlayback(owner, root, row) {
  const video=root.querySelector('video'); if(!video)return;
  video.controls=false;
  const panel=document.createElement('div'); panel.className='mo-playback-tools';
  panel.innerHTML=`<div><label>Frame progression<select aria-label="Frame progression">${FRAME_STEPS.map(n=>`<option value="${n}">${n} frame${n===1?'':'s'}</option>`).join('')}</select></label><button data-frame="-1">Previous frames</button><button data-frame="1">Next frames</button></div><div><label>Time progression<select aria-label="Time progression">${TIME_STEPS.map(n=>`<option value="${n}">${n} second${n===1?'':'s'}</option>`).join('')}</select></label><button data-time="-1">Back in time</button><button data-time="1">Forward in time</button></div><p role="status">Stepping pauses playback. Frame timing is read on first use.</p><button data-cancel hidden>Cancel frame timing</button>`;
  video.parentElement.after(panel);
  const controls=document.createElement('div');controls.className='mo-player-controls';
  controls.innerHTML='<div><button data-play aria-label="Play video">Play</button><output aria-label="Video time">0:00 / 0:00</output><button data-mute aria-label="Mute video">Mute</button><button data-fullscreen>Fullscreen</button><label>Volume<input aria-label="Video volume" type="range" min="0" max="1" step=".05" value="1"></label><label>Speed<select aria-label="Playback speed"><option value=".5">0.5×</option><option value="1" selected>1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label></div><input aria-label="Video timeline" type="range" min="0" max="0" step=".001" value="0"><div><button data-snapshot>Snapshot</button><button data-clip>CLIP · mark a range</button></div><p data-capture-status role="status"></p>';
  panel.prepend(controls);
  const clock=t=>{t=Math.max(0,Number(t)||0);return `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}.${String(Math.floor(t%1*10))}`;};
  const timeline=controls.querySelector('[aria-label="Video timeline"]');
  const update=()=>{
    const length=Number.isFinite(video.duration)?video.duration:0;
    timeline.max=String(length);timeline.value=String(video.currentTime);timeline.disabled=!length;
    controls.querySelector('output').textContent=`${clock(video.currentTime)} / ${clock(length)}`;
    const play=controls.querySelector('[data-play]');play.textContent=video.paused?'Play':'Pause';play.setAttribute('aria-label',video.paused?'Play video':'Pause video');
    const mute=controls.querySelector('[data-mute]');mute.textContent=video.muted?'Unmute':'Mute';mute.setAttribute('aria-label',video.muted?'Unmute video':'Mute video');
  };
  for(const name of ['timeupdate','durationchange','loadedmetadata','seeked','play','pause','ended','volumechange'])video.addEventListener(name,update);
  timeline.oninput=()=>{video.pause();video.currentTime=Number(timeline.value);};
  controls.querySelector('[data-play]').onclick=()=>video.paused?video.play().catch(e=>controls.querySelector('[data-capture-status]').textContent=e.message):video.pause();
  controls.querySelector('[data-mute]').onclick=()=>{video.muted=!video.muted;};
  controls.querySelector('[aria-label="Video volume"]').oninput=e=>{video.volume=Number(e.target.value);video.muted=false;};
  controls.querySelector('[aria-label="Playback speed"]').onchange=e=>{video.playbackRate=Number(e.target.value);};
  controls.querySelector('[data-snapshot]').onclick=()=>owner.saveSnapshot(row,video,controls.querySelector('[data-capture-status]'),controls.querySelector('[data-snapshot]'));
  controls.querySelector('[data-clip]').onclick=()=>owner.openClipEditor(row,video);
  controls.querySelector('[data-fullscreen]').onclick=()=>{const action=document.fullscreenElement?document.exitFullscreen():root.requestFullscreen();action.catch(e=>controls.querySelector('[data-capture-status]').textContent=e.message);};
  update();
  let times, pending=false, jobId;
  const status=panel.querySelector(':scope > [role=status]'), cancel=panel.querySelector('[data-cancel]');
  const active=()=>panel.isConnected && video.isConnected && !!video.closest('dialog[open]');
  const seek=time=>{video.pause();video.currentTime=Math.max(0,Math.min(Math.max(0,video.duration-.000001),time));};
  panel.querySelectorAll('[data-time]').forEach(button=>button.onclick=()=>{
    if(!Number.isFinite(video.duration)){status.textContent='Wait for the video to load.';return;}
    seek(video.currentTime+Number(button.dataset.time)*Number(panel.querySelector('[aria-label="Time progression"]').value));
    status.textContent=`Paused at ${video.currentTime.toFixed(3)} seconds.`;
  });
  cancel.onclick=()=>jobId && owner.adapter.cancelFrames(jobId).catch(e=>{status.textContent=e.message;});
  panel.querySelectorAll('[data-frame]').forEach(button=>button.onclick=async()=>{
    if(pending)return;
    if(!Number.isFinite(video.duration)){status.textContent='Wait for the video to load.';return;}
    video.pause(); pending=true;
    panel.querySelectorAll('button[data-frame]').forEach(b=>b.disabled=true);
    try {
      if(!times){
        status.textContent='Reading exact frame timing…';
        const started=await owner.adapter.operation('frame-timeline',owner.payload(row)); jobId=started.job?.id || started.id;
        cancel.hidden=false;
        while(true){
          if(!active()){await owner.adapter.cancelFrames(jobId).catch(()=>{});return;}
          const state=await owner.adapter.state(), job=state.job;
          if(job.id!==jobId)throw new Error('Timing job changed. Try frame stepping again.');
          if(job.status!=='running'){
            if(job.status!=='complete')throw new Error(job.message || 'Could not read frame timing.');
            times=(await owner.adapter.frameTimeline(job.timelineId)).frameTimeline;break;
          }
          await new Promise(resolve=>setTimeout(resolve,250));
        }
      }
      if(!active())return;
      const index=Math.max(0,Math.min(times.length-1,frameAt(times,video.currentTime)+Number(button.dataset.frame)*Number(panel.querySelector('[aria-label="Frame progression"]').value)));
      const end=times[index+1] ?? video.duration;
      seek(times[index]+Math.min(.0001,Math.max(0,end-times[index])/2));
      status.textContent=`Frame ${index+1} of ${times.length.toLocaleString()} · ${times[index].toFixed(3)} seconds`;
    }catch(error){status.textContent=error.message;}
    finally{pending=false;cancel.hidden=true;panel.querySelectorAll('button[data-frame]').forEach(b=>b.disabled=false);}
  });
}
