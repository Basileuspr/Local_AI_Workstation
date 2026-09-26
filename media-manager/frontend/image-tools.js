const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export const imageTools = {
  openImageTools(source = '') {
    const dialog = this.toolDialog('Image tools', `<p>Convert a folder, standardize image sizes, stitch a strip or grid, or animate the images as a GIF. Original files stay unchanged.</p>
      <label>Image source folder<input id="mo-images-source" value="${esc(source)}" placeholder="Absolute image folder path"></label><button id="mo-images-pick">Choose image folder</button>
      <label class="mo-check"><input id="mo-images-recursive" type="checkbox"> Include subfolders</label><p>JPEG, PNG, WebP, BMP and TIFF. Animated or multipage files contribute their first image only. Up to 1,000 images per batch.</p>
      <p data-task-progress role="status"></p><button id="mo-images-inspect" class="mo-primary">Read image folder</button><button id="mo-images-cancel" hidden>Cancel inspection</button>`);
    const version=dialog.toolVersion;
    dialog.querySelector('#mo-images-pick').onclick=()=>this.dialogAttempt(dialog,async()=>{const {path}=await this.adapter.pickFolder('source');if(path && dialog.toolVersion===version)dialog.querySelector('#mo-images-source').value=path;});
    dialog.querySelector('#mo-images-cancel').onclick=()=>this.frameJobId && this.adapter.cancelFrames(this.frameJobId);
    dialog.querySelector('#mo-images-inspect').onclick=()=>this.dialogAttempt(dialog,async()=>{
      const button=dialog.querySelector('#mo-images-inspect');button.disabled=true;dialog.querySelector('#mo-images-cancel').hidden=false;
      try { const job=await this.waitOperation('image-inspect',{source:dialog.querySelector('#mo-images-source').value,recursive:dialog.querySelector('#mo-images-recursive').checked},dialog);
        if(dialog.open && dialog.toolVersion===version)this.imageOptions(job.imageBatch);
      } finally {button.disabled=false;if(dialog.toolVersion===version)dialog.querySelector('#mo-images-cancel').hidden=true;}
    });
  },
  imageOptions(info) {
    const grids=Array.from({length:info.count},(_,i)=>i+1).filter(n=>info.count%n===0);
    const sizes=[...new Set(info.records.map(r=>`${r.width} × ${r.height}`))];
    const dialog=this.toolDialog('Convert, size & stitch', `<p><strong>${info.count} images</strong> · ${sizes.length} source sizes</p><code class="mo-path">${esc(info.source)}</code>
      <details><summary>Source images & stitch order</summary><p>Sorted by relative filename. Reverse order below if needed. Coordinates in the output manifest follow this order.</p><ol class="mo-image-file-list">${info.records.map(r=>`<li>${esc(r.name)} <small>${r.width} × ${r.height} · ${esc(r.codec)}</small></li>`).join('')}</ol></details>
      <div class="mo-frame-options"><label>Convert to<select id="mo-images-format"><option value="png">PNG · lossless</option><option value="jpg">JPEG · high quality</option><option value="webp">WebP · lossless</option></select></label><label>Background color<input id="mo-images-background" type="color" value="#ffffff"></label></div>
      <label class="mo-check"><input id="mo-images-size" type="checkbox"> Standardize aspect ratio and size</label>
      <fieldset id="mo-images-sizing" disabled><legend>Same dimensions for every image</legend><label>Aspect ratio preset<select id="mo-images-ratio"><option value="1:1">Square · 1:1</option><option value="4:3">Landscape · 4:3</option><option value="3:4">Portrait · 3:4</option><option value="16:9">Widescreen · 16:9</option><option value="9:16">Portrait · 9:16</option><option value="custom">Custom width & height</option></select></label>
      <div class="mo-frame-options"><label>Width (pixels)<input id="mo-images-width" type="number" min="1" max="16384" value="1024"></label><label>Height (pixels)<input id="mo-images-height" type="number" min="1" max="16384" value="1024"></label></div>
      <label>Fit images<select id="mo-images-fit"><option value="contain">Pad · preserve the whole image</option><option value="cover">Crop · fill the size, trim edges</option><option value="stretch">Stretch · may distort proportions</option></select></label></fieldset>
      <details id="mo-images-stitch"><summary>Stitching options</summary><div class="mo-frame-options"><label>Layout<select id="mo-images-layout"><option value="none">Individual images only</option><option value="vertical">Linear strip · vertical</option><option value="horizontal">Horizontal strip</option><option value="grid">Grid</option><option value="gif">Animated GIF</option></select></label><label>Grid size<select id="mo-images-columns" disabled>${grids.map(n=>`<option value="${n}" ${n===grids.reduce((a,b)=>Math.abs(b-Math.sqrt(info.count))<Math.abs(a-Math.sqrt(info.count))?b:a)?'selected':''}>${n} columns × ${info.count/n} rows</option>`).join('')}</select></label><label>Gap (pixels)<input id="mo-images-gap" type="number" min="0" max="256" value="0"></label><label>Order<select id="mo-images-order"><option value="forward">Filename · A–Z</option><option value="reverse">Filename · Z–A</option></select></label></div><div id="mo-images-animation" hidden><label>Time per image (milliseconds)<input id="mo-images-delay" type="number" min="20" max="10000" step="10" value="100"></label><label>Loop animation<select id="mo-images-loop"><option value="0">Forever</option><option value="-1">Play once</option><option value="1">Repeat once</option><option value="2">Repeat twice</option></select></label><p>GIF uses up to 256 colors. Images advance in the listed order; no in-between frames are generated.</p></div><p>Stitching also saves the individual converted images. All images use one common size.</p></details>
      <label>Output destination folder<input id="mo-images-destination" placeholder="Choose where the new image set goes"></label><button id="mo-images-output-pick">Choose output folder</button>
      <p id="mo-images-estimate" role="status"></p><p>A new subfolder is created for every run. PNG/WebP retain transparency; JPEG flattens it onto the background color. Original metadata is not copied.</p><p data-task-progress role="status"></p><button id="mo-images-run" class="mo-primary">Create image copies</button><button id="mo-images-cancel" hidden>Cancel processing</button>`);
    const version=dialog.toolVersion, get=id=>dialog.querySelector('#mo-images-'+id);
    const settings=()=>({batchId:info.id,format:get('format').value,standardize:get('size').checked,width:Number(get('width').value),height:Number(get('height').value),fit:get('fit').value,background:get('background').value,layout:get('layout').value,columns:Number(get('columns').value),gap:Number(get('gap').value),frameDelay:Number(get('delay').value),loop:Number(get('loop').value),reverse:get('order').value==='reverse',destination:get('destination').value});
    const estimate=()=>{const s=settings(),cols=s.layout==='horizontal'?info.count:s.layout==='vertical'?1:s.columns,rows=info.count/cols,w=cols*s.width+(cols-1)*s.gap,h=rows*s.height+(rows-1)*s.gap;get('estimate').textContent=`${info.count} ${s.format.toUpperCase()} copies · ${s.standardize?`${s.width} × ${s.height} pixels each`:'original dimensions'}${s.layout==='gif'?` · GIF ${s.width} × ${s.height} · ${(info.count*s.frameDelay/1000).toFixed(2)} seconds per cycle`:s.layout!=='none'?` · stitched output ${w} × ${h} (${(w*h/1e6).toFixed(1)} MP; maximum 64 MP)`:''}`;get('sizing').disabled=!s.standardize;get('columns').disabled=s.layout!=='grid';get('animation').hidden=s.layout!=='gif';get('gap').disabled=s.layout==='gif';};
    get('layout').onchange=()=>{if(get('layout').value!=='none')get('size').checked=true;estimate();};
    get('size').onchange=()=>{if(!get('size').checked)get('layout').value='none';estimate();};
    const ratio=()=>{if(get('ratio').value!=='custom'){const [w,h]=get('ratio').value.split(':').map(Number);get('height').value=Math.max(1,Math.round(Number(get('width').value)*h/w));}estimate();};
    get('ratio').onchange=ratio;get('width').oninput=ratio;get('height').oninput=()=>{get('ratio').value='custom';estimate();};
    for(const id of ['format','fit','columns','gap','order','delay','loop'])get(id).onchange=estimate;
    get('output-pick').onclick=()=>this.dialogAttempt(dialog,async()=>{const {path}=await this.adapter.pickFolder('destination');if(path && dialog.toolVersion===version)get('destination').value=path;});
    get('cancel').onclick=()=>this.frameJobId && this.adapter.cancelFrames(this.frameJobId);
    get('run').onclick=()=>this.dialogAttempt(dialog,async()=>{
      const payload=settings(),button=get('run');button.disabled=true;get('cancel').hidden=false;
      try { const job=await this.waitOperation('image-process',payload,dialog);
        if(dialog.open && dialog.toolVersion===version){const output=job.imageOutput;this.toolDialog('Image copies ready',`<p>${output.images.length} converted images${output.animated?' and an animated GIF':output.stitched?' and one stitched image':''} created.</p><code class="mo-path">${esc(output.output)}</code><p>Original images retained. images.json records sources, order, dimensions, and processing settings.</p><button id="mo-images-open">Open output folder</button><button id="mo-images-again">Use different options</button>`);get('open').onclick=()=>this.dialogAttempt(dialog,()=>this.adapter.openFolder(output.output));get('again').onclick=()=>this.imageOptions(info);}
      } finally {button.disabled=false;if(dialog.toolVersion===version)get('cancel').hidden=true;}
    });estimate();
  },
};
