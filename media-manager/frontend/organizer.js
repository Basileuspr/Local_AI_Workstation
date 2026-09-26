import { captureTools } from './captures.js';
import { attachPlayback } from './playback.js';
import { createLocalAdapter } from './adapter.js';
import { mediaActions } from './actions.js';
import { imageTools } from './image-tools.js';
import { mediaBatchSizes, mediaBatchSize, mediaType, bytes, timelineGroups, dateKey, dateLabel, duplicateGroups, durationLabel, filterRecords, needsReview, yearKey } from './library.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const paths = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3Z"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  scan: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"/>',
  search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.film}</svg>`;

/** Framework-independent module. Assign .adapter before attaching to use a host bridge. */
export class MediaOrganizer extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    this.adapter ||= createLocalAdapter();
    this.data = null;
    this.restoreScope = true;
    this.filters = { query: '', year: '', category: '', review: false, order: 'newest' };
    this.pageSize = 50;
    try { this.pageSize = mediaBatchSize(localStorage.getItem('mo-page-size')); } catch {}
    this.limit = this.pageSize;
    this.view = 'grid';
    this.busy = false;
    this.tab = 'library';
    this.duplicateFilters = { query: '', year: '', order: 'newest' };
    this.duplicateLimit = 12;
    this.selected = new Set();
    this.customFolders = [];
    this.grouping='month';
    try{const grouping=localStorage.getItem('mo-grouping'),view=localStorage.getItem('mo-view');if(['day','month','year','none'].includes(grouping))this.grouping=grouping;if(['grid','list','gallery'].includes(view))this.view=view;}catch{}
    this.innerHTML = `
      <a class="mo-skip" href="#mo-library">Skip to media library</a>
      <header class="mo-header"><div class="mo-brand"><span class="mo-brand-mark">${icon('film')}</span><strong>Media Manager</strong><span class="mo-version">LOCAL WORKSPACE</span></div><div class="mo-header-tools"><button id="mo-image-tools">Image tools</button><span class="mo-local"><i></i> On your computer</span></div></header>
      <div class="mo-layout">
        <aside class="mo-sidebar" aria-label="Library navigation">
          <div class="mo-sidebar-top"><span class="mo-eyebrow">WORKSPACE</span><div class="mo-nav-current">${icon('grid')} Media library</div></div>
          <div class="mo-sidebar-section"><button id="mo-all-videos" class="mo-year" aria-pressed="false">All videos · all scans</button><label class="mo-eyebrow" for="mo-history">LIBRARY SCOPE / SAVED SCANS</label><select id="mo-history"><option value="">Start a new scan</option></select></div>
          <nav class="mo-sidebar-section" aria-label="Browse by year"><span class="mo-eyebrow">BROWSE BY DATE</span><div id="mo-years"></div></nav>
          <section class="mo-sidebar-section mo-custom-section" aria-labelledby="mo-custom-label"><div class="mo-custom-heading"><span id="mo-custom-label" class="mo-eyebrow">Custom Folders</span><button id="mo-add-custom-folder" class="mo-icon-button" aria-label="Add custom folder" title="Add custom folder">+</button></div><div id="mo-custom-folders"></div></section>
          <div class="mo-sidebar-bottom">${icon('folder')}<div><strong>Your folders. Your files.</strong><p>Media stays on your computer, accessible in File Explorer.</p></div></div>
        </aside>
        <main class="mo-main">
          <div class="mo-display-toolbar"><label for="mo-page-size">Items at a time</label><select id="mo-page-size">${mediaBatchSizes.map(size => `<option value="${size}" ${mediaBatchSize(size) === this.pageSize ? 'selected' : ''}>${size}</option>`).join('')}</select><span id="mo-visible-count" role="status"></span></div>
          <div class="mo-workspace-tabs" role="tablist" aria-label="Media workspace"><button id="mo-library-tab" role="tab" aria-selected="true" aria-controls="mo-organize-panel" data-tab="library">${icon('grid')} Media library</button><button id="mo-duplicates-tab" role="tab" aria-selected="false" aria-controls="mo-duplicates-panel" tabindex="-1" data-tab="duplicates">${icon('film')} Duplicates <span id="mo-duplicate-tab-count">0</span></button></div>
          <div class="mo-capture-access"><button id="mo-snapshots">Snapshots</button><button id="mo-clips">Saved clips</button></div>
          <div id="mo-organize-panel" role="tabpanel" aria-labelledby="mo-library-tab">
          <div class="mo-title"><div><div class="mo-eyebrow">A PLACE FOR EVERY RECORDING</div><h1>From scattered to sorted.</h1><p>Choose your folders. Review the plan. Find every moment by date.</p></div><span class="mo-tag">MP4 videos</span></div>
          <section class="mo-flow" aria-label="Organizing workflow">
            <article class="mo-step"><div class="mo-step-heading"><span class="mo-step-number">01</span><h2>Take from</h2>${icon('folder')}</div><p>Your backup or unsorted media folder.</p><label for="mo-source">Source folder</label><input id="mo-source" type="text" spellcheck="false" placeholder="Paste a full folder path" autocomplete="off"><div class="mo-step-actions"><button data-pick="source">${icon('folder')} Choose folder</button><button class="mo-icon-button" data-open="source" aria-label="Open source folder in File Explorer" title="Open source folder">${icon('external')}</button></div><small>Includes MP4 files in subfolders.</small></article>
            <span class="mo-connector">${icon('arrow')}</span>
            <article class="mo-step mo-process"><div class="mo-step-heading"><span class="mo-step-number">02</span><h2>Find & organize</h2>${icon('scan')}</div><p>Read dates, identify duplicates, and plan.</p><label for="mo-duplicates">Duplicate copies</label><select id="mo-duplicates"><option value="all">Keep every copy</option><option value="separate">Put extra copies in _Duplicates</option><option value="leave">Leave extra copies in the source</option></select><div class="mo-process-details"><span>${icon('check')} Date & category</span><span>${icon('check')} File integrity</span></div><small>Scanning does not move your files.</small></article>
            <span class="mo-connector">${icon('arrow')}</span>
            <article class="mo-step"><div class="mo-step-heading"><span class="mo-step-number">03</span><h2>Put into</h2>${icon('folder')}</div><p>Your organized archive on disk.</p><label for="mo-destination">Destination folder</label><input id="mo-destination" type="text" spellcheck="false" placeholder="Paste a full folder path" autocomplete="off"><div class="mo-step-actions"><button data-pick="destination">${icon('folder')} Choose folder</button><button class="mo-icon-button" data-open="destination" aria-label="Open destination folder in File Explorer" title="Open destination folder">${icon('external')}</button></div><small>Year / Category / Original filename.mp4</small></article>
          </section>
          <div class="mo-action-bar"><div><span id="mo-phase" class="mo-phase">Ready when you are</span><p id="mo-plan-caption">Select two folders to preview how your videos will be organized.</p></div><div class="mo-actions"><button id="mo-scan" class="mo-primary">${icon('scan')} Scan & preview</button><button id="mo-move" disabled>Review move ${icon('arrow')}</button></div></div>
          <div id="mo-status" class="mo-status" role="status" aria-live="polite" hidden></div>
          <section id="mo-progress" class="mo-progress" aria-labelledby="mo-progress-title" hidden>
            <div class="mo-progress-heading"><strong id="mo-progress-title">Preparing…</strong><span id="mo-progress-count"></span></div>
            <progress id="mo-progress-bar" max="100" aria-labelledby="mo-progress-title" aria-describedby="mo-progress-time"></progress>
            <div id="mo-progress-time" class="mo-progress-time"><span id="mo-elapsed">Elapsed 0s</span><span id="mo-remaining">Estimating time…</span></div>
            <p id="mo-progress-file"></p>
          </section>
          <details id="mo-job-details" hidden><summary>Operation report</summary><pre></pre></details>
          <section id="mo-library" class="mo-library" aria-labelledby="mo-library-title" tabindex="-1">
            <div class="mo-library-heading"><div><h2 id="mo-library-title">Your media, by date <span id="mo-count">0</span></h2><p id="mo-scope-description">One timeline across every folder and category.</p></div><div class="mo-segmented" aria-label="Media layout"><label>Group by<select id="mo-grouping" aria-label="Group media by"><option value="day">Day</option><option value="month" selected>Month</option><option value="year">Year</option><option value="none">No groups</option></select></label><button data-view="gallery" aria-label="Large gallery view" aria-pressed="false">Large previews</button><button data-view="grid" aria-label="Grid view" aria-pressed="true">${icon('grid')}</button><button data-view="list" aria-label="List view" aria-pressed="false">${icon('list')}</button></div></div>
            <div class="mo-filters"><label class="mo-search">${icon('search')}<input id="mo-search" type="search" placeholder="Search filenames, folders, or categories" aria-label="Search media"></label><select id="mo-category" aria-label="Filter by category"><option value="">All categories</option></select><select id="mo-order" aria-label="Sort media"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="duration-desc">Duration · longest first</option><option value="duration-asc">Duration · shortest first</option><option value="size-desc">Size · largest first</option><option value="size-asc">Size · smallest first</option><option value="type-asc">Type / codec</option><option value="name-asc">Filename · A–Z</option><option value="name-desc">Filename · Z–A</option><option value="resolution-desc">Resolution · highest first</option><option value="fps-desc">Frame rate · highest first</option><option value="bitrate-desc">Bit rate · highest first</option></select><button id="mo-review" aria-pressed="false">Needs review <span id="mo-review-count">0</span></button></div>
            <details class="mo-advanced-filters"><summary>More filters · type, duration, size, audio, Trash</summary><div class="mo-frame-options"><label>Type / codec<select id="mo-type"><option value="">All types</option></select></label><label>Library status<select id="mo-library-status"><option value="">Active media</option><option value="trash">Recoverable Trash</option></select></label><label>Audio<select id="mo-audio"><option value="">Any audio</option><option value="sound">Has audio</option><option value="silent">No audio</option></select></label><label>Minimum duration (seconds)<input id="mo-minDuration" type="number" min="0" step="any"></label><label>Maximum duration (seconds)<input id="mo-maxDuration" type="number" min="0" step="any"></label><label>Minimum size (MiB)<input id="mo-minSize" type="number" min="0" step="any"></label><label>Maximum size (MiB)<input id="mo-maxSize" type="number" min="0" step="any"></label></div></details>
            <div id="mo-user-tags" class="mo-category-tags" role="group" aria-label="Custom tag filters"></div>
            <div id="mo-category-tags" class="mo-category-tags" role="group" aria-label="Category filter tags" hidden></div>
            <div id="mo-selection-bar" class="mo-selection-bar" hidden><span id="mo-selection-count" role="status">0 selected</span><div><button id="mo-select-matching">Select matching clips</button><button id="mo-clear-selection" disabled>Clear selection</button><button id="mo-tag-selected" disabled>Tag selected</button><button id="mo-sort-custom" class="mo-primary" disabled>${icon('folder')} Place in folder</button><button id="mo-new-with-selected" disabled>Start Folder with item</button><button id="mo-rotate-selected" disabled title="Rotate view right; originals unchanged">Rotate selected ↷</button></div></div>
            <div id="mo-results" aria-live="polite"></div>
          </section>
          <footer class="mo-footer"><span>${icon('clock')} Dates follow the scan’s best available evidence.</span><span>Unknown dates stay visible.</span></footer>
          </div>
          <section id="mo-duplicates-panel" role="tabpanel" aria-labelledby="mo-duplicates-tab" tabindex="-1" hidden>
            <div class="mo-duplicate-heading"><div><h1>Duplicates</h1><p id="mo-duplicate-summary">Identical files, together. Click a preview to enlarge.</p></div><label class="mo-duplicate-history">Saved scan<select id="mo-duplicate-history"><option value="">Start a new scan</option></select></label></div>
            <div class="mo-duplicate-toolbar"><label class="mo-search">${icon('search')}<input id="mo-duplicate-search" type="search" aria-label="Search duplicates" placeholder="Search filenames or locations"></label><select id="mo-duplicate-year" aria-label="Filter duplicates by year"><option value="">All dates</option></select><select id="mo-duplicate-order" aria-label="Sort duplicate groups by date"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><button id="mo-duplicate-size" aria-pressed="false">Larger previews</button></div>
            <p id="mo-duplicate-job" class="mo-duplicate-job" role="status" hidden></p><p id="mo-duplicate-notice" class="mo-status mo-error" role="alert" hidden></p>
            <div id="mo-duplicate-results"></div>
          </section>
        </main>
      </div>
      <dialog class="mo-dialog mo-tools-dialog" id="mo-tools-dialog" aria-labelledby="mo-tools-title"></dialog>
      <dialog class="mo-dialog" id="mo-detail" aria-labelledby="mo-detail-title"></dialog>
      <dialog class="mo-dialog mo-duplicate-viewer" id="mo-duplicate-viewer" aria-labelledby="mo-duplicate-viewer-title"></dialog>
      <dialog class="mo-dialog mo-custom-dialog" id="mo-custom-dialog" aria-labelledby="mo-custom-dialog-title"></dialog>
      <dialog class="mo-dialog mo-confirm" id="mo-confirm" aria-labelledby="mo-confirm-title"></dialog>`;
    this.$('#mo-all-videos').onclick = () => this.attempt(() => this.load('all-scans'));
    this.$('#mo-image-tools').onclick = () => this.openImageTools();
    this.$('#mo-tag-selected').onclick = () => this.openTagDialog([...this.selected]);
    for(const key of ['type','status','audio','minDuration','maxDuration','minSize','maxSize']) this.$(`#mo-${key==='status'?'library-status':key}`).onchange = event => { this.filters[key]=event.target.value; this.limit=this.pageSize; this.renderLibrary(); };
    this.$('#mo-page-size').onchange = event => {
      this.pageSize = mediaBatchSize(event.target.value);
      this.limit = this.pageSize;
      try { localStorage.setItem('mo-page-size', event.target.value); } catch {}
      this.renderLibrary();
    };
    this.bind();
    this.renderLibrary();
    try { if (sessionStorage.getItem('mo-active-tab') === 'duplicates') this.switchTab('duplicates'); } catch {}
    this.poll();
  }
  disconnectedCallback() {
    this.rotationObserver?.disconnect(); clearTimeout(this.timer); this.initialized = false; }
  $(selector) { return this.querySelector(selector); }
  async poll() {
    if (!this.isConnected) return;
    try { await this.refresh(); }
    catch (error) {
      if (!this.isConnected) return;
      this.notice(`${error.message} Reconnecting…`, true);
      this.timer = setTimeout(() => this.poll(), 3000);
    }
  }
  async attempt(action) { try { await action(); } catch (error) { this.notice(error.message, true); } }
  notice(message, error = false) {
    const status = this.$('#mo-status');
    status.hidden = false;
    status.classList.toggle('mo-error', error);
    status.textContent = message;
    this.$('#mo-duplicate-notice').hidden = !error;
    this.$('#mo-duplicate-notice').textContent = error ? message : '';
  }
  renderProgress(job) {
    const progress = job.progress;
    const panel = this.$('#mo-progress');
    panel.hidden = !progress;
    if (!progress) return;
    const running = job.status === 'running';
    let cancel=panel.querySelector('[data-cancel-frames]'); if(!cancel){cancel=document.createElement('button');cancel.dataset.cancelFrames='';cancel.textContent='Cancel operation';panel.append(cancel);}
    cancel.hidden=!(running && (job.kind.startsWith('frame-') || job.kind.startsWith('image-')));cancel.onclick=()=>this.adapter.cancelFrames(job.id);
    this.$('#mo-duplicate-job').hidden = !running;
    this.$('#mo-duplicate-job').textContent = running ? `${job.kind === 'scan' ? 'Scan' : 'Move'} in progress · ${durationLabel(progress.elapsedSeconds)} elapsed` : '';
    const titles = { 'finding-images':'Finding images in the folder', processing:'Processing image copies', counting:'Counting decoded source frames', verifying:'Verifying source video', extracting:'Parsing frames', preparing: 'Preparing', discovering: 'Finding MP4 files', analyzing: 'Analyzing media', moving: 'Moving & verifying files', finalizing: 'Writing reports', complete: job.kind === 'scan' ? 'Scan complete' : job.kind === 'frame-extract' ? 'Frames ready' : job.kind === 'frame-info' ? 'Source frames counted' : 'Operation complete' };
    const title = job.status === 'error' ? 'Operation ended with an error' : titles[progress.phase] || 'Working';
    this.$('#mo-progress-title').textContent = title;
    const bar = this.$('#mo-progress-bar');
    if (progress.percent == null && running) bar.removeAttribute('value');
    else bar.value = progress.percent ?? 0;
    const count = progress.total != null ? `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} ${job.kind === 'frame-extract' ? 'frames parsed' : 'files processed'}`
      : progress.phase === 'discovering' ? `${progress.completed.toLocaleString()} MP4 files found` : '';
    this.$('#mo-progress-count').textContent = [progress.percent == null ? '' : `${Math.floor(progress.percent)}%`, count].filter(Boolean).join(' · ');
    bar.setAttribute('aria-valuetext', `${title}${count ? `: ${count}` : ''}`);
    this.$('#mo-elapsed').textContent = `Elapsed ${durationLabel(progress.elapsedSeconds)}`;
    this.$('#mo-remaining').textContent = job.status === 'complete' ? 'Finished'
      : job.status === 'error' ? 'Estimate unavailable'
      : progress.etaSeconds != null ? `About ${durationLabel(Math.max(1, progress.etaSeconds))} left in this step`
      : progress.phase === 'discovering' ? 'Estimating after discovery…'
      : progress.phase === 'finalizing' ? 'Finishing reports…' : 'Estimating time…';
    const file = this.$('#mo-progress-file');
    const byteInfo = progress.totalBytes != null ? `${bytes(progress.bytesCompleted || 0)} / ${bytes(progress.totalBytes)} read` : '';
    file.textContent = [byteInfo, progress.currentFile].filter(Boolean).join(' · ');
    file.title = file.textContent;
    file.hidden = !file.textContent;
  }
  bind() {
    this.$('#mo-snapshots').onclick=()=>this.openCaptureGallery('snapshot');
    this.$('#mo-clips').onclick=()=>this.openCaptureGallery('clip');
    this.$('#mo-grouping').value=this.grouping;
    this.$('#mo-grouping').onchange=e=>{this.grouping=e.target.value;try{localStorage.setItem('mo-grouping',this.grouping);}catch{}this.renderLibrary();};
    this.$('#mo-add-custom-folder').onclick = () => this.openCustomFolderDialog();
    this.$('#mo-select-matching').onclick = () => {
      filterRecords(this.data?.records || [], this.filters).filter(row => this.canSelect(row)).forEach(row => this.selected.add(row.RecordId));
      this.updateSelection();
    };
    this.$('#mo-clear-selection').onclick = () => { this.selected.clear(); this.updateSelection(); };
    this.$('#mo-sort-custom').onclick = () => this.openCustomMoveDialog();
    this.$('#mo-new-with-selected').onclick = () => { const ids = [...this.selected]; this.openCustomFolderDialog(id => this.openCustomMoveDialog(id, ids)); };
    this.$('#mo-rotate-selected').onclick = () => this.attempt(async () => {
      for (const id of [...this.selected]) await this.rotate(id, 1);
    });
    const tabs = [...this.querySelectorAll('[data-tab]')];
    tabs.forEach((button, index) => {
      button.addEventListener('click', () => this.switchTab(button.dataset.tab));
      button.addEventListener('keydown', event => {
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
          : event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : null;
        if (target == null) return;
        event.preventDefault(); tabs[target].click(); tabs[target].focus();
      });
    });
    this.$('#mo-duplicate-search').addEventListener('input', event => { this.duplicateFilters.query = event.target.value; this.duplicateLimit = 12; this.renderDuplicates(); });
    for (const key of ['year', 'order']) this.$(`#mo-duplicate-${key}`).addEventListener('change', event => { this.duplicateFilters[key] = event.target.value; this.duplicateLimit = 12; this.renderDuplicates(); });
    this.$('#mo-duplicate-size').addEventListener('click', event => {
      const larger = this.$('#mo-duplicates-panel').classList.toggle('mo-duplicate-larger');
      event.currentTarget.setAttribute('aria-pressed', String(larger));
      event.currentTarget.textContent = larger ? 'Standard previews' : 'Larger previews';
    });
    this.$('#mo-duplicate-history').addEventListener('change', event => this.attempt(async () => {
      if (event.target.value) await this.load(event.target.value);
      else this.newScan();
    }));
    this.$('#mo-duplicate-viewer').addEventListener('close', () => { this.$('#mo-duplicate-viewer').innerHTML = ''; });
    this.querySelectorAll('[data-pick]').forEach(button => button.addEventListener('click', () => this.attempt(async () => {
      button.disabled = true;
      try {
        const { path } = await this.adapter.pickFolder(button.dataset.pick);
        if (path) { this.$(`#mo-${button.dataset.pick}`).value = path; this.planChanged(); }
      } finally { button.disabled = this.busy; }
    })));
    this.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', () => this.attempt(() => this.adapter.openFolder(this.$(`#mo-${button.dataset.open}`).value))));
    ['source', 'destination', 'duplicates'].forEach(name => this.$(`#mo-${name}`).addEventListener('input', () => this.planChanged()));
    this.$('#mo-scan').addEventListener('click', () => this.attempt(async () => {
      if (this.data?.aggregate) { this.newScan(); this.$('#mo-source').focus(); return; }
      const source = this.$('#mo-source').value.trim().replace(/^"|"$/g, '');
      const destination = this.$('#mo-destination').value.trim().replace(/^"|"$/g, '');
      if (!source || !destination) { this.$(!source ? '#mo-source' : '#mo-destination').focus(); throw new Error('Choose both a source and a destination folder first.'); }
      this.setBusy(true);
      try { await this.adapter.scan({ source, destination, duplicates: this.$('#mo-duplicates').value }); await this.refresh(); }
      catch (error) { this.setBusy(false); throw error; }
    }));
    this.$('#mo-history').addEventListener('change', event => this.attempt(async () => {
      if (event.target.value) await this.load(event.target.value);
      else this.newScan();
    }));
    this.$('#mo-search').addEventListener('input', event => { this.filters.query = event.target.value; this.limit = this.pageSize; this.renderLibrary(); });
    for (const key of ['category', 'order']) this.$(`#mo-${key}`).addEventListener('change', event => { this.filters[key] = event.target.value; this.limit = this.pageSize; this.renderLibrary(); });
    this.$('#mo-review').addEventListener('click', () => { this.filters.review = !this.filters.review; this.limit = this.pageSize; this.renderLibrary(); });
    this.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => { this.view = button.dataset.view;try{localStorage.setItem('mo-view',this.view);}catch{} this.renderLibrary(); }));
    this.$('#mo-move').addEventListener('click', () => this.confirmMove());
    this.$('#mo-detail').addEventListener('close', () => { this.$('#mo-detail').innerHTML = ''; });
  }
  newScan() {
    this.libraryRequest = (this.libraryRequest || 0) + 1;
    this.data = null; this.selected.clear(); this.filters = { query:'', year:'', category:'', review:false, order:'newest' };
    this.$('#mo-history').value = this.$('#mo-duplicate-history').value = '';
    this.$('#mo-source').value = this.$('#mo-destination').value = this.$('#mo-search').value = '';
    try { sessionStorage.setItem('mo-library-scope', ''); } catch {}
    this.planChanged(); this.renderLibrary();
  }
  setBusy(busy) {
    this.busy = busy;
    this.querySelectorAll('[data-pick], #mo-source, #mo-destination, #mo-duplicates, #mo-scan, #mo-history, #mo-duplicate-history, #mo-all-videos').forEach(el => { el.disabled = busy; });
    this.$('#mo-scan').innerHTML = `${icon('scan')} ${busy ? 'Working…' : this.data?.aggregate ? 'Scan another folder' : 'Scan & preview'}`;
    this.$('.mo-flow').setAttribute('aria-busy', String(busy));
    this.updatePlan();
    this.updateSelection();
    this.$('#mo-add-custom-folder').disabled = busy;
  }
  planChanged() { this.planDirty = true; this.updatePlan(); }
  pendingRecords() { if(this.data?.aggregate) return []; return (this.data?.records || []).filter(r => r.Approved === 'yes' && !r.Moved && r.Available && r.ProposedDestination); }
  updatePlan() {
    const all = Boolean(this.data?.aggregate);
    this.$('.mo-flow').hidden = all;
    this.$('#mo-move').hidden = all;
    this.$('#mo-all-videos').setAttribute('aria-pressed', String(all));
    this.$('.mo-title h1').textContent = all ? 'Every folder, one timeline.' : 'From scattered to sorted.';
    this.$('.mo-title p').textContent = all ? 'Choose a year to browse videos across all saved scans.' : 'Choose your folders. Review the plan. Find every moment by date.';
    this.$('#mo-scan').innerHTML = `${icon('scan')} ${this.busy ? 'Working…' : all ? 'Scan another folder' : 'Scan & preview'}`;
    if(all){
      this.$('#mo-move').disabled=true;
      this.$('#mo-phase').textContent=this.busy?'Working on your files':`${this.data.folderCount} scanned folders · ${this.data.scanCount} saved scans`;
      this.$('#mo-plan-caption').textContent='Repeated scans of the same file location appear once. Select clips to place them in a folder, or choose a saved scan to review its archive plan.';
      return;
    }
    const pending = this.pendingRecords().length;
    this.$('#mo-move').disabled = this.busy || !pending || this.planDirty;
    this.$('#mo-phase').textContent = this.busy ? 'Working on your files' : this.data ? this.planDirty ? 'Settings changed · scan again' : `${pending} files ready to move` : 'Ready when you are';
    this.$('#mo-plan-caption').textContent = this.data ? `Showing scan ${this.data.uiRunId}. ${this.planDirty ? 'Run a new scan to update the plan.' : 'Review any file below to see its current and planned locations.'}` : 'Select two folders to preview how your videos will be organized.';
  }
  async refresh() {
    clearTimeout(this.timer);
    const state = await this.adapter.state();
    if (!this.isConnected) return;
    const current = this.data?.uiRunId || '';
    this.managedRoot = state.managedRoot;
    this.customFolders = state.customFolders || [];
    this.tags = state.tags || [];
    this.renderUserTags();
    this.renderCustomFolders();
    this.$('#mo-history').innerHTML = '<option value="all-scans">All scans · every folder</option><option value="">Start a new scan</option>' + state.runs.map(run => `<option value="${escape(run.id)}">${escape(run.finished.replace('T', ' '))} · ${run.count} files · ${escape(run.source)}</option>`).join('');
    this.$('#mo-history').value = current;
    this.$('#mo-duplicate-history').innerHTML = this.$('#mo-history').innerHTML;
    this.$('#mo-duplicate-history').value = current;
    this.setBusy(state.job.status === 'running');
    this.renderProgress(state.job);
    if (state.job.status !== 'idle') this.notice(state.job.message, state.job.status === 'error');
    if (this.restoreScope) {
      this.restoreScope = false;
      let saved = null; try { saved = sessionStorage.getItem('mo-library-scope'); } catch {}
      if (saved === 'all-scans' || state.runs.some(run => run.id === saved) || (saved === null && state.runs.length)) {
        await this.load(saved || 'all-scans');
        if (state.job.status==='complete' && state.job.customFolderId && state.job.runId===this.data?.uiRunId) {this.filters.folder=state.job.customFolderId;this.renderLibrary();}
        this.lastJob = JSON.stringify(state.job);
      }
    }
    if (this.busy) {
      this.timer = setTimeout(() => this.poll(), 1200);
    } else {
      if (state.job.runId && state.job.status !== 'running' && this.lastJob !== JSON.stringify(state.job)) {
        if(!['snapshot','clip'].includes(state.job.kind))await this.load(this.data?.aggregate ? 'all-scans' : state.job.runId, { preserveFilters:Boolean(this.data?.aggregate) });
        if (state.job.status === 'complete' && state.job.customFolderId) {
          this.filters.folder = state.job.customFolderId;
          this.renderLibrary();
        }
        this.lastJob = JSON.stringify(state.job);
      }
      const details = this.$('#mo-job-details');
      details.hidden = !state.job.details;
      details.querySelector('pre').textContent = state.job.details || '';
    }
  }
  async load(runId, { preserveFilters = false } = {}) {
    const previousFilters = this.filters, previousDuplicates = this.duplicateFilters;
    const request = this.libraryRequest = (this.libraryRequest || 0) + 1;
    const data = await this.adapter.library(runId);
    if (request !== this.libraryRequest || !this.isConnected) return;
    this.data = data;
    try { sessionStorage.setItem('mo-library-scope', runId); } catch {}
    this.customFolders = this.data.customFolders || this.customFolders;
    this.selected.clear();
    this.planDirty = false;
    this.filters = { query: '', year: '', category: '', review: false, order: 'newest' };
    this.limit = this.pageSize;
    this.duplicateFilters = { query: '', year: '', order: 'newest' };
    this.duplicateLimit = 12;
    this.$('#mo-duplicate-search').value = '';
    this.$('#mo-duplicate-order').value = 'newest';
    this.$('#mo-source').value = this.data.run.source_root;
    this.$('#mo-destination').value = this.data.run.destination_root;
    this.$('#mo-duplicates').value = this.data.run.options?.duplicates || 'all';
    this.$('#mo-history').value = runId;
    this.$('#mo-duplicate-history').value = runId;
    this.$('#mo-search').value = '';
    this.$('#mo-order').value = 'newest';
    if(!preserveFilters && runId==='all-scans'){try { const year=sessionStorage.getItem('mo-library-year:'+runId);if(year && this.data.records.some(row=>yearKey(row)===year))this.filters.year=year; } catch {}}
    if(preserveFilters){this.filters=previousFilters;this.duplicateFilters=previousDuplicates;this.$('#mo-search').value=this.filters.query;this.$('#mo-order').value=this.filters.order;this.$('#mo-duplicate-search').value=this.duplicateFilters.query;this.$('#mo-duplicate-order').value=this.duplicateFilters.order;}
    this.updatePlan();
    this.renderLibrary();
  }
  renderLibrary() {
    this.renderDuplicates();
    const records = this.data?.records || [];
    const scope = this.$('#mo-scope-description');
    scope.textContent = this.data?.aggregate ? `All videos across ${this.data.folderCount} scanned folders · ${this.data.scanCount} saved scans. Years use each video's resolved media date.${this.data.readErrors.length ? ` ${this.data.readErrors.length} saved scan(s) could not be read.` : ''}` : this.data ? `This saved scan: ${this.data.run.source_root}` : 'Scan folders to add their videos, then choose All videos to browse them together.';
    scope.title=(this.data?.readErrors || []).map(item=>`${item.scan}: ${item.error}`).join('\n');scope.classList.toggle('mo-warning',Boolean(this.data?.readErrors?.length));
    this.renderCustomFolders();
    this.renderCategoryTags(records); this.renderUserTags();
    const types=[...new Set(records.map(mediaType))].sort(); this.$('#mo-type').innerHTML='<option value="">All types</option>'+types.map(type=>`<option>${escape(type)}</option>`).join('');
    for(const key of ['type','status','audio','minDuration','maxDuration','minSize','maxSize']) this.$(`#mo-${key==='status'?'library-status':key}`).value=this.filters[key]||'';
    const years = [...new Set(records.map(yearKey))].sort((a, b) => a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : b.localeCompare(a));
    this.$('#mo-years').innerHTML = [{ key: '', name: 'All dates', count: records.length }, ...years.map(key => ({ key, name: key === 'Unknown' ? 'Unknown date' : key, count: records.filter(r => yearKey(r) === key).length }))].map(item => `<button class="mo-year" data-year="${item.key}" aria-pressed="${this.filters.year === item.key}"><span>${item.name}</span><span>${item.count}</span></button>`).join('');
    this.querySelectorAll('[data-year]').forEach(button => button.addEventListener('click', () => { this.filters.year = button.dataset.year; try { if(this.data?.aggregate) sessionStorage.setItem('mo-library-year:all-scans', this.filters.year); } catch {} this.limit = this.pageSize; this.renderLibrary(); this.$(`[data-year="${button.dataset.year}"]`).focus(); }));
    this.$('#mo-review').setAttribute('aria-pressed', String(this.filters.review));
    this.$('#mo-review-count').textContent = records.filter(needsReview).length;
    this.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === this.view)));
    const filtered = filterRecords(records, this.filters);
    this.$('#mo-visible-count').textContent = `Showing ${Math.min(this.limit, filtered.length)} of ${filtered.length}`;
    this.updateSelection();
    this.$('#mo-count').textContent = filtered.length;
    const result = this.$('#mo-results');
    if (!filtered.length) {
      result.innerHTML = `<div class="mo-empty"><span class="mo-empty-icon">${icon(records.length ? 'search' : 'film')}</span><h3>${records.length ? 'No matching videos' : this.data ? 'No MP4 files in this scan' : 'Your timeline starts here'}</h3><p>${records.length ? 'Try another date, category, or search.' : this.data ? 'Choose another source folder and scan again.' : 'Choose a source and destination above, then scan.<br>Your videos will appear here, grouped by date.'}</p>${records.length ? '<button id="mo-clear">Clear filters</button>' : '<span class="mo-empty-note">01 Choose folders <span>→</span> 02 Scan & preview <span>→</span> 03 Review & move</span>'}</div>`;
      this.$('#mo-clear')?.addEventListener('click', () => { this.filters = { query: '', year: '', category: '', review: false, order: 'newest' }; this.$('#mo-search').value = ''; this.$('#mo-category').value = ''; this.$('#mo-order').value = 'newest'; this.renderLibrary(); });
      return;
    }
    const groups = timelineGroups(filtered, this.grouping, this.filters.order);
    let remaining=this.limit;
    result.innerHTML=groups.map(group=>{if(remaining<=0)return '';const rows=group.rows.slice(0,remaining);remaining-=rows.length;return `<section class="mo-date-group"><h3>${icon('clock')} <strong>${escape(group.label)}</strong><span>${group.rows.length} video${group.rows.length===1?'':'s'}</span></h3><div class="mo-media-${this.view}">${rows.map(r=>this.card(r)).join('')}</div></section>`;}).join('')+(filtered.length>this.limit?`<div class="mo-more"><button id="mo-more">Show next ${Math.min(this.pageSize,filtered.length-this.limit)} videos</button><span>Showing ${this.limit} of ${filtered.length}</span></div>`:'');
    this.querySelectorAll('[data-detail]').forEach(button => button.addEventListener('click', () => this.showDetail(button.dataset.detail)));
    this.$('#mo-results').querySelectorAll('[data-select-media]').forEach(checkbox => checkbox.addEventListener('change', () => {
      if (checkbox.checked) this.selected.add(checkbox.dataset.selectMedia); else this.selected.delete(checkbox.dataset.selectMedia);
      this.updateSelection();
    }));
    this.updateSelection();
    this.bindThumbnails(this.$('#mo-results')); this.bindItemActions(this.$('#mo-results'));
    this.querySelectorAll('[data-reveal]').forEach(button => button.addEventListener('click', () => this.attempt(() => this.adapter.reveal(this.data.uiRunId, button.dataset.reveal))));
    this.$('#mo-more')?.addEventListener('click', () => { this.limit += this.pageSize; this.renderLibrary(); });
  }
  renderCategoryTags(records) {
    const labels = { 'TikTok / Social Media': 'TikTok', 'Camera Recording': 'Camera',
      'Downloaded Video': 'Downloads', 'Screen Recording': 'Screen recordings', 'Messaging/App Media': 'Messaging' };
    const counts = new Map();
    records.forEach(row => { const category = row.Classification || 'Unknown'; counts.set(category, (counts.get(category) || 0) + 1); });
    const categories = [...counts.keys()].sort();
    const dropdown = this.$('#mo-category');
    dropdown.innerHTML = '<option value="">All categories</option>' + categories.map(category => `<option value="${escape(category)}">${escape(category)}</option>`).join('');
    dropdown.value = this.filters.category;
    const tags = this.$('#mo-category-tags');
    tags.hidden = !records.length;
    tags.innerHTML = [{ category: '', label: 'All clips', count: records.length }, ...categories.map(category => ({ category, label: labels[category] || category, count: counts.get(category) }))]
      .map(tag => `<button class="mo-category-tag" data-category-tag="${escape(tag.category)}" aria-label="${escape(tag.label)}" aria-pressed="${this.filters.category === tag.category}" title="${escape(tag.category || 'All categories')} · ${tag.count} clips in this library scope">${escape(tag.label)}<span aria-hidden="true">${tag.count}</span></button>`).join('');
    tags.querySelectorAll('[data-category-tag]').forEach(button => button.addEventListener('click', () => {
      this.filters.category = this.filters.category === button.dataset.categoryTag ? '' : button.dataset.categoryTag;
      this.limit = this.pageSize;
      this.renderLibrary();
      [...this.$('#mo-category-tags').querySelectorAll('button')].find(tag => tag.dataset.categoryTag === button.dataset.categoryTag)?.focus();
    }));
  }
  itemActions(row, expanded = false) {
    return `<div class="mo-item-actions" aria-label="Actions for ${escape(row.OriginalFilename)}"><button data-rotate-left="${escape(row.RecordId)}" title="Rotate view left; original unchanged">↶ Rotate</button><button data-rotate-right="${escape(row.RecordId)}" title="Rotate view right; original unchanged">Rotate ↷</button><button data-place-item="${escape(row.RecordId)}" ${this.busy || !this.canSelect(row) ? 'disabled' : ''}>Place in folder</button><button data-new-item="${escape(row.RecordId)}" ${this.busy || !this.canSelect(row) ? 'disabled' : ''}>Start Folder with item</button>${this.extraActions(row, expanded)}</div>`;
  }
  bindItemActions(root) {
    this.bindTools(root);
    for (const [attribute, direction] of [['data-rotate-left', -1], ['data-rotate-right', 1]]) root.querySelectorAll(`[${attribute}]`).forEach(button => { button.onclick = () => this.dialogAttempt(root, async () => {
      button.disabled = true;
      try { await this.rotate(button.getAttribute(attribute), direction); } finally { button.disabled = false; }
    }); });
    for (const attribute of ['data-place-item', 'data-new-item']) root.querySelectorAll(`[${attribute}]`).forEach(button => { button.onclick = () => {
      const ids = [button.getAttribute(attribute)];
      root.closest('dialog')?.close();
      if (attribute === 'data-new-item') this.openCustomFolderDialog(id => this.openCustomMoveDialog(id, ids));
      else this.openCustomMoveDialog('', ids);
    }; });
  }
  async rotate(id, direction) {
    const result = await this.adapter.rotate(this.data.uiRunId, id, direction);
    this.data.records.forEach(row => { if (row.RecordId === result.recordId) row.ViewRotation = result.rotation; });
    this.applyRotations(this);
  }
  applyRotations(root) {
    root.querySelectorAll('[data-rotation-record]').forEach(media => {
      const row = this.data?.records.find(r => r.RecordId === media.dataset.rotationRecord);
      const angle = row?.ViewRotation || 0;
      const thumbnail = media.closest('.mo-thumbnail');
      if (thumbnail) {
        media.style.width = `${angle % 180 ? thumbnail.clientHeight : thumbnail.clientWidth}px`;
        media.style.height = `${angle % 180 ? thumbnail.clientWidth : thumbnail.clientHeight}px`;
        media.style.left = '50%'; media.style.top = '50%';
        media.style.transform = `translate(-50%, -50%) rotate(${angle}deg)`;
      } else {
        const frame = media.parentElement;
        this.rotationObserver?.observe(frame);
        media.style.width = `${angle % 180 ? frame.clientHeight : frame.clientWidth}px`;
        media.style.height = `${angle % 180 ? frame.clientWidth : frame.clientHeight}px`;
        media.style.transform = `rotate(${angle}deg)`;
      }
      media.classList.toggle('mo-turned', angle % 180 !== 0);
      media.dataset.rotation = String(angle);
    });
  }
  canSelect(row) { return Boolean(!row.Trashed && row.Available && row.SHA256 && ['OK', 'OK_WITH_WARNINGS'].includes(row.IntegrityStatus)); }
  updateSelection() {
    const records = this.data?.records || [];
    const eligible = new Set(records.filter(row => this.canSelect(row)).map(row => row.RecordId));
    this.selected.forEach(id => { if (!eligible.has(id)) this.selected.delete(id); });
    const matching = filterRecords(records, this.filters).filter(row => this.canSelect(row));
    const visible = new Set(matching.map(row => row.RecordId));
    const hidden = [...this.selected].filter(id => !visible.has(id)).length;
    this.$('#mo-selection-bar').hidden = !records.length;
    this.$('#mo-selection-count').textContent = `${this.selected.size} selected${hidden ? ` · ${hidden} hidden by filters` : ''}`;
    this.$('#mo-select-matching').disabled = this.busy || !matching.length;
    this.$('#mo-clear-selection').disabled = this.busy || !this.selected.size;
    this.$('#mo-tag-selected').disabled = this.busy || !this.selected.size;
    this.$('#mo-sort-custom').disabled = this.busy || !this.selected.size;
    this.$('#mo-new-with-selected').disabled = this.busy || !this.selected.size;
    this.$('#mo-rotate-selected').disabled = this.busy || !this.selected.size;
    this.$('#mo-results').querySelectorAll('[data-select-media]').forEach(input => {
      input.checked = this.selected.has(input.dataset.selectMedia);
      input.disabled = this.busy || !eligible.has(input.dataset.selectMedia);
      input.closest('.mo-media-card').classList.toggle('mo-selected', input.checked);
    });
  }
  renderCustomFolders() {
    const records = this.data?.records || [];
    const saved = [...this.customFolders].sort((a, b) => a.name.localeCompare(b.name));
    const active = saved.find(folder => folder.id === this.filters.folder);
    this.$('#mo-library-title').firstChild.textContent = active ? `${active.name} ` : this.data?.aggregate ? 'All videos, by date ' : 'Your media, by date ';
    this.$('#mo-custom-folders').innerHTML = `<button class="mo-year" data-custom-filter="" aria-pressed="${!this.filters.folder}"><span>All folders</span><span>${records.length}</span></button>` + saved.map(folder => `<div class="mo-custom-folder-row"><button class="mo-year" data-custom-filter="${escape(folder.id)}" aria-pressed="${this.filters.folder === folder.id}" title="${escape(folder.path)}"><span>${escape(folder.name)}</span><span>${records.filter(row => row.CustomFolderId === folder.id).length}</span></button><button class="mo-icon-button" data-custom-open="${escape(folder.id)}" aria-label="Open ${escape(folder.name)} folder" title="Open folder in Explorer">${icon('external')}</button></div>`).join('') + (!saved.length ? '<p class="mo-custom-hint">Add a folder, then select clips to move into it.</p>' : '<p class="mo-custom-hint">Counts show clips in the selected library scope.</p>');
    this.querySelectorAll('[data-custom-filter]').forEach(button => { button.onclick = () => {
      this.filters.folder = button.dataset.customFilter;
      this.limit = this.pageSize;
      this.renderLibrary();
      [...this.querySelectorAll('[data-custom-filter]')].find(item => item.dataset.customFilter === button.dataset.customFilter)?.focus();
    }; });
    this.querySelectorAll('[data-custom-open]').forEach(button => { button.onclick = () => this.attempt(() => this.adapter.openFolder(saved.find(folder => folder.id === button.dataset.customOpen).path)); });
  }
  openCustomFolderDialog(afterSave = null) {
    const dialog = this.$('#mo-custom-dialog');
    dialog.innerHTML = `<div class="mo-dialog-heading"><h2 id="mo-custom-dialog-title">Create or connect a folder</h2><button data-custom-close class="mo-icon-button" aria-label="Close custom folder dialog">${icon('close')}</button></div><p>Create a real folder from here. Selected clips move only after you review and confirm.</p><label for="mo-custom-mode">Folder location</label><select id="mo-custom-mode"><option value="managed">Create in Media Manager</option><option value="external">Create in another PC location</option><option value="existing">Connect an existing folder</option></select><label for="mo-custom-name">Folder name</label><input id="mo-custom-name" maxlength="100" placeholder="For example: Favorites"><div id="mo-custom-location" hidden><label id="mo-custom-path-label" for="mo-custom-path">Parent folder</label><input id="mo-custom-path" spellcheck="false" placeholder="Choose a location below"><button id="mo-custom-browse">${icon('folder')} Browse PC folders</button></div><p id="mo-custom-result-path" class="mo-path"></p><p class="mo-dialog-error mo-warning" role="alert"></p><div class="mo-dialog-actions"><button data-custom-cancel>Cancel</button><button id="mo-custom-save" class="mo-primary">Create folder</button></div>`;
    const update=()=>{
      const mode=dialog.querySelector('#mo-custom-mode').value,name=dialog.querySelector('#mo-custom-name').value.trim();
      dialog.querySelector('#mo-custom-location').hidden=mode==='managed';
      dialog.querySelector('#mo-custom-path-label').textContent=mode==='existing'?'Existing folder':'Create inside this parent folder';
      dialog.querySelector('#mo-custom-save').textContent=mode==='existing'?'Connect folder':'Create folder';
      const parent=mode==='managed'?`${this.managedRoot || 'Media Manager'}\\Custom Folders`:dialog.querySelector('#mo-custom-path').value;
      dialog.querySelector('#mo-custom-result-path').textContent=mode==='existing'?`Folder: ${parent || 'Choose a folder'}`:`New folder: ${parent || 'Choose a parent folder'}\\${name || '(folder name)'}`;
    };
    dialog.querySelector('#mo-custom-mode').onchange=update;
    dialog.querySelector('#mo-custom-name').oninput=dialog.querySelector('#mo-custom-path').oninput=update;
    update();
    dialog.querySelector('[data-custom-close]').onclick = dialog.querySelector('[data-custom-cancel]').onclick = () => dialog.close();
    dialog.querySelector('#mo-custom-browse').onclick = () => this.dialogAttempt(dialog, async () => {
      const button = dialog.querySelector('#mo-custom-browse'); button.disabled = true;
      try { const { path } = await this.adapter.pickFolder('custom',dialog.querySelector('#mo-custom-path').value); if (path && dialog.open && dialog.querySelector('#mo-custom-path')) {dialog.querySelector('#mo-custom-path').value = path;update();} }
      finally { button.disabled = false; }
    });
    dialog.querySelector('#mo-custom-save').onclick = () => this.dialogAttempt(dialog, async () => {
      const button = dialog.querySelector('#mo-custom-save'); button.disabled = true;
      try {
        const result = await this.adapter.addCustomFolder(dialog.querySelector('#mo-custom-path').value, dialog.querySelector('#mo-custom-name').value, dialog.querySelector('#mo-custom-mode').value);
        this.customFolders = result.customFolders;
        if (this.data) this.data = await this.adapter.library(this.data.uiRunId);
        this.renderLibrary();
        dialog.close();
        if (afterSave) afterSave(result.folder.id);
      } finally { button.disabled = false; }
    });
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#mo-custom-name').focus();
  }
  openCustomMoveDialog(folderId = '', recordIds = [...this.selected]) {
    if (!recordIds.length || this.busy) return;
    this.customMoveIds = recordIds;
    if (!this.customFolders.length) return this.openCustomFolderDialog(id => this.openCustomMoveDialog(id, recordIds));
    const dialog = this.$('#mo-custom-dialog');
    dialog.innerHTML = `<div class="mo-dialog-heading"><h2 id="mo-custom-dialog-title">Move ${recordIds.length} selected clips</h2><button data-custom-close class="mo-icon-button" aria-label="Close custom move">${icon('close')}</button></div><p class="mo-custom-help">Only your selected clips will move, including selected clips hidden by the current filters.</p><label for="mo-custom-target">Destination custom folder</label><select id="mo-custom-target">${[...this.customFolders].sort((a, b) => a.name.localeCompare(b.name)).map(folder => `<option value="${escape(folder.id)}">${escape(folder.name)} — ${escape(folder.path)}</option>`).join('')}</select><button id="mo-custom-another">+ Add another folder</button><p class="mo-dialog-error mo-warning" role="alert"></p><div class="mo-dialog-actions"><button data-custom-cancel>Cancel</button><button id="mo-custom-preview" class="mo-primary">Preview selected move</button></div>`;
    if (folderId) dialog.querySelector('#mo-custom-target').value = folderId;
    dialog.querySelector('[data-custom-close]').onclick = dialog.querySelector('[data-custom-cancel]').onclick = () => dialog.close();
    dialog.querySelector('#mo-custom-another').onclick = () => this.openCustomFolderDialog(id => this.openCustomMoveDialog(id, recordIds));
    dialog.querySelector('#mo-custom-preview').onclick = () => this.dialogAttempt(dialog, async () => {
      const button = dialog.querySelector('#mo-custom-preview'); button.disabled = true;
      try {
        const plan = await this.adapter.previewCustomMove(this.data.uiRunId, dialog.querySelector('#mo-custom-target').value, recordIds);
        if (dialog.open) this.showCustomMovePreview(plan);
      } finally { button.disabled = false; }
    });
    if (!dialog.open) dialog.showModal();
    dialog.querySelector('#mo-custom-target').focus();
  }
  showCustomMovePreview(plan) {
    const dialog = this.$('#mo-custom-dialog');
    dialog.innerHTML = `<div class="mo-dialog-heading"><h2 id="mo-custom-dialog-title">Review ${plan.files.length} selected moves</h2><button data-custom-close class="mo-icon-button" aria-label="Close move preview">${icon('close')}</button></div><p class="mo-custom-help">Move directly into <strong>${escape(plan.folder.name)}</strong>. Filenames are kept unless a collision requires a new name. Existing files are never overwritten.</p><div class="mo-custom-preview-list">${plan.files.map(file => `<div class="mo-custom-preview-item"><span>From</span><code>${escape(file.source)}</code><span>To</span><code>${escape(file.destination)}</code></div>`).join('')}</div>${plan.skipped.length ? `<details><summary>${plan.skipped.length} selected clips will stay in place</summary>${plan.skipped.map(file => `<p>${escape(file.name)}: ${escape(file.reason)}</p>`).join('')}</details>` : ''}<p class="mo-custom-help">These files leave their current locations. The operation is logged for undo.</p><label for="mo-custom-confirm">Type MOVE to confirm</label><input id="mo-custom-confirm" autocomplete="off" spellcheck="false"><p class="mo-dialog-error mo-warning" role="alert"></p><div class="mo-dialog-actions"><button id="mo-custom-back">Go back</button><button id="mo-custom-execute" class="mo-primary" disabled>Move selected clips</button></div>`;
    dialog.querySelector('[data-custom-close]').onclick = () => dialog.close();
    dialog.querySelector('#mo-custom-back').onclick = () => this.openCustomMoveDialog(plan.folder.id, this.customMoveIds);
    dialog.querySelector('#mo-custom-confirm').oninput = event => { dialog.querySelector('#mo-custom-execute').disabled = event.target.value !== 'MOVE'; };
    dialog.querySelector('#mo-custom-execute').onclick = () => this.dialogAttempt(dialog, async () => {
      const button = dialog.querySelector('#mo-custom-execute'); button.disabled = true;
      try {
        await this.adapter.customMove(plan.runId, plan.planId, dialog.querySelector('#mo-custom-confirm').value);
        dialog.close(); this.setBusy(true); await this.refresh();
      } catch (error) { button.disabled = false; throw error; }
    });
    dialog.querySelector('#mo-custom-confirm').focus();
  }
  switchTab(tab) {
    this.tab = tab;
    this.$('.mo-display-toolbar').hidden = tab !== 'library';
    try { sessionStorage.setItem('mo-active-tab', tab); } catch {}
    const duplicates = tab === 'duplicates';
    this.classList.toggle('mo-duplicates-active', duplicates);
    this.$('#mo-organize-panel').hidden = duplicates;
    this.$('#mo-duplicates-panel').hidden = !duplicates;
    this.$('.mo-skip').href = duplicates ? '#mo-duplicates-panel' : '#mo-library';
    this.$('.mo-skip').textContent = duplicates ? 'Skip to duplicates' : 'Skip to media library';
    this.querySelectorAll('[data-tab]').forEach(button => {
      const selected = button.dataset.tab === tab;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    });
    this.renderDuplicates();
  }
  bindThumbnails(root) {
    this.rotationObserver ||= new ResizeObserver(() => this.applyRotations(this));
    this.rotationObserver.disconnect();
    this.querySelectorAll('.mo-thumbnail').forEach(node => this.rotationObserver.observe(node));
    this.applyRotations(root);
    root.querySelectorAll('[data-thumbnail-src]').forEach(img => {
      img.addEventListener('load', () => img.parentElement.classList.add('mo-thumb-ready'), { once: true });
      img.addEventListener('error', () => { img.parentElement.classList.add('mo-thumb-failed'); img.remove(); }, { once: true });
      img.src = img.dataset.thumbnailSrc;
    });
  }
  duplicateThumbnail(row, size = 'large') {
    const url = row.Available && this.adapter.thumbnailUrl ? this.adapter.thumbnailUrl(this.data.uiRunId, row.RecordId, size) : '';
    return `<div class="mo-thumbnail${url ? '' : ' mo-thumb-failed'}">${icon('film')}${url ? `<img data-rotation-record="${escape(row.RecordId)}" data-thumbnail-src="${escape(url)}" alt="" loading="${size === 'full' ? 'eager' : 'lazy'}" decoding="async">` : ''}<em>Preview unavailable</em><span>${durationLabel(row.Duration)}</span></div>`;
  }
  renderDuplicates() {
    this.$('#mo-duplicate-history').value = this.data?.uiRunId || '';
    const allGroups = duplicateGroups(this.data?.records || []);
    this.$('#mo-duplicate-tab-count').textContent = allGroups.length;
    const years = [...new Set(allGroups.map(group => yearKey(group.representative)))].sort((a, b) => a === 'Unknown' ? 1 : b === 'Unknown' ? -1 : b.localeCompare(a));
    this.$('#mo-duplicate-year').innerHTML = '<option value="">All dates</option>' + years.map(year => `<option value="${year}">${year === 'Unknown' ? 'Unknown date' : year}</option>`).join('');
    this.$('#mo-duplicate-year').value = this.duplicateFilters.year;
    const groups = duplicateGroups(this.data?.records || [], this.duplicateFilters);
    this.$('#mo-duplicate-summary').textContent = `${groups.length} duplicate groups · ${groups.reduce((n, group) => n + group.copies.length, 0)} copies · Identical file contents (SHA-256). Highlighted PRIMARY is the retained scan copy; filenames alone never establish duplicates.`;
    const result = this.$('#mo-duplicate-results');
    // Keep the library lightweight: large thumbnails only load in their own tab.
    if (this.tab !== 'duplicates') { result.innerHTML = ''; return; }
    if (!groups.length) {
      result.innerHTML = `<div class="mo-empty"><span class="mo-empty-icon">${icon('film')}</span><h3>${!this.data ? 'Scan a folder to find duplicates' : allGroups.length ? 'No matching duplicate groups' : 'No duplicate files in this scan'}</h3><p>${allGroups.length ? 'Try a different date or filename.' : 'This view groups exact copies and keeps their locations together.'}</p><button id="mo-duplicate-empty-action">${allGroups.length ? 'Clear duplicate filters' : 'Back to media library'}</button></div>`;
      this.$('#mo-duplicate-empty-action').onclick = () => {
        if (!allGroups.length) this.switchTab('library');
        else { this.duplicateFilters = { query: '', year: '', order: 'newest' }; this.$('#mo-duplicate-search').value = ''; this.$('#mo-duplicate-order').value = 'newest'; this.renderDuplicates(); }
      };
      return;
    }
    let lastDate;
    result.innerHTML = groups.slice(0, this.duplicateLimit).map(group => {
      const date = dateLabel(group.representative);
      const heading = lastDate !== date ? `<h2 class="mo-duplicate-date">${icon('clock')} ${escape(date)}</h2>` : '';
      lastDate = date;
      return `${heading}<section class="mo-duplicate-group" aria-label="${escape(group.id)} · ${group.copies.length} copies"><div class="mo-duplicate-group-heading"><span>${escape(group.id)}</span><span>${group.copies.length} identical copies</span></div><div class="mo-duplicate-grid">${group.copies.map(row => `<article class="mo-duplicate-card ${row.DuplicatePrimary==='yes'?'mo-primary-card':''}"><button class="mo-duplicate-open" data-enlarge="${escape(row.RecordId)}" aria-label="Enlarge ${escape(row.OriginalFilename)}">${this.duplicateThumbnail(row)}<div class="mo-duplicate-caption">${this.identity(row)}<strong>${escape(row.OriginalFilename)}</strong><span>${row.DuplicatePrimary === 'yes' ? 'Primary copy' : 'Additional copy'} · ${bytes(row.FileSize)}</span></div></button>${this.itemActions(row)}<div class="mo-duplicate-location"><code title="${escape(row.CurrentPath)}">${escape(row.CurrentPath)}</code><button data-duplicate-reveal="${escape(row.RecordId)}" ${row.Available ? '' : 'disabled'} aria-label="Show ${escape(row.OriginalFilename)} in folder">${icon('external')} Show in folder</button></div></article>`).join('')}</div></section>`;
    }).join('') + (groups.length > this.duplicateLimit ? `<div class="mo-more"><button id="mo-duplicate-more">Show more duplicate groups</button><span>${this.duplicateLimit} of ${groups.length} groups</span></div>` : '');
    this.bindThumbnails(result); this.bindItemActions(result);
    result.querySelectorAll('[data-enlarge]').forEach(button => { button.onclick = () => this.showDuplicate(button.dataset.enlarge); });
    result.querySelectorAll('[data-duplicate-reveal]').forEach(button => { button.onclick = () => this.attempt(() => this.adapter.reveal(this.data.uiRunId, button.dataset.duplicateReveal)); });
    this.$('#mo-duplicate-more')?.addEventListener('click', () => { this.duplicateLimit += 12; this.renderDuplicates(); });
  }
  showDuplicate(recordId, focusControl = null) {
    const group = duplicateGroups(this.data?.records || []).find(group => group.copies.some(row => row.RecordId === recordId));
    if (!group) return;
    const index = group.copies.findIndex(row => row.RecordId === recordId);
    const row = group.copies[index];
    const dialog = this.$('#mo-duplicate-viewer');
    dialog.innerHTML = `<div class="mo-viewer-heading"><div><h2 id="mo-duplicate-viewer-title">${escape(row.OriginalFilename)}</h2><p>${escape(dateLabel(row))} · Copy ${index + 1} of ${group.copies.length} · ${escape(group.id)}</p></div><button data-viewer-close class="mo-icon-button" aria-label="Close enlarged preview" autofocus>${icon('close')}</button></div><div class="mo-viewer-stage">${this.duplicateThumbnail(row, 'full')}</div>${this.identity(row)}${this.itemActions(row, true)}<div class="mo-viewer-location"><code>${escape(row.CurrentPath)}</code></div><div class="mo-viewer-actions"><div><button data-copy-previous ${index === 0 ? 'disabled' : ''}>Previous copy</button><button data-copy-next ${index === group.copies.length - 1 ? 'disabled' : ''}>Next copy</button></div><div><button data-viewer-play ${row.Available ? '' : 'disabled'}>Play video</button><button data-viewer-reveal ${row.Available ? '' : 'disabled'}>${icon('external')} Show in folder</button></div></div>`;
    this.bindThumbnails(dialog); this.bindItemActions(dialog);
    dialog.querySelector('[data-viewer-close]').onclick = () => dialog.close();
    const navigate = (step, control) => {
      const next = group.copies[index + step];
      if (next) this.showDuplicate(next.RecordId, control);
    };
    dialog.querySelector('[data-copy-previous]').onclick = () => navigate(-1, '[data-copy-previous]');
    dialog.querySelector('[data-copy-next]').onclick = () => navigate(1, '[data-copy-next]');
    dialog.onkeydown = event => {
      if (event.target.closest('video') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); navigate(event.key === 'ArrowLeft' ? -1 : 1, '[data-viewer-close]'); }
    };
    dialog.querySelector('[data-viewer-reveal]').onclick = () => this.dialogAttempt(dialog, () => this.adapter.reveal(this.data.uiRunId, row.RecordId));
    dialog.querySelector('[data-viewer-play]').onclick = () => {
      const stage = dialog.querySelector('.mo-viewer-stage');
      const button = dialog.querySelector('[data-viewer-play]');
      dialog.querySelector('.mo-playback-tools')?.remove();
      if (stage.querySelector('video')) { stage.innerHTML = this.duplicateThumbnail(row, 'full'); this.bindThumbnails(stage); button.textContent = 'Play video'; }
      else { stage.innerHTML = `<video data-rotation-record="${escape(row.RecordId)}" controls autoplay playsinline src="${escape(this.adapter.mediaUrl(this.data.uiRunId, row.RecordId))}" aria-label="Play ${escape(row.OriginalFilename)}"></video>`; button.textContent = 'Show thumbnail'; }
      attachPlayback(this, stage, row);
      this.applyRotations(stage);
    };
    if (!dialog.open) dialog.showModal();
    this.applyRotations(dialog);
    if (focusControl) {
      const control = focusControl && dialog.querySelector(focusControl);
      (control && !control.disabled ? control : dialog.querySelector('[data-viewer-close]')).focus();
    }
  }
  card(r) {
    const duration = Number(r.Duration) || 0;
    const thumbnail = r.Available && this.adapter.thumbnailUrl ? this.adapter.thumbnailUrl(this.data.uiRunId, r.RecordId) : '';
    return `<article class="mo-media-card"><label class="mo-select-label" title="Select clip for a custom folder"><input type="checkbox" data-select-media="${escape(r.RecordId)}" aria-label="Select ${escape(r.OriginalFilename)}" ${this.selected.has(r.RecordId) ? 'checked' : ''} ${this.busy || !this.canSelect(r) ? 'disabled' : ''}></label><button class="mo-media-open" data-detail="${escape(r.RecordId)}" aria-label="Preview and view locations for ${escape(r.OriginalFilename)}"><div class="mo-thumbnail${thumbnail ? '' : ' mo-thumb-failed'}">${icon('film')}${thumbnail ? `<img data-rotation-record="${escape(r.RecordId)}" data-thumbnail-src="${escape(thumbnail)}" alt="" loading="lazy" decoding="async" width="320" height="180">` : ''}<em>Preview unavailable</em><span>${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}</span><b>${r.Width && r.Height ? `${r.Width} × ${r.Height}` : 'MP4'}</b></div><div class="mo-card-info"><h4 title="${escape(r.OriginalFilename)}">${escape(r.OriginalFilename)}</h4><p>${escape(r.Classification || 'Unknown')} · ${bytes(r.FileSize)}</p><div class="mo-card-tags">${this.identity(r)}<span class="${r.Moved ? 'mo-success' : ''}">${r.CustomFolderId ? 'In custom folder' : r.Moved ? 'Moved / renamed' : r.Available ? 'In source' : 'File unavailable'}</span>${needsReview(r) ? '<span class="mo-warning">Needs review</span>' : ''}${r.DuplicateGroup ? '<span>Duplicate</span>' : ''}</div></div></button>${this.itemActions(r)}<button class="mo-reveal" data-reveal="${escape(r.RecordId)}" ${!r.Available ? 'disabled' : ''}>${icon('external')} Show in folder</button></article>`;
  }
  showDetail(id) {
    const row = this.data.records.find(r => r.RecordId === id);
    const dialog = this.$('#mo-detail');
    dialog.innerHTML = `<div class="mo-dialog-heading"><div><span class="mo-eyebrow">FILE DETAILS</span><h2 id="mo-detail-title">${escape(row.OriginalFilename)}</h2></div><button data-close class="mo-icon-button" aria-label="Close file details">${icon('close')}</button></div>${row.Available ? `<div class="mo-video-frame"><video data-rotation-record="${escape(row.RecordId)}" controls preload="metadata" src="${escape(this.adapter.mediaUrl(this.data.uiRunId, id))}" aria-label="Preview ${escape(row.OriginalFilename)}"></video></div><p class="mo-playback-note">If this video cannot play in your browser, use Show in folder to open it in your media player.</p>` : '<p class="mo-warning">File unavailable. It may have been moved outside this app.</p>'}${this.identity(row)}${this.itemActions(row, true)}${row.OriginRunId ? `<div class="mo-location"><label>Saved scan · ${escape(row.ScanFinished)} · seen in ${row.SeenInScans.length} scan(s)</label><code>${escape(row.ScanSource)}</code><button id="mo-open-origin-scan">Open this saved scan</button></div>` : ''}<div class="mo-detail-facts"><span>${escape(mediaType(row))}</span><span>${Number(row.FrameRate)||'?'} FPS</span><span>${durationLabel(row.Duration)}</span><span>${escape(dateLabel(row))}</span><span>${escape(row.Classification)}</span><span>${bytes(row.FileSize)}</span></div><div class="mo-location"><label>Current file location</label><code>${escape(row.CurrentPath)}</code><button id="mo-detail-reveal" ${!row.Available ? 'disabled' : ''}>${icon('external')} Show in folder</button><button id="mo-copy-path">Copy path</button></div><div class="mo-location"><label>${row.Moved ? 'Actual archive location' : 'Planned destination · not moved yet'}</label><code>${escape(row.Moved ? row.ActualDestination : row.ProposedDestination || 'Stays in source; not eligible for this move.')}</code></div><details><summary>Date & classification evidence</summary><dl><dt>Date source</dt><dd>${escape(row.DateSource || 'Unknown')} · ${escape(row.DateConfidence)} confidence</dd><dt>Date notes</dt><dd>${escape(row.DateNotes || 'No additional notes.')}</dd><dt>Classification</dt><dd>${escape(row.ClassificationEvidence || 'No additional evidence.')} · ${escape(row.ClassificationConfidence)} confidence</dd><dt>Duplicate evidence</dt><dd>Compared using full-file SHA-256, never filename alone. Primary is the best-evidenced available scan copy, not a claim about which copy was created first.</dd><dt>SHA-256</dt><dd class="mo-path">${escape(row.SHA256 || 'Unavailable')}</dd><dt>Integrity</dt><dd>${escape(row.IntegrityStatus)} · ${escape(row.IntegrityNotes)}</dd><dt>Plan</dt><dd>${escape(row.OperationStatus)}</dd></dl></details>`;
    dialog.querySelector('[data-close]').onclick = () => dialog.close();
    dialog.querySelector('#mo-open-origin-scan')?.addEventListener('click', () => { dialog.close(); this.attempt(() => this.load(row.OriginRunId)); });
    dialog.querySelector('#mo-detail-reveal').onclick = () => this.dialogAttempt(dialog, () => this.adapter.reveal(this.data.uiRunId, id));
    dialog.querySelector('#mo-copy-path').onclick = () => this.dialogAttempt(dialog, async () => { await navigator.clipboard.writeText(row.CurrentPath); dialog.querySelector('#mo-copy-path').textContent = 'Copied'; });
    this.bindItemActions(dialog);
    attachPlayback(this, dialog, row);
    dialog.showModal(); this.applyRotations(dialog);
  }
  async dialogAttempt(dialog, action) {
    const version = dialog.toolVersion;
    try { await action(); } catch (error) { if (dialog.toolVersion !== version) return; let message = dialog.querySelector('.mo-dialog-error'); if (!message) { message = document.createElement('p'); message.className = 'mo-dialog-error mo-warning'; message.setAttribute('role', 'alert'); dialog.append(message); } message.textContent = error.message; }
  }
  confirmMove() {
    const pending = this.pendingRecords();
    if (this.busy || this.planDirty || !pending.length) return;
    const dialog = this.$('#mo-confirm');
    dialog.innerHTML = `<div class="mo-dialog-heading"><h2 id="mo-confirm-title">Move ${pending.length} reviewed files?</h2><button data-close class="mo-icon-button" aria-label="Cancel move">${icon('close')}</button></div><p>This moves all eligible files in this scan, including files hidden by your current filters.</p><div class="mo-location"><label>From</label><code>${escape(this.data.run.source_root)}</code><label>To</label><code>${escape(this.data.run.destination_root)}</code></div><p>Source files will move to the archive. Invalid files and excluded duplicates stay in place. Existing files are never overwritten, and moves are logged for undo through the command-line tool.</p><label for="mo-confirm-word">Type MOVE to confirm</label><input id="mo-confirm-word" autocomplete="off" spellcheck="false"><p class="mo-dialog-error mo-warning" role="alert"></p><div class="mo-dialog-actions"><button data-cancel>Go back</button><button id="mo-execute" class="mo-primary" disabled>Move ${pending.length} files</button></div>`;
    dialog.querySelector('[data-close]').onclick = dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
    dialog.querySelector('input').oninput = event => { dialog.querySelector('#mo-execute').disabled = event.target.value !== 'MOVE'; };
    dialog.querySelector('#mo-execute').onclick = () => this.dialogAttempt(dialog, async () => {
      dialog.querySelector('#mo-execute').disabled = true;
      try { await this.adapter.move(this.data.uiRunId, dialog.querySelector('input').value); dialog.close(); this.setBusy(true); await this.refresh(); }
      catch (error) { dialog.querySelector('#mo-execute').disabled = false; throw error; }
    });
    dialog.showModal();
    dialog.querySelector('input').focus();
  }
}
Object.assign(MediaOrganizer.prototype, mediaActions, imageTools, captureTools);
if (!customElements.get('media-organizer')) customElements.define('media-organizer', MediaOrganizer);
