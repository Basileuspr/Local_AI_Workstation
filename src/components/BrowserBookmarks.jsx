import {useEffect,useState} from 'react';

const blank=()=>({title:'',url:'',parentId:''});
export default function BrowserBookmarks({desktop,page,onOpen,onClose}) {
  const [library,setLibrary]=useState({folders:[],bookmarks:[]}),[query,setQuery]=useState(''),[folder,setFolder]=useState('all');
  const [draft,setDraft]=useState(blank),[folderName,setFolderName]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{
    let stopped=false;
    desktop.browserBookmarks().then(next=>{if(!stopped){if(next.error)setError(next.error);else setLibrary(next);}}).catch(failure=>{if(!stopped)setError(failure.message);});
    return()=>{stopped=true;};
  },[desktop]);
  useEffect(()=>{if(page)setDraft({...blank(),title:page.title||page.url,url:page.url});},[page]);
  async function action(work,message='') {
    if(busy)return null;
    setBusy(true);setError('');setNotice('');
    try {
      const next=await work();if(next.error)throw Error(next.error);
      if(next.cancelled)return null;
      setLibrary(next);setNotice(message);return next;
    }catch(failure){setError(failure.message);return null;}finally{setBusy(false);}
  }
  const folders=[...library.folders].sort((a,b)=>a.path.localeCompare(b.path));
  const search=query.trim().toLocaleLowerCase();
  const rows=library.bookmarks.filter(b=>(folder==='all' || (b.parentId||'')===folder)
    && (!search || `${b.title}\n${b.url}\n${b.folderPath}`.toLocaleLowerCase().includes(search)));
  return <section className="browser-bookmarks" aria-label="Bookmarks">
    <div className="browser-toolbar">
      <strong>Bookmarks ({library.bookmarks.length})</strong>
      <button disabled={busy} onClick={async()=>{
        const next=await action(()=>desktop.importBrowserBookmarks());
        if(next){const r=next.imported;setNotice(`Imported ${r.added} bookmarks and ${r.foldersAdded} folders. ${r.duplicates} duplicates skipped.${r.unavailable?` ${r.unavailable} entries are retained but cannot open in this browser.`:''}${r.skipped?` ${r.skipped} unsupported addresses skipped.`:''}`);}
      }}>Import HTML…</button>
      <button disabled={busy} onClick={onClose}>Close bookmarks</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <div className="browser-toolbar">
      <input type="search" aria-label="Search bookmarks" placeholder="Search bookmarks and folders" value={query} onChange={e=>setQuery(e.target.value)}/>
      <select aria-label="Bookmark folder" value={folder} onChange={e=>setFolder(e.target.value)}>
        <option value="all">All folders</option><option value="">Unfiled bookmarks</option>
        {folders.map(f=><option key={f.id} value={f.id}>{f.path}</option>)}
      </select>
      <span>{rows.length} matching</span>
    </div>
    <form className="bookmark-editor" aria-label={draft.id?'Edit bookmark':'Save bookmark'} onSubmit={async e=>{
      e.preventDefault();const next=await action(()=>desktop.saveBrowserBookmark({...draft,parentId:draft.parentId||null}),'Bookmark saved.');if(next)setDraft(blank());
    }}>
      <label>Name<input aria-label="Bookmark name" value={draft.title} maxLength={500} onChange={e=>setDraft(v=>({...v,title:e.target.value}))}/></label>
      <label>Address<input aria-label="Bookmark address" value={draft.url} maxLength={8192} placeholder="https://example.com" onChange={e=>setDraft(v=>({...v,url:e.target.value}))}/></label>
      <label>Save in folder<select aria-label="Save bookmark in folder" value={draft.parentId||''} onChange={e=>setDraft(v=>({...v,parentId:e.target.value}))}>
        <option value="">Unfiled bookmarks</option>{folders.map(f=><option key={f.id} value={f.id}>{f.path}</option>)}
      </select></label>
      <button disabled={busy||!draft.url.trim()}>{draft.id?'Update bookmark':'Save bookmark'}</button>
      {draft.url && <button type="button" disabled={busy} onClick={()=>setDraft(blank())}>Cancel edit</button>}
    </form>
    <form className="browser-toolbar bookmark-new-folder" onSubmit={async e=>{
      e.preventDefault();const next=await action(()=>desktop.createBrowserBookmarkFolder({title:folderName,parentId:folder==='all'?null:folder||null}),'Folder created.');
      if(next){setFolder(next.createdFolderId);setDraft(v=>({...v,parentId:next.createdFolderId}));setFolderName('');}
    }}>
      <input aria-label="New bookmark folder name" placeholder="New folder name" maxLength={160} value={folderName} onChange={e=>setFolderName(e.target.value)}/>
      <button disabled={busy||!folderName.trim()}>Create folder</button>
      <span>{folder==='all'||folder===''?'At the top level':'Inside the selected folder'}</span>
    </form>
    <ul className="bookmark-list" aria-label="Saved bookmarks">
      {rows.map(b=><li key={b.id} className="bookmark-row">
        <div className="bookmark-details">
          <button className="bookmark-open" disabled={busy||!b.canOpen} title={b.url} onClick={()=>onOpen(b.url)}>{b.title}</button>
          <small>{b.folderPath||'Unfiled bookmarks'}</small><small>{b.url}</small>
          {!b.canOpen && <small>Saved for reference; this address cannot open in the workstation browser.</small>}
        </div>
        <button disabled={busy} aria-label={`Edit bookmark ${b.title}`} onClick={()=>setDraft({...b,parentId:b.parentId||''})}>Edit</button>
        <button disabled={busy} aria-label={`Remove bookmark ${b.title}`} onClick={async()=>{
          const next=await action(()=>desktop.removeBrowserBookmark(b.id),'Bookmark removed.');if(next && draft.id===b.id)setDraft(blank());
        }}>Remove</button>
      </li>)}
    </ul>
    {!rows.length && <p>{library.bookmarks.length?'No bookmarks match this search or folder.':'Import an HTML export or save a page to begin.'}</p>}
    <p>Bookmarks are saved on this device and available across browser account profiles.</p>
  </section>;
}
