import {useEffect,useId,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {apiUrl} from '../api';
import {reviewRequest as request,reviewImageUrl} from '../visualReview';
import {downloadBlob} from '../downloadBlob';
import {useImageDestinations} from '../ImageDestinations';
import FaceClassification from './FaceClassification';
import ReviewRecordDetails from './ReviewRecordDetails';
import ReviewTags,{tagList} from './ReviewTags';
import PersonNameEditor from './PersonNameEditor';
import PersonTagSelect from './PersonTagSelect';
import { canReadReviewImage, reviewFileMessage } from '../imageReview';
import './VisualReview.css';

function ReviewDialog({source,ids,onClose,onChanged,onPersonRenamed,people,labels,active=true,focusPerson=''}){
  const [position,setPosition]=useState(0),[item,setItem]=useState(null),[value,setValue]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const dialog=useRef(null),acting=useRef(false),destinations=useImageDestinations();
  const [undo,setUndo]=useState(null);
  const identifier=ids[position];
  const changedFile=item?.media?.file_state==='changed';
  useEffect(()=>{if(active)dialog.current.showModal();else dialog.current.close();},[active]);
  useEffect(()=>{let live=true;setItem(null);setValue(null);setError('');setUndo(null);request('/open',{source,ids:[identifier]}).then(result=>{if(live){setItem(result);setValue({...result.review});}}).catch(failure=>{if(live)setError(failure.message);});return()=>{live=false;};},[source,identifier]);
  async function act(work){if(acting.current)return;acting.current=true;setBusy(true);setError('');try{await work();}catch(failure){setError(failure.message);}finally{acting.current=false;setBusy(false);}}
  async function save(rating=value?.rating,tags=value?.tags){if(!value||changedFile)return;const saved=await request('/review',{source,id:identifier,rating,caption:value.caption,tags,...(typeof value.favorite==='boolean'?{favorite:value.favorite}:{})});setValue(current=>({...current,...saved}));setItem(current=>({...current,available_tags:[...new Set([...(current.available_tags||[]),...saved.tags])]}));onChanged?.();}
  const close=()=>act(async()=>{await save();onClose();});
  const move=delta=>act(async()=>{await save();setPosition(p=>p+delta);});
  async function reload(){setItem(await request('/open',{source,ids:[identifier]}));onChanged?.();}
  async function correction(face,change,message){await request('/face',{id:face.id,...change});setUndo({face,message});await reload();}
  async function undoCorrection(){await request('/face',{id:undo.face.id,person_id:undo.face.person_id,exclude:false});setUndo(null);await reload();}
  async function renamePerson(id,name){const saved=await request('/person',{id,name});onPersonRenamed?.(id,saved.person_id);await reload();}
  const take=destination=>act(async()=>{await save();await destinations.take({id:identifier,name:item.name,url:reviewImageUrl(source,identifier,true)},destination);onClose();});
  return createPortal(<dialog className="visual-review-dialog" ref={dialog} aria-label="Review images" onCancel={event=>{event.preventDefault();if(!busy)close();}} onKeyDown={event=>{if(busy||event.target.closest('input,textarea,select'))return;if(event.key==='ArrowRight'&&position<ids.length-1){event.preventDefault();move(1);}if(event.key==='ArrowLeft'&&position>0){event.preventDefault();move(-1);}}}>
    <header><h2>{item?.name||'Image review'} <small>{position+1} of {ids.length}</small></h2><button disabled={busy} onClick={close}>Save & close</button></header>
    <div className="vr-inspect">{item&&(canReadReviewImage(item.media)?<img className="vr-image" src={reviewImageUrl(source,identifier)} alt={item.name||'Selected image'}/>:<p role="status">{reviewFileMessage(item.media)}</p>)}
    {item?.classification&&<FaceClassification key={identifier} classification={item.classification} people={people} names={item.available_tags||[]} focusPerson={focusPerson} busy={busy} act={act} onRename={renamePerson} onCorrect={correction} undo={undo} onUndo={undoCorrection}/>}</div>
    {value&&<><ReviewRecordDetails image={{...item?.media,...value}} /><label>Caption / notes<textarea aria-label="Review caption" disabled={busy||changedFile} value={value.caption} maxLength={10000} onChange={e=>setValue({...value,caption:e.target.value})}/></label>
      <ReviewTags key={identifier} value={value.tags} available={item.available_tags||[]} disabled={busy||changedFile} maxLength={source==='image-manager'?60:80} onChange={tags=>setValue({...value,tags})} onApply={tags=>act(()=>save(value.rating,tags))}/>
      {item.person_tags?.length>0&&<p>Person name tags: {item.person_tags.join(' · ')}. These follow the face groups.</p>}
      <div className="vr-actions"><button disabled={busy||changedFile} aria-pressed={value.rating==='liked'} onClick={()=>act(async()=>{await save('liked');if(position<ids.length-1)setPosition(p=>p+1);})}>Like</button><button disabled={busy||changedFile} aria-pressed={value.rating==='disliked'} onClick={()=>act(async()=>{await save('disliked');if(position<ids.length-1)setPosition(p=>p+1);})}>Dislike</button><button disabled={busy||changedFile} onClick={()=>act(()=>save(null))}>Return to review</button><button disabled={busy||changedFile} onClick={()=>act(()=>save())}>Save notes</button>
        {destinations&&<><button disabled={busy||!canReadReviewImage(item?.media)} onClick={()=>take('editor')}>Edit image</button><button disabled={busy||!canReadReviewImage(item?.media)} onClick={()=>take('workflow')}>Start workflow</button><button disabled={busy||!canReadReviewImage(item?.media)} onClick={()=>take('folder')}>Add to Gallery folder</button></>}
        <button disabled={busy||!canReadReviewImage(item?.media)} onClick={()=>act(async()=>{await save();downloadBlob(await request('/export',{source,ids:[identifier]}),'reviewed-image.zip');})}>Export image & notes</button></div></>}
    {item?.classification&&<details><summary>Scene labels</summary>
      <label>Scene labels<select aria-label="Scene labels" multiple value={item.classification.scenes} disabled={busy} onChange={e=>{const selected=Array.from(e.target.selectedOptions,x=>x.value);act(async()=>{const result=await request('/scenes',{digest:item.digest,labels:selected});setItem({...item,classification:result});onChanged?.();});}}>{labels.map(label=><option key={label}>{label}</option>)}</select></label>
    </details>}
    {error&&<p role="alert">{error}</p>}<footer className="vr-actions"><button disabled={busy||position===0} onClick={()=>move(-1)}>Previous</button><button disabled={busy||position===ids.length-1} onClick={()=>move(1)}>Next</button></footer>
  </dialog>,document.body);
}

export default function VisualReview({source,ids=[],active=true,onChanged}) {
  const [open,setOpen]=useState(false),[caps,setCaps]=useState(null),[catalog,setCatalog]=useState({items:[],people:[],scenes:{},total:0});
  const [job,setJob]=useState(null),[faces,setFaces]=useState(true),[model,setModel]=useState('');
  const [person,setPerson]=useState(''),[scene,setScene]=useState(''),[rating,setRating]=useState(''),[query,setQuery]=useState(''),[offset,setOffset]=useState(0);
  const [slides,setSlides]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[revision,setRevision]=useState(0);
  const [editing,setEditing]=useState(''),[name,setName]=useState(''),[mergeTarget,setMergeTarget]=useState('');
  const acting=useRef(false);
  const running=job&&['queued','running'].includes(job.status);
  const currentPerson=catalog.people.find(group=>group.id===person);
  const targetPerson=catalog.people.find(group=>group.id===mergeTarget);
  const nameChoices=tagList(catalog.available_tags||[]);
  const duplicateName=currentPerson&&catalog.people.some(group=>group.id!==person&&group.name.trim().replace(/\s+/g,' ').toLowerCase()===currentPerson.name.trim().replace(/\s+/g,' ').toLowerCase());
  const namesId=useId();
  const changed=()=>{setRevision(value=>value+1);onChanged?.();};
  const personRenamed=(id,target)=>{if(person===id&&target&&target!==id)choosePerson(target);};
  async function renamePerson(id,name){const saved=await request('/person',{id,name});personRenamed(id,saved.person_id);onChanged?.();}
  const choosePerson=id=>{
    setPerson(id);setOffset(0);setEditing('');setMergeTarget('');
    // Entering a person folder shows its whole group, independent of earlier photo filters.
    if(id){setScene('');setRating('');setQuery('');}
  };

  useEffect(()=>{
    if(!active||!open)return;
    let live=true;
    request('/capabilities').then(value=>{if(live){setCaps(value);setFaces(value.faces.some(provider=>provider.ready));}}).catch(failure=>{if(live)setError(failure.message);});
    return()=>{live=false;};
  },[active,open]);

  useEffect(()=>{
    if(!active||!open)return;
    let live=true;
    setLoading(true);
    request(`/catalog?${new URLSearchParams({source,person,scene,offset,rating,query})}`).then(value=>{
      if(live){
        setCatalog(value);
        if(offset&&offset>=value.total)setOffset(Math.max(0,Math.floor((value.total-1)/48)*48));
      }
    }).catch(failure=>{if(live)setError(failure.message);}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[active,open,source,person,scene,offset,rating,query,revision]);

  useEffect(()=>{
    if(!active||!open)return;
    let live=true,timer,last;
    async function poll(){
      try{
        const value=await request('/job');
        if(!live)return;
        setJob(value);
        const key=JSON.stringify([value?.id,value?.processed,value?.status]);
        if(last!==undefined&&last!==key)setRevision(number=>number+1);
        last=key;
      }catch(failure){if(live)setError(failure.message);}
      if(live)timer=setTimeout(poll,1800);
    }
    poll();
    return()=>{live=false;clearTimeout(timer);};
  },[active,open,source]);

  async function act(work){
    if(acting.current)return;
    acting.current=true;setBusy(true);setError('');
    try{await work();setRevision(value=>value+1);}catch(failure){setError(failure.message);}
    finally{acting.current=false;setBusy(false);}
  }

  return <details className="visual-review" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>Review & classify <span>People, scenes, ratings and notes</span></summary>
    {open&&<>

      <div className="vr-actions">
        <button disabled={!ids.length||busy} onClick={()=>setSlides([...ids])}>Review selection / slideshow ({ids.length})</button>
        <button disabled={!ids.length||busy} onClick={()=>act(async()=>downloadBlob(await request('/export',{source,ids}),'reviewed-images.zip'))}>Export selection & notes</button>
        <label><input type="checkbox" checked={faces} disabled={!caps?.faces.some(provider=>provider.ready)} onChange={event=>setFaces(event.target.checked)}/>Group faces</label>
        <select aria-label="Scene classification model" value={model} onChange={event=>setModel(event.target.value)}><option value="">Scene classification off</option>{caps?.vision_models.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <button disabled={!ids.length||busy||running||(!faces&&!model)} onClick={()=>act(async()=>setJob(await request('/classify',{source,ids,faces,model})))}>Classify selection ({ids.length})</button>
        {running&&job.source===source&&<button disabled={busy} onClick={()=>act(()=>request('/stop',{}))}>Stop classification</button>}
      </div>
      {caps&&!caps.faces.some(provider=>provider.ready)&&<p>Install the local face models in Faces to enable person grouping.</p>}
      <div className="vr-actions"><button disabled={busy||running||(!faces&&!model)} onClick={()=>act(async()=>setJob(await request('/classify-catalog',{source,faces,model})))}>Classify unprocessed catalog</button></div>
      {job?.source===source&&<p role="status">{job.message} · {job.processed}/{job.total}{running&&<progress value={job.processed} max={job.total}/>}</p>}
      {running&&job.source!==source&&<p role="status">Classification is running in another workspace.</p>}
      {job?.source===source&&job?.errors?.length>0&&<details><summary>{job.errors.length} item(s) need retry</summary>{job.errors.map((failure,index)=><p key={index}>{failure.error}</p>)}</details>}

      <section className="vr-people-browser" aria-label="People">
        {catalog.people.length>0&&<p>Names appear in the tag filter. Saving an existing name combines the person groups.</p>}
        <div className="vr-section-heading"><h3>{person?'Person folder':'People folders'}</h3>{person&&<button disabled={busy} onClick={()=>choosePerson('')}>Back to people folders</button>}</div>
        {!person&&<div className="vr-people">{catalog.people.map(group=><article className="vr-person-card" key={group.id}>
          <button type="button" disabled={busy} aria-pressed={person===group.id} aria-label={`Show photos of ${group.name}`} onClick={()=>choosePerson(group.id)}>
          <img loading="lazy" src={apiUrl(`/visual-review/faces/${group.face_id}`)} alt=""/><span>{group.name}</span><small>{group.count} {group.count===1?'photo':'photos'}</small><span className="vr-folder-open">Open folder →</span>
          </button>
          <PersonNameEditor personId={group.id} name={group.name} label={`Name for ${group.name}`} busy={busy} act={act} onRename={renamePerson} names={nameChoices} canMerge={catalog.people.some(other=>other.id!==group.id&&other.name.trim().toLowerCase()===group.name.trim().toLowerCase())}/>
        </article>)}</div>}
        {!catalog.people.length&&!loading&&<p>No people grouped yet. Enable Group faces and classify some images to get started.</p>}
        {currentPerson&&<div className="vr-group-heading">
          <div className="vr-section-heading"><h3>{currentPerson.name} · {currentPerson.count} {currentPerson.count===1?'photo':'photos'}</h3><button disabled={busy} onClick={()=>{setName(currentPerson.name);setEditing('name');}}>Rename person</button><button disabled={busy||catalog.people.length<2} onClick={()=>{setMergeTarget('');setEditing('merge');}}>Merge with another person</button></div>

          {editing==='name'&&<form className="vr-actions" onSubmit={event=>{event.preventDefault();act(async()=>{await renamePerson(person,name.trim());setEditing('');});}}>
            <label>Person’s name<input autoFocus aria-label="Person group name" list={namesId} disabled={busy} maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label><datalist id={namesId}>{nameChoices.map(choice=><option key={choice} value={choice}/>)}</datalist>
            <PersonTagSelect names={nameChoices} value={name} onChange={setName} label="Person group name from Tags" disabled={busy}/>
            <button disabled={busy||!name.trim()||(name.trim()===currentPerson.name&&!duplicateName)}>Save name</button><button type="button" disabled={busy} onClick={()=>setEditing('')}>Cancel</button>
          </form>}
          {editing==='merge'&&<div className="vr-correction">
            <label>Same person as<select aria-label="Merge into person group" disabled={busy} value={mergeTarget} onChange={event=>setMergeTarget(event.target.value)}><option value="">Choose a matching person…</option>{catalog.people.filter(group=>group.id!==person).map(group=><option key={group.id} value={group.id}>{group.name} ({group.count})</option>)}</select></label>
            {targetPerson&&<div className="vr-merge-preview"><img src={apiUrl(`/visual-review/faces/${currentPerson.face_id}`)} alt={currentPerson.name}/><span>→</span><img src={apiUrl(`/visual-review/faces/${targetPerson.face_id}`)} alt={targetPerson.name}/><p>Combine all faces from <strong>{currentPerson.name}</strong> into <strong>{targetPerson.name}</strong>. The combined group keeps the name {targetPerson.name}. Shared classifications in other workspaces update too.</p></div>}
            <div className="vr-actions"><button disabled={busy||!targetPerson} onClick={()=>act(async()=>{const saved=await request('/merge',{source_id:person,target_id:mergeTarget});choosePerson(saved.person_id||mergeTarget);onChanged?.();})}>Merge groups</button><button disabled={busy} onClick={()=>setEditing('')}>Cancel</button></div>
          </div>}
        </div>}
      </section>

      <div className="vr-actions">
        <select aria-label="Filter classified person" disabled={busy} value={person} onChange={event=>choosePerson(event.target.value)}><option value="">All people</option>{person&&!currentPerson&&<option value={person}>Empty person group</option>}{catalog.people.map(group=><option key={group.id} value={group.id}>{group.name} ({group.count})</option>)}</select>
        <select aria-label="Filter classified scene" value={scene} onChange={event=>{setScene(event.target.value);setOffset(0);}}><option value="">All scenes</option>{Object.keys(catalog.scenes).map(label=><option key={label}>{label}</option>)}</select>
        <select aria-label="Filter review rating" value={rating} onChange={event=>{setRating(event.target.value);setOffset(0);}}><option value="">All ratings</option><option value="pending">To review</option><option value="liked">Liked</option><option value="disliked">Disliked</option></select>
        <input aria-label="Search reviewed images" placeholder="Search names, people, captions or tags" value={query} onChange={event=>{setQuery(event.target.value);setOffset(0);}} maxLength={200}/>
        <button disabled={busy||loading} onClick={()=>setRevision(value=>value+1)}>Refresh classifications</button>
      </div>
      {loading&&<p role="status">Loading photos…</p>}
      {person&&<div className="vr-section-heading vr-folder-heading"><h3>Images grouped as {currentPerson?.name||'this person'}</h3><button disabled={busy||loading||!catalog.items.length} onClick={()=>setSlides(catalog.items.map(item=>item.id))}>Review folder page ({catalog.items.length})</button></div>}
      <div className="vr-results" aria-label={person?`Images in ${currentPerson?.name||'person'} folder`:'Reviewed images'} aria-busy={loading}>{catalog.items.map(item=><button key={item.id} disabled={busy||loading} aria-label={`Review ${item.name}`} onClick={()=>setSlides([item.id])}>
        {canReadReviewImage(item.media)?<img loading="lazy" src={reviewImageUrl(source,item.id)} alt=""/>:<small>{reviewFileMessage(item.media)}</small>}<span>{item.name}</span>
        <small>{[...new Set(item.classification.faces.map(face=>face.name))].join(' · ')||'No grouped faces'}</small>
        {person&&<div className="vr-result-faces">{item.classification.faces.filter(face=>face.person_id===person).map(face=><img key={face.id} src={apiUrl(`/visual-review/faces/${face.id}`)} alt={`Grouped as ${face.name}`}/>)}</div>}
        {item.classification.scenes.length>0&&<small>{item.classification.scenes.join(' · ')}</small>}
      </button>)}</div>
      {!loading&&!catalog.total&&<p>{person||scene||rating||query?'No photos match these filters. You can choose another person or clear the filters.':'Reviewed and classified photos will appear here.'}</p>}
      {(scene||rating||query)&&<button onClick={()=>{setScene('');setRating('');setQuery('');setOffset(0);}}>Clear photo filters</button>}
      {catalog.total>0&&<div className="vr-actions"><button disabled={!offset||loading} onClick={()=>setOffset(number=>Math.max(0,number-48))}>Previous results</button><span>{Math.min(offset+1,catalog.total)}–{Math.min(offset+48,catalog.total)} of {catalog.total} photos</span><button disabled={offset+48>=catalog.total||loading} onClick={()=>setOffset(number=>number+48)}>Next results</button></div>}
      {error&&<p role="alert">{error}</p>}
      {slides&&<ReviewDialog source={source} ids={slides} active={active} focusPerson={person} people={catalog.people} labels={caps?.scene_labels||[]} onChanged={changed} onPersonRenamed={personRenamed} onClose={()=>setSlides(null)}/>}
    </>}
  </details>;
}
