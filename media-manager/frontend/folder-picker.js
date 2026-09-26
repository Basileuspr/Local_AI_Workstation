const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function pickFolder(request, kind='folder', initial='') {
  const host=document.querySelector('media-organizer') || document.body;
  const dialog=document.createElement('dialog');dialog.className='mo-dialog mo-folder-picker';dialog.setAttribute('aria-label','Choose a folder');host.append(dialog);
  dialog.innerHTML=`<div class="mo-dialog-heading"><h2>Choose ${esc(kind)} folder</h2><button data-close aria-label="Cancel folder selection">Close ×</button></div><p>Browse your PC here. Choose a location, or create a folder inside it.</p><div class="mo-folder-navigation"><button data-up>Up one folder</button><input aria-label="Folder address" placeholder="Folder path"><button data-go>Go</button></div><div class="mo-folder-browser"><nav aria-label="Folder shortcuts"></nav><div class="mo-folder-children" role="group" aria-label="Subfolders"></div></div><div class="mo-folder-create"><input aria-label="New subfolder name" maxlength="100" placeholder="New folder name"><button data-create>Create subfolder</button></div><p role="status"></p><p class="mo-dialog-error mo-warning" role="alert"></p><div class="mo-dialog-actions"><button data-close>Cancel</button><button data-select class="mo-primary" disabled>Use this folder</button></div>`;
  let current=null,version=0,busy=false;
  const get=selector=>dialog.querySelector(selector), error=get('[role=alert]');
  const load=async path=>{
    const revision=++version;busy=true;error.textContent='';get('[data-select]').disabled=true;get('[role=status]').textContent='Reading folders…';
    try {
      const data=await request(`browse-folders?${new URLSearchParams({path:path||''})}`);
      if(revision!==version || !dialog.open)return;
      current=data;get('[aria-label="Folder address"]').value=data.path;get('[data-up]').disabled=!data.parent;
      get('nav').innerHTML=data.roots.map((r,i)=>`<button data-root="${i}">${esc(r.name)}</button>`).join('');
      get('.mo-folder-children').innerHTML=data.children.map((r,i)=>`<button data-child="${i}">▸ ${esc(r.name)}</button>`).join('') || '<p>No subfolders. You can use this folder.</p>';
      dialog.querySelectorAll('[data-root]').forEach(b=>b.onclick=()=>load(data.roots[Number(b.dataset.root)].path));
      dialog.querySelectorAll('[data-child]').forEach(b=>b.onclick=()=>load(data.children[Number(b.dataset.child)].path));
      get('[role=status]').textContent=`${data.children.length} subfolders${data.skipped?' · some locations could not be read':''}`;get('[data-select]').disabled=false;
    }catch(e){if(revision===version){current=null;error.textContent=e.message;get('[role=status]').textContent='';}}
    finally{if(revision===version)busy=false;}
  };
  return new Promise(resolve=>{
    let selected='',finished=false;
    const finish=()=>{if(finished)return;finished=true;version++;dialog.remove();resolve({path:selected});};
    // Resolve explicit choices immediately: an embedded or background view can
    // delay the native dialog close event until its next rendering opportunity.
    const close=()=>{dialog.close();finish();};
    dialog.onclose=finish;dialog.oncancel=event=>{event.preventDefault();close();};
    dialog.querySelectorAll('[data-close]').forEach(b=>b.onclick=close);
    get('[data-go]').onclick=()=>load(get('[aria-label="Folder address"]').value);
    get('[aria-label="Folder address"]').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();get('[data-go]').click();}};
    get('[data-up]').onclick=()=>current?.parent&&load(current.parent);
    get('[data-select]').onclick=()=>{if(current&&!busy){selected=current.path;close();}};
    get('[data-create]').onclick=async()=>{
      if(!current||busy)return;const button=get('[data-create]');button.disabled=true;busy=true;const revision=version;error.textContent='';
      try{const result=await request('create-directory',{parent:current.path,name:get('[aria-label="New subfolder name"]').value});if(dialog.open && revision===version){get('[aria-label="New subfolder name"]').value='';await load(result.path);}}
      catch(e){error.textContent=e.message;}finally{button.disabled=false;if(revision===version)busy=false;}
    };
    dialog.showModal();void load(initial);
  });
}
