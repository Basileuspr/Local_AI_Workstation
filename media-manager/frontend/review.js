const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const location=id=>{const [runId,...rest]=id.split('::');return {runId,recordId:rest.join('::')};};

export function mountReview(ui){
  const section=document.createElement('details');section.className='mo-review';
  section.innerHTML='<summary>Review & classify · people, scenes, ratings and notes</summary><div class="mo-review-content"></div>';
  ui.querySelector('#mo-library').prepend(section);
  const content=section.querySelector('div');
  let caps=null,catalog={items:[],people:[],scenes:{}},job=null,person='',scene='',rating='',query='',offset=0,timer=null,busy=false,last='';
  const api=(operation,value={})=>ui.adapter.review({operation,...value});
  const chosen=()=>ui.data?.records.filter(row=>ui.selected.has(row.RecordId)&&row.Available&&!row.Trashed)||[];
  const report=error=>{const p=content.querySelector('[role=alert]');if(p)p.textContent=error.message||String(error);};
  async function act(work){if(busy)return;busy=true;try{await work();}catch(error){report(error);}finally{busy=false;}}
  async function refresh(){catalog=await api('catalog',{person,scene,rating,query,offset});renderResults();}
  async function poll(){try{job=await api('job');const p=content.querySelector('[data-progress]');if(p)p.textContent=job?`${job.message} · ${job.processed}/${job.total}`:'';const key=JSON.stringify([job?.id,job?.status,job?.processed]);if(last!==key){last=key;await refresh();}const failures=content.querySelector('[data-errors]');if(failures)failures.textContent=job?.errors?.map(e=>e.error).join('\n')||'';}catch(error){report(error);}}
  section.addEventListener('toggle',async()=>{
    clearInterval(timer);if(!section.open)return;
    content.textContent='Loading local review tools…';
    try{caps=await api('capabilities');render();await refresh();await poll();timer=setInterval(()=>{if(section.isConnected&&section.open)poll();else clearInterval(timer);},2000);}catch(error){content.textContent=error.message;}
  });
  function render(){
    content.innerHTML=`
      <div class="mo-review-actions"><button data-slides>Review selection / slideshow</button><button data-export>Export preview images & notes</button><label><input type="checkbox" data-faces ${caps.faces.some(p=>p.ready)?'checked':'disabled'}> Group faces</label><select data-model aria-label="Video scene model"><option value="">Scene classification off</option>${caps.vision_models.map(m=>`<option value="${escape(m.id)}">${escape(m.name)}</option>`).join('')}</select><button data-classify>Classify selected previews</button><button data-stop>Stop classification</button></div>
      ${caps.faces.some(p=>p.ready)?'':'<p>Install local face models in Faces to enable grouping.</p>'}<p data-progress role="status"></p><p data-errors></p><p role="alert"></p>
      <div class="mo-review-actions"><select data-person aria-label="Filter reviewed person"><option value="">All people</option></select><select data-scene aria-label="Filter reviewed scene"><option value="">All scenes</option></select><select data-rating aria-label="Filter review rating"><option value="">All ratings</option><option value="pending">To review</option><option value="liked">Liked</option><option value="disliked">Disliked</option></select><input data-query aria-label="Search reviewed media" placeholder="Search names, captions or tags"><button data-filter>Filter results</button></div><div data-people class="mo-review-people"></div><div data-editor></div><div data-results class="mo-review-results"></div><div class="mo-review-actions"><button data-prev>Previous results</button><span data-count></span><button data-next>Next results</button></div>`;
    content.querySelector('[data-slides]').onclick=()=>act(async()=>{const rows=chosen();if(!rows.length)throw new Error('Select videos in the library first.');await slideshow(rows.map(row=>({runId:ui.data.uiRunId,recordId:row.RecordId})));});
    content.querySelector('[data-classify]').onclick=()=>act(async()=>{const rows=chosen();if(!rows.length)throw new Error('Select videos in the library first.');const faces=content.querySelector('[data-faces]').checked,model=content.querySelector('[data-model]').value;if(!faces&&!model)throw new Error('Enable faces or choose a scene model.');content.querySelector('[data-progress]').textContent='Verifying selected videos and preparing preview frames…';job=await api('classify',{runId:ui.data.uiRunId,recordIds:rows.map(r=>r.RecordId),faces,model});await poll();});
    content.querySelector('[data-stop]').onclick=()=>api('stop').then(poll).catch(report);
    content.querySelector('[data-export]').onclick=()=>act(async()=>{const result=await api('export',{runId:ui.data.uiRunId,recordIds:chosen().map(r=>r.RecordId)});content.querySelector('[data-progress]').textContent=`Saved ${result.path}`;await ui.adapter.openFolder(result.folder);});
    content.querySelector('[data-filter]').onclick=()=>act(async()=>{person=content.querySelector('[data-person]').value;scene=content.querySelector('[data-scene]').value;rating=content.querySelector('[data-rating]').value;query=content.querySelector('[data-query]').value;offset=0;await refresh();});
    content.querySelector('[data-prev]').onclick=()=>act(async()=>{offset=Math.max(0,offset-48);await refresh();});content.querySelector('[data-next]').onclick=()=>act(async()=>{offset+=48;await refresh();});
  }
  function renderResults(){
    const choose=(selector,values,value)=>{const field=content.querySelector(selector);if(!field)return;field.innerHTML=field.options[0].outerHTML+values;field.value=value;};
    choose('[data-person]',catalog.people.map(p=>`<option value="${escape(p.id)}">${escape(p.name)} (${p.count})</option>`).join(''),person);
    choose('[data-scene]',Object.keys(catalog.scenes).map(s=>`<option>${escape(s)}</option>`).join(''),scene);
    content.querySelector('[data-people]').innerHTML=catalog.people.map(p=>`<button data-person-edit="${escape(p.id)}"><img src="${escape(ui.adapter.reviewFaceUrl(p.face_id))}" alt=""><span>${escape(p.name)} · ${p.count}</span></button>`).join('');
    content.querySelectorAll('[data-person-edit]').forEach(button=>button.onclick=()=>editPerson(catalog.people.find(p=>p.id===button.dataset.personEdit)));
    content.querySelector('[data-results]').innerHTML=catalog.items.map((item,index)=>{const loc=location(item.id);return `<button data-review-result="${index}"><img src="${escape(ui.adapter.thumbnailUrl(loc.runId,loc.recordId))}" alt="" loading="lazy"><span>${escape(item.name)}</span><small>${escape(item.review?.rating||'To review')} · ${escape(item.classification.scenes.join(' · '))}</small></button>`;}).join('');
    content.querySelectorAll('[data-review-result]').forEach(button=>button.onclick=()=>act(()=>slideshow([location(catalog.items[Number(button.dataset.reviewResult)].id)])));
    content.querySelector('[data-count]').textContent=`${catalog.total?offset+1:0}–${Math.min(offset+48,catalog.total)} of ${catalog.total}`;content.querySelector('[data-prev]').disabled=!offset;content.querySelector('[data-next]').disabled=offset+48>=catalog.total;
  }
  function editPerson(p){
    const editor=content.querySelector('[data-editor]');editor.innerHTML=`<div class="mo-review-actions"><input data-name aria-label="Person name" maxlength="120" value="${escape(p.name)}"><button data-save-name>Save name</button><select data-merge aria-label="Merge person group"><option value="">Merge into…</option>${catalog.people.filter(x=>x.id!==p.id).map(x=>`<option value="${escape(x.id)}">${escape(x.name)}</option>`).join('')}</select><button data-merge-save>Merge groups</button><button data-close-editor>Close</button></div>`;
    editor.querySelector('[data-save-name]').onclick=()=>act(async()=>{await api('person',{value:{id:p.id,name:editor.querySelector('[data-name]').value}});editor.textContent='';await refresh();});
    editor.querySelector('[data-merge-save]').onclick=()=>act(async()=>{await api('merge',{value:{source_id:p.id,target_id:editor.querySelector('[data-merge]').value}});editor.textContent='';await refresh();});editor.querySelector('[data-close-editor]').onclick=()=>{editor.textContent='';};
  }
  async function slideshow(items){
    const dialog=document.createElement('dialog');dialog.className='mo-dialog mo-review-dialog';dialog.setAttribute('aria-label','Review media slideshow');ui.append(dialog);
    let index=0,current=null,working=false;
    const failure=error=>{dialog.querySelector('[role=alert]').textContent=error.message;};
    const perform=async work=>{if(working)return;working=true;try{await work();}catch(e){failure(e);}finally{working=false;}};
    async function save(rating=current?.review.rating){if(!current)return;const review={rating,caption:dialog.querySelector('[data-caption]').value,tags:dialog.querySelector('[data-tags]').value.split(',').map(x=>x.trim()).filter(Boolean)};await api('save',{...items[index],review});current.review=review;}
    async function close(){await save();dialog.close();dialog.remove();await refresh();await ui.refresh();if(ui.data)await ui.load(ui.data.uiRunId,{preserveFilters:true});}
    async function show(){current=null;dialog.innerHTML='<p>Loading preview…</p><p role="alert"></p>';current=await api('open',items[index]);const {runId,recordId}=items[index];
      dialog.innerHTML=`<div class="mo-dialog-heading"><h2>${escape(current.name)} · ${index+1}/${items.length}</h2><button data-close>Save & close</button></div><img class="mo-review-preview" src="${escape(ui.adapter.thumbnailUrl(runId,recordId,'full'))}" alt="${escape(current.name)}"><label>Caption / notes<textarea data-caption aria-label="Media review caption" maxlength="10000">${escape(current.review.caption)}</textarea></label><label>Tags<input data-tags aria-label="Media review tags" value="${escape(current.review.tags.join(', '))}"></label><div class="mo-review-actions"><button data-like>Like</button><button data-dislike>Dislike</button><button data-clear>Return to review</button><button data-save>Save notes</button><button data-reveal>Show original in folder</button></div><div class="mo-review-people">${current.classification.faces.map(f=>`<div><img src="${escape(ui.adapter.reviewFaceUrl(f.id))}" alt="${escape(f.name)}"><span>${escape(f.name)}${f.uncertain?' · check group':''}</span><select data-assign="${escape(f.id)}" aria-label="Assign face"><option value="">Separate as new person</option>${[...new Map([...catalog.people,{id:f.person_id,name:f.name}].map(p=>[p.id,p])).values()].map(p=>`<option value="${escape(p.id)}" ${p.id===f.person_id?'selected':''}>${escape(p.name)}</option>`).join('')}</select><button data-exclude="${escape(f.id)}">Exclude this face</button></div>`).join('')}</div><label>Scene labels<select data-scenes multiple aria-label="Video scene labels">${caps.scene_labels.map(s=>`<option ${current.classification.scenes.includes(s)?'selected':''}>${escape(s)}</option>`).join('')}</select></label><button data-save-scenes>Save scene labels</button><p role="alert"></p><div class="mo-review-actions"><button data-prev ${index?'':'disabled'}>Previous</button><button data-next ${index<items.length-1?'':'disabled'}>Next</button></div>`;
      dialog.querySelector('[data-close]').onclick=()=>perform(close);dialog.querySelector('[data-save]').onclick=()=>perform(()=>save());
      for(const [selector,rating] of [['[data-like]','liked'],['[data-dislike]','disliked'],['[data-clear]',null]])dialog.querySelector(selector).onclick=()=>perform(async()=>{await save(rating);if(index<items.length-1){index++;await show();}});
      for(const [selector,delta] of [['[data-prev]',-1],['[data-next]',1]])dialog.querySelector(selector).onclick=()=>perform(async()=>{await save();index+=delta;await show();});
      dialog.querySelector('[data-reveal]').onclick=()=>perform(()=>ui.adapter.reveal(runId,recordId));
      dialog.querySelectorAll('[data-assign]').forEach(field=>field.onchange=()=>perform(async()=>{await save();await api('face',{value:{id:field.dataset.assign,person_id:field.value||null}});await show();}));
      dialog.querySelectorAll('[data-exclude]').forEach(button=>button.onclick=()=>perform(async()=>{await save();const face=current.classification.faces.find(f=>f.id===button.dataset.exclude);await api('face',{value:{id:face.id,person_id:face.person_id,exclude:true}});await show();}));
      dialog.querySelector('[data-save-scenes]').onclick=()=>perform(async()=>{await save();await api('scenes',{value:{digest:current.digest,labels:[...dialog.querySelector('[data-scenes]').selectedOptions].map(o=>o.value)}});await show();});
    }
    dialog.addEventListener('cancel',event=>{event.preventDefault();perform(close);});dialog.showModal();await perform(show);
  }
}
