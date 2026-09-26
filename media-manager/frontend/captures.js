const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export const captureTools={
  async saveSnapshot(row,video,status,button){
    if(!video.videoWidth || !video.videoHeight || video.readyState<2){status.textContent='Wait for a video frame to load.';return;}
    video.pause();button.disabled=true;status.textContent='Saving this frame…';
    try{
      if(video.seeking)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{video.removeEventListener('seeked',done);reject(new Error('Wait for seeking to finish and try again.'));},10000);const done=()=>{clearTimeout(timer);resolve();};video.addEventListener('seeked',done,{once:true});});
      if(video.videoWidth*video.videoHeight>24_000_000)throw new Error('Snapshots support up to 24 megapixels.');
      const angle=Number(video.dataset.rotation)||0,canvas=document.createElement('canvas');
      canvas.width=angle%180?video.videoHeight:video.videoWidth;canvas.height=angle%180?video.videoWidth:video.videoHeight;
      const context=canvas.getContext('2d');context.translate(canvas.width/2,canvas.height/2);context.rotate(angle*Math.PI/180);context.drawImage(video,-video.videoWidth/2,-video.videoHeight/2);
      const started=await this.adapter.operation('snapshot',{...this.payload(row),time:video.currentTime,rotation:angle,png:canvas.toDataURL('image/png')});
      let job=started;
      while(job.status==='running'){await delay(250);job=(await this.adapter.state()).job;if(job.id!==started.id)throw new Error('Capture status changed. Open Snapshots to check the result.');}
      if(job.status!=='complete')throw new Error(job.message);
      status.textContent='Snapshot saved. ';const link=document.createElement('button');link.textContent='View snapshots';link.onclick=()=>{video.closest('dialog')?.close();this.openCaptureGallery('snapshot');};status.append(link);
    }catch(e){status.textContent=e.message;}finally{button.disabled=false;}
  },
  openClipEditor(row,video){
    if(!Number.isFinite(video.duration))return;
    video.pause();const dialog=video.closest('dialog'),panel=dialog.querySelector('.mo-playback-tools');
    video.clipPreviewCleanup?.();panel.querySelector('.mo-clip-editor')?.remove();
    const box=document.createElement('details');box.className='mo-clip-editor';box.open=true;
    const start=Math.max(0,Math.min(video.currentTime,video.duration-.05)),end=Math.min(video.duration,start+5);
    box.innerHTML=`<summary>CLIP · Save a shorter video</summary><p>Mark start and end while using the player above. A new MP4 is created; the source stays unchanged.</p><div class="mo-frame-options"><label>Start (seconds)<input data-start aria-label="Clip start" type="number" min="0" max="${video.duration}" step=".001" value="${start.toFixed(3)}"></label><button data-mark-start>Set start here</button><label>End (seconds)<input data-end aria-label="Clip end" type="number" min="0" max="${video.duration}" step=".001" value="${end.toFixed(3)}"></label><button data-mark-end>Set end here</button></div><button data-preview>Preview selected range</button><label class="mo-check"><input type="checkbox" data-turn checked> Apply viewing rotation to the new clip</label><label>Save clips in<input data-destination aria-label="Clip destination" placeholder="Media Manager / Clips"></label><button data-browse>Choose another output folder</button><p data-range role="status"></p><p data-task-progress role="status"></p><button data-save class="mo-primary">Save clip</button><button data-cancel hidden>Cancel clip export</button><p data-result role="status"></p>`;
    panel.append(box);const get=s=>box.querySelector(s);
    const update=()=>{const a=Number(get('[data-start]').value),b=Number(get('[data-end]').value);get('[data-range]').textContent=b>a?`Selected length: ${(b-a).toFixed(3)} seconds`:'The end must be after the start.';};
    get('[data-start]').oninput=get('[data-end]').oninput=update;
    get('[data-mark-start]').onclick=()=>{get('[data-start]').value=video.currentTime.toFixed(3);update();};
    get('[data-mark-end]').onclick=()=>{get('[data-end]').value=video.currentTime.toFixed(3);update();};
    get('[data-browse]').onclick=()=>this.dialogAttempt(dialog,async()=>{const {path}=await this.adapter.pickFolder('clip output',get('[data-destination]').value);if(path)get('[data-destination]').value=path;});
    let stopAt=null;
    const stopPreview=()=>{if(stopAt!==null && video.currentTime>=stopAt){video.pause();stopAt=null;}};
    video.addEventListener('timeupdate',stopPreview);video.clipPreviewCleanup=()=>video.removeEventListener('timeupdate',stopPreview);
    get('[data-preview]').onclick=()=>{const a=Number(get('[data-start]').value),b=Number(get('[data-end]').value);if(a<0||b<=a||b>video.duration){get('[data-result]').textContent='Choose a valid range within the video.';return;}stopAt=b;video.currentTime=a;video.play().catch(e=>get('[data-result]').textContent=e.message);};
    get('[data-cancel]').onclick=()=>this.frameJobId&&this.adapter.cancelFrames(this.frameJobId);
    get('[data-save]').onclick=async()=>{
      const button=get('[data-save]');button.disabled=true;get('[data-cancel]').hidden=false;get('[data-result]').textContent='';
      try{
        const job=await this.waitOperation('clip',{...this.payload(row),start:Number(get('[data-start]').value),end:Number(get('[data-end]').value),rotation:get('[data-turn]').checked?(Number(video.dataset.rotation)||0):0,destination:get('[data-destination]').value},dialog);
        get('[data-task-progress]').textContent='Export complete.';get('[data-result]').textContent='Clip saved. ';const reveal=document.createElement('button');reveal.textContent='Open PC file location';reveal.onclick=()=>this.adapter.revealCapture(job.capture.id).catch(e=>get('[data-result]').textContent=e.message);get('[data-result]').append(reveal);
        const gallery=document.createElement('button');gallery.textContent='View saved clips';gallery.onclick=()=>{dialog.close();this.openCaptureGallery('clip');};get('[data-result]').append(gallery);
      }catch(e){get('[data-result]').textContent=e.message;}finally{button.disabled=false;get('[data-cancel]').hidden=true;}
    };update();box.scrollIntoView({block:'nearest'});
  },
  async openCaptureGallery(kind='snapshot'){
    const title=kind==='snapshot'?'Snapshots':'Saved clips';
    const dialog=this.toolDialog(title,'<p role="status">Loading saved media…</p>'),version=dialog.toolVersion;
    await this.dialogAttempt(dialog,async()=>{
      const data=await this.adapter.captures(kind);if(!dialog.open||dialog.toolVersion!==version)return;
      this.toolDialog(title,`<p>${data.records.length} saved ${kind==='snapshot'?'snapshots':'clips'} · source videos retained.</p><div class="mo-capture-heading"><button data-capture-folder>Open ${kind==='snapshot'?'snapshot':'clips'} folder on PC</button><button data-capture-switch>${kind==='snapshot'?'View saved clips':'View snapshots'}</button></div><code class="mo-path">${esc(data.folder)}</code><div class="mo-capture-gallery">${data.records.map(r=>`<article><button class="mo-capture-preview" data-capture-id="${r.id}" ${r.available?'':'disabled'}>${r.kind==='snapshot'&&r.available?`<img loading="lazy" src="${esc(this.adapter.captureUrl(r.id))}" alt="Snapshot from ${esc(r.sourceName)} at ${Number(r.time).toFixed(3)} seconds">`:`<span>▶ ${esc(r.sourceName)}</span>`}</button><p>${esc(new Date(r.created).toLocaleString())}</p><p>${r.kind==='snapshot'?`${Number(r.time).toFixed(3)}s`:`${Number(r.start).toFixed(3)}–${Number(r.end).toFixed(3)}s`} · ${esc(r.sourceName)}</p><button data-capture-reveal="${r.id}" ${r.available?'':'disabled'}>Open PC file location</button>${r.available?'':'<p>File unavailable at its saved location.</p>'}</article>`).join('') || '<p>No captures yet. Open a video and choose Snapshot or CLIP.</p>'}</div>`);
      dialog.querySelector('[data-capture-folder]').onclick=()=>this.dialogAttempt(dialog,()=>this.adapter.openFolder(data.folder));
      dialog.querySelector('[data-capture-switch]').onclick=()=>this.openCaptureGallery(kind==='snapshot'?'clip':'snapshot');
      dialog.querySelectorAll('[data-capture-reveal]').forEach(b=>b.onclick=()=>this.dialogAttempt(dialog,()=>this.adapter.revealCapture(b.dataset.captureReveal)));
      dialog.querySelectorAll('[data-capture-id]').forEach(b=>b.onclick=()=>{
        const row=data.records.find(r=>r.id===b.dataset.captureId);
        const viewer=document.createElement('dialog');viewer.className='mo-dialog mo-capture-lightbox';viewer.innerHTML=`<div class="mo-dialog-heading"><h2>${esc(row.sourceName)}</h2><button data-close>Close preview</button></div>${row.kind==='snapshot'?`<img src="${esc(this.adapter.captureUrl(row.id))}" alt="Enlarged snapshot">`:`<video src="${esc(this.adapter.captureUrl(row.id))}" controls autoplay></video>`}<button data-reveal>Open PC file location</button>`;
        this.append(viewer);viewer.querySelector('[data-close]').onclick=()=>viewer.close();viewer.querySelector('[data-reveal]').onclick=()=>this.dialogAttempt(viewer,()=>this.adapter.revealCapture(row.id));viewer.onclose=()=>{viewer.querySelector('video')?.pause();viewer.remove();};viewer.showModal();
      });
    });
  },
};
