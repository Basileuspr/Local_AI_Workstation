import { durationLabel } from './library.js';
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export const mediaActions = {
  enterWorkspace() {
    const input = this.tab === 'duplicates' ? this.$('#mo-duplicate-search') : this.data ? this.$('#mo-search') : this.$('#mo-source');
    input?.scrollIntoView({ block:'center', behavior:'smooth' }); input?.focus({preventScroll:true});
    return document.activeElement === input;
  },
  identity(row) {
    if (row.Trashed) return '<strong class="mo-copy-badge mo-trash-badge">In recoverable Trash</strong>';
    if (!row.SHA256) return '<span class="mo-copy-badge">Duplicate status unknown</span>';
    if (!row.DuplicateGroup) return '<span class="mo-copy-badge">Unique in this scan</span>';
    return row.DuplicatePrimary === 'yes' ? '<strong class="mo-copy-badge mo-primary-copy">PRIMARY COPY</strong>' : '<span class="mo-copy-badge">Duplicate copy · same SHA-256</span>';
  },
  extraActions(row, expanded = false) {
    const disabled = this.busy || !row.Available ? 'disabled' : '';
    const frames = `<button data-tool="frames" data-record="${esc(row.RecordId)}" ${disabled}>Parse frames</button>`;
    const fileAction = row.Trashed ? `<button data-tool="restore" data-record="${esc(row.RecordId)}" ${disabled}>Restore from Trash</button><button class="mo-delete-action" data-tool="purge" data-record="${esc(row.RecordId)}" ${disabled}>Delete permanently</button>` : `<button class="mo-delete-action" data-tool="delete" data-record="${esc(row.RecordId)}" aria-label="Delete ${esc(row.OriginalFilename)}" ${disabled}>Delete</button>`;
    return `${fileAction}${expanded && !row.Trashed ? frames : ''}${!row.Trashed ? `<details class="mo-item-more"><summary>More actions</summary><div><button data-tool="rename" data-record="${esc(row.RecordId)}" ${disabled}>Rename</button>${expanded ? '' : frames}<button data-tool="tags" data-record="${esc(row.RecordId)}" ${disabled}>Tags</button></div></details>` : ''}`;
  },
  bindTools(root) {
    root.querySelectorAll('[data-tool]').forEach(button => { button.onclick = () => {
      root.closest('dialog')?.close();
      const row = this.data.records.find(item => item.RecordId === button.dataset.record);
      if (button.dataset.tool === 'frames') this.openFrameParser(row);
      else if (button.dataset.tool === 'tags') this.openTagDialog([row.RecordId]);
      else this.openFileAction(row, button.dataset.tool);
    }; });
  },
  toolDialog(title, body) {
    const dialog = this.$('#mo-tools-dialog');
    dialog.toolVersion = (dialog.toolVersion || 0) + 1;
    dialog.innerHTML = `<div class="mo-dialog-heading"><h2 id="mo-tools-title">${esc(title)}</h2><button data-tool-close aria-label="Close tools">Close ×</button></div>${body}<p class="mo-dialog-error mo-warning" role="alert"></p>`;
    dialog.querySelector('[data-tool-close]').onclick = () => dialog.close();
    if (!dialog.open) dialog.showModal();
    return dialog;
  },
  payload(row) { return {runId:this.data.uiRunId, recordId:row.RecordId, expectedPath:row.CurrentPath}; },
  async waitOperation(kind, payload, dialog) {
    const version = dialog.toolVersion;
    const started = await this.adapter.operation(kind, payload);
    this.setBusy(true);
    let job = started;
    while (job.status === 'running') {
      this.renderProgress(job);
      const output = dialog.open && dialog.toolVersion === version ? dialog.querySelector('[data-task-progress]') : null;
      if (output) output.textContent = `${job.progress?.phase || 'Working'} · ${job.progress?.completed || 0}${job.progress?.total != null ? ` / ${job.progress.total}` : ''} · ${durationLabel(job.progress?.elapsedSeconds)} elapsed${job.progress?.etaSeconds != null ? ` · about ${durationLabel(job.progress.etaSeconds)} left` : ''}`;
      this.frameJobId = (kind.startsWith('frame-') || kind.startsWith('image-') || ['clip','snapshot'].includes(kind)) ? job.id : null;
      await pause(650);
      const state = await this.adapter.state(); job = state.job;
      if (job.id !== started.id) throw new Error('Another operation finished. Reload the scan to view its current files.');
    }
    this.frameJobId = null;
    await this.refresh();
    if (job.status !== 'complete') throw new Error(job.message);
    return job;
  },
  openFileAction(row, action) {
    const runId = this.data.uiRunId, filters = {...this.filters}, duplicateFilters = {...this.duplicateFilters};
    const title = {rename:'Rename media', delete:'Delete to recoverable Trash', restore:'Restore media', purge:'Permanently delete media from Trash'}[action];
    const dialog = this.toolDialog(title, `<p>${this.identity(row)}</p><code class="mo-path">${esc(row.CurrentPath)}</code>${action === 'rename' ? `<label>New filename<input id="mo-rename" value="${esc(row.OriginalFilename)}" maxlength="200"></label>` : action === 'delete' ? `<p>This copy moves into Media Manager's recoverable Trash on the same drive. Other copies remain in place. Choose Trash in the library filter to restore it.</p>` : action === 'purge' ? `<p>This file will be permanently deleted from Media Manager's Trash. This cannot be undone. Other copies stay in place.</p>` : `<p>Restore to <code>${esc(row.RestorePath)}</code>. An existing file at that location will not be overwritten.</p>`}<p data-task-progress role="status"></p><button id="mo-file-submit" class="mo-primary">${action === 'delete' ? 'Delete this copy' : action === 'rename' ? 'Rename file' : action === 'purge' ? 'Delete permanently' : 'Restore file'}</button>`);
    const version = dialog.toolVersion;
    dialog.querySelector('#mo-file-submit').onclick = () => this.dialogAttempt(dialog, async () => {
      const button = dialog.querySelector('#mo-file-submit'); button.disabled = true;
      try {
        await this.waitOperation('file-action', {...this.payload(row), action, name:dialog.querySelector('#mo-rename')?.value, confirmation:action === 'purge' ? 'DELETE FOREVER' : action === 'delete' ? 'DELETE' : undefined}, dialog);
        this.filters = filters; this.duplicateFilters = duplicateFilters;
        await this.load(runId, {preserveFilters:true});
        if (dialog.toolVersion === version) dialog.close();
      }
      finally { button.disabled = false; }
    });
  },
  openBulkDelete(action = this.filters.status === 'trash' ? 'purge' : 'delete') {
    if (this.busy || !this.selected.size) return;
    const rows = this.data.records.filter(row => this.selected.has(row.RecordId));
    if (rows.length !== this.selected.size || rows.some(row => !this.canSelect(row))) return;
    const runId = this.data.uiRunId, items = rows.map(row => ({ recordId: row.RecordId, expectedPath: row.CurrentPath }));
    const filters = {...this.filters}, duplicateFilters = {...this.duplicateFilters};
    const phrase = `${{delete:'DELETE', restore:'RESTORE', purge:'DELETE FOREVER'}[action]} ${rows.length}`;
    const title = {delete:'Delete selected media to recoverable Trash', restore:'Restore selected media', purge:'Permanently delete selected media from Trash'}[action];
    const explanation = action === 'delete' ? 'Only these copies move to Trash on the same drive. Other copies stay in place. View Trash to restore files. Trash retains the bytes and does not free disk space.' : action === 'purge' ? 'These Trash files will be permanently removed. This cannot be undone. Copies outside Trash stay in place.' : 'These files return to their original folders. Existing files will not be overwritten.';
    const dialog = this.toolDialog(title, `<p>${rows.length} files selected, including selections hidden by filters. ${explanation}</p><div class="mo-delete-review">${rows.map(row => `<p>${this.identity(row)}<strong>${esc(row.OriginalFilename)}</strong><code class="mo-path">${esc(row.CurrentPath)}</code></p>`).join('')}</div><p data-task-progress role="status"></p><div class="mo-dialog-actions"><button id="mo-bulk-delete-cancel">Cancel</button><button id="mo-bulk-delete-submit" class="mo-delete-action">${action === 'restore' ? 'Restore reviewed files' : action === 'purge' ? 'Permanently delete reviewed files' : 'Delete reviewed files'}</button></div>`);
    const version = dialog.toolVersion, button = dialog.querySelector('#mo-bulk-delete-submit');
    dialog.querySelector('#mo-bulk-delete-cancel').onclick = () => dialog.close();
    button.onclick = () => this.dialogAttempt(dialog, async () => {
      button.disabled = true;
      try {
        await this.waitOperation('file-action', { runId, items, action, confirmation: phrase }, dialog);
        this.selected.clear(); this.filters = filters; this.duplicateFilters = duplicateFilters;
        await this.load(runId, { preserveFilters: true });
        if (dialog.toolVersion === version) dialog.close();
      } finally { button.disabled = false; }
    });
  },
  renderUserTags() {
    const tags = [...(this.data?.tags || this.tags || [])].sort((a,b)=>a.name.localeCompare(b.name));
    const node = this.$('#mo-user-tags');
    node.innerHTML = '<span>Custom tags</span><button id="mo-new-tag">+ Add tag</button>' + tags.map(tag=>`<button data-tag-filter="${esc(tag.id)}" aria-pressed="${this.filters.tag===tag.id}">${esc(tag.name)} <small>${(this.data?.records||[]).filter(r=>!r.Trashed && r.TagIds?.includes(tag.id)).length}</small></button>`).join('');
    node.querySelector('#mo-new-tag').onclick = () => this.openTagDialog([...this.selected], true);
    node.querySelectorAll('[data-tag-filter]').forEach(button=>{button.onclick=()=>{this.filters.tag=this.filters.tag===button.dataset.tagFilter?'':button.dataset.tagFilter; this.renderLibrary();};});
  },
  openTagDialog(ids = [], creating = false) {
    const dialog = this.toolDialog('Custom media tags', `<p>${ids.length} item(s) selected.</p><form id="mo-tag-create"><label>New tag name<input id="mo-tag-name" maxlength="60" required></label><button>Create tag${ids.length ? ' and apply' : ''}</button></form><div id="mo-tag-list">${(this.data?.tags||this.tags||[]).map(tag=>`<div class="mo-tag-row"><span>${esc(tag.name)}</span><button data-tag-assign="${esc(tag.id)}" ${ids.length?'':'disabled'}>Apply</button><button data-tag-remove="${esc(tag.id)}" ${ids.length?'':'disabled'}>Remove from selection</button></div>`).join('')}</div>`);
    const runId = this.data?.uiRunId, version = dialog.toolVersion;
    const refresh = async () => { if (runId) { this.data=await this.adapter.library(runId); this.renderLibrary(); } else { this.tags=(await this.adapter.state()).tags; this.renderUserTags(); } };
    dialog.querySelector('form').onsubmit = event => {event.preventDefault(); this.dialogAttempt(dialog, async()=>{
      const name=dialog.querySelector('#mo-tag-name').value.trim(); const result=await this.adapter.tags({action:'create',name});
      if(ids.length) await this.adapter.tags({action:'assign',runId,recordIds:ids,tagId:result.tag.id});
      await refresh(); if (dialog.open && dialog.toolVersion === version) this.openTagDialog(ids);
    });};
    for(const action of ['assign','remove']) dialog.querySelectorAll(`[data-tag-${action}]`).forEach(button=>{button.onclick=()=>this.dialogAttempt(dialog, async()=>{
      await this.adapter.tags({action,runId,recordIds:ids,tagId:button.getAttribute(`data-tag-${action}`)}); await refresh();
      if (dialog.open && dialog.toolVersion === version) dialog.querySelector('.mo-dialog-error').textContent=action==='assign'?'Tag applied.':'Tag removed from selection.';
    });});
    if(creating) dialog.querySelector('#mo-tag-name').focus();
  },
  async openFrameParser(row) {
    const dialog = this.toolDialog('Video → frames', `<p>${esc(row.OriginalFilename)}</p><p>Counting decoded source frames and reading frame rate with your existing FFmpeg tools…</p><p data-task-progress role="status"></p><button id="mo-frame-cancel">Cancel counting</button>`);
    const version = dialog.toolVersion;
    dialog.querySelector('#mo-frame-cancel').onclick=()=>this.frameJobId && this.adapter.cancelFrames(this.frameJobId);
    await this.dialogAttempt(dialog, async()=>{
      const job = await this.waitOperation('frame-info',this.payload(row),dialog);
      if(dialog.open && dialog.toolVersion === version) this.frameOptions(row,job.frameInfo);
    });
  },
  frameOptions(row, info) {
    const dialog=this.toolDialog('Parse video frames', `<p><strong>${esc(row.OriginalFilename)}</strong> · ${info.width} × ${info.height} · ${esc(info.codec)}</p><p><strong>${info.frames.toLocaleString()} decoded source frames</strong> · average ${info.fps?.toFixed(3) || 'unknown'} FPS · nominal ${info.nominalFps?.toFixed(3) || 'unknown'} FPS${info.variableFrameRate==='yes'?' · Variable frame rate':''}</p>
      <div class="mo-frame-options"><label>Sampling interval<select id="mo-frame-interval">${info.intervals.map(n=>`<option value="${n}" ${n===15?'selected':''}>1/${n}${n===1?' · every frame':n===2?' · every other frame':` · every ${n} frames`}</option>`).join('')}</select></label><label>Image format<select id="mo-frame-format"><option value="png">PNG · lossless</option><option value="jpg">JPEG · high quality, smaller files</option></select></label><label>First source frame<input id="mo-frame-start" type="number" min="1" max="${info.frames}" value="1"></label><label>Last source frame<input id="mo-frame-end" type="number" min="1" max="${info.frames}" value="${info.frames}"></label><label>Output width<select id="mo-frame-width"><option value="0">Original resolution</option><option value="1920">Up to 1920 px</option><option value="1280">Up to 1280 px</option><option value="640">Up to 640 px</option></select></label><label>Rotation<select id="mo-frame-rotation"><option value="0">Source orientation</option><option value="${row.ViewRotation||0}">Apply saved view rotation (${row.ViewRotation||0}°)</option></select></label></div>
      <label>Output destination folder<input id="mo-frame-destination" value="${esc(row.ScanDestination || this.data.run.destination_root)}" placeholder="Absolute folder path"></label><button id="mo-frame-pick">Choose output folder</button><p id="mo-frame-estimate" role="status"></p><p data-task-progress role="status"></p><button id="mo-frame-run" class="mo-primary">Parse frames</button><button id="mo-frame-cancel" hidden>Cancel parsing</button>`);
    const version = dialog.toolVersion;
    const settings=()=>({...this.payload(row),probeId:info.id,interval:Number(dialog.querySelector('#mo-frame-interval').value),start:Number(dialog.querySelector('#mo-frame-start').value),end:Number(dialog.querySelector('#mo-frame-end').value),format:dialog.querySelector('#mo-frame-format').value,width:Number(dialog.querySelector('#mo-frame-width').value),rotation:Number(dialog.querySelector('#mo-frame-rotation').value),destination:dialog.querySelector('#mo-frame-destination').value});
    const estimate=()=>{const s=settings(),count=Math.max(0,Math.floor((s.end-s.start)/s.interval)+1);dialog.querySelector('#mo-frame-estimate').textContent=`${count.toLocaleString()} output images. PNG/JPEG sizes depend on image content; every-frame export can use substantial space.`;};
    dialog.querySelectorAll('input,select').forEach(input=>input.oninput=estimate); estimate();
    dialog.querySelector('#mo-frame-pick').onclick=()=>this.dialogAttempt(dialog,async()=>{const {path}=await this.adapter.pickFolder('frames');if(path && dialog.open && dialog.toolVersion === version)dialog.querySelector('#mo-frame-destination').value=path;});
    dialog.querySelector('#mo-frame-cancel').onclick=()=>this.frameJobId && this.adapter.cancelFrames(this.frameJobId);
    dialog.querySelector('#mo-frame-run').onclick=()=>this.dialogAttempt(dialog,async()=>{
      const payload=settings(),button=dialog.querySelector('#mo-frame-run');button.disabled=true;dialog.querySelector('#mo-frame-cancel').hidden=false;
      try{const job=await this.waitOperation('frame-extract',payload,dialog);if(dialog.open && dialog.toolVersion === version){const output=job.frameOutput;this.toolDialog('Frames ready',`<p>${output.count.toLocaleString()} ${esc(output.settings.format.toUpperCase())} images created. Original video retained.</p><code class="mo-path">${esc(output.output)}</code><button id="mo-frames-open">Open output folder</button><button id="mo-frames-again">Parse with different options</button>`);dialog.querySelector('#mo-frames-open').onclick=()=>this.dialogAttempt(dialog,()=>this.adapter.openFolder(output.output));dialog.querySelector('#mo-frames-again').onclick=()=>this.frameOptions(row,info);}}
      finally{button.disabled=false; const cancel=dialog.querySelector('#mo-frame-cancel');if(cancel && dialog.toolVersion === version)cancel.hidden=true;}
    });
  },
};
