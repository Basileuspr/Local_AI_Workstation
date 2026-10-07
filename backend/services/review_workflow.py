"""ID-based review workflow. File actions consume single-use, reviewed plans."""
import hashlib
import io
import json
import os
import re
from pathlib import Path
import shutil
import threading
from uuid import uuid4

from config import settings
from services import visual_review as store, image_library as library, review_metadata
from services.image_manager import manager, no_links, signature, path_key, image_metadata, now

LOCK = threading.RLock()
RUN_ID = uuid4().hex
PRESETS = ('Character Refs', 'Training Candidates', 'Approved Generations', 'Backgrounds', 'Archive', 'Rejects')


def put(kind, identifier, value):
    with store.database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS workflow_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))')
        db.execute('INSERT INTO workflow_records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value', (kind,identifier,json.dumps(value)))
    return value


def records(kind):
    with store.database() as db:
        db.execute('CREATE TABLE IF NOT EXISTS workflow_records(kind TEXT,id TEXT,value TEXT,PRIMARY KEY(kind,id))')
        values=[json.loads(row[0]) for row in db.execute('SELECT value FROM workflow_records WHERE kind=? ORDER BY rowid', (kind,))]
        if kind=='plan':
            for value in values:
                if value['status']=='running' and value.get('run_id')!=RUN_ID:
                    value.update(status='interrupted',error='App restarted. Completed operations were preserved; inspect the receipt before preparing remaining files.')
                    db.execute('UPDATE workflow_records SET value=? WHERE kind=? AND id=?',(json.dumps(value),kind,value['id']))
        return values


def get(kind, identifier):
    value = next((row for row in records(kind) if row['id']==identifier), None)
    if not value: raise ValueError('This workflow record is unavailable. Refresh REVIEW.')
    return value


def split(media_id):
    source, separator, identifier = media_id.partition(':')
    if not separator or source not in ('library','image-manager','media-manager','video-analyzer') or not identifier:
        raise ValueError('Choose a registered media ID.')
    return source, identifier


def media(media_id):
    source, identifier = split(media_id)
    if source=='library': return store.media_record(source,identifier)
    if source=='video-analyzer': return native_record(identifier)
    if source=='image-manager':
        location = store.media_record(source,identifier)
        # Saving metadata on a never-opened, missing catalog item is supported.
        with store.database() as db: saved=db.execute('SELECT * FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
        if saved:
            store.public(saved['digest'])
            item=manager.image(identifier)
            manual=read_manual(source,identifier,saved['digest'])
            manual.update(tags=item['tags'],favorite=bool(item['favorite']))
        else:
            item=manager.image(identifier)
            manual=review_metadata.metadata({'tags':item['tags'],'favorite':bool(item['favorite'])})
        return {**location,**manual}
    with store.database() as db: saved=db.execute('SELECT * FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
    if not saved: raise ValueError('Register this video through Media Manager first.')
    store.public(saved['digest'])
    return store.media_record(source,identifier,read_manual(source,identifier,saved['digest']))


def read_manual(source,identifier,sha):
    """Coordinator reads do not save review decisions or initiate file reads."""
    with store.database() as db:
        row=db.execute('SELECT value FROM source_reviews WHERE source=? AND id=? AND digest=?',(source,identifier,sha)).fetchone()
        if row: return review_metadata.metadata(json.loads(row['value']))
        legacy=db.execute('SELECT * FROM reviews WHERE digest=?',(sha,)).fetchone()
    if legacy:
        value=dict(legacy); value['tags']=json.loads(value['tags'])
        return review_metadata.metadata(value)
    return review_metadata.metadata()


def listing(source='', status='', favorite=None, query='', offset=0, limit=48):
    if source not in ('','library','image-manager','media-manager','video-analyzer'): raise ValueError('Unknown media source.')
    ignored={row['id'] for row in records('ignored')}
    ids=[]
    if source in ('','library'):
        ids += [('library:'+row['id'],row['name']) for row in library.public_index()['images'] if not row.get('hidden')]
    if source in ('','image-manager'):
        with manager.database() as db:
            ids += [('image-manager:'+row['id'],row['relative']) for row in db.execute('SELECT id,relative FROM images WHERE hidden=0 ORDER BY relative')]
    if source in ('','media-manager'):
        with store.database() as db: ids += [('media-manager:'+row['id'],row['name']) for row in db.execute("SELECT id,name FROM sources WHERE source='media-manager'")]
    if source in ('','video-analyzer'):
        ids += [('video-analyzer:'+row['id'],row['name']) for row in records('video')]
    items=[]
    for identifier,name in ids:
        if identifier in ignored: continue
        try: value={**media(identifier),'name':name}
        except (ValueError,OSError): continue  # Omit locked/unregistered assets.
        if status and value['review_status']!=status: continue
        if favorite is not None and value['favorite']!=favorite: continue
        if query.casefold() not in ' '.join([name,value['caption'],value['category'],value['project'],*value['tags']]).casefold(): continue
        items.append(value)
    return {'items':items[offset:offset+limit],'total':len(items)}


def destination(path):
    value=Path(path)
    if not value.is_absolute() or str(value).startswith(('\\\\','//')): raise ValueError('Choose an absolute local folder.')
    if '..' in value.parts: raise ValueError('Choose a folder without parent path segments.')
    value=no_links(value)
    if os.name=='nt':
        import ctypes
        if ctypes.windll.kernel32.GetDriveTypeW(str(value.anchor))==4: raise ValueError('Choose a local disk rather than a mapped network drive.')
    for protected in (settings.data_dir.absolute(),settings.models_dir.absolute(),Path(__file__).resolve().parents[2]):
        if value==protected or value.is_relative_to(protected) or protected.is_relative_to(value):
            raise ValueError('Choose a destination outside application source, data and installed models.')
    parent=value
    while not parent.exists(): parent=parent.parent
    if not parent.is_dir(): raise ValueError('The destination parent is unavailable.')
    if value.exists() and not value.is_dir(): raise ValueError('Destination is occupied by a file.')
    return value


def presets():
    saved={row['id']:row for row in records('preset')}
    return [saved.get(str(index),{'id':str(index),'name':name,'path':None}) for index,name in enumerate(PRESETS)]


def set_preset(identifier,path):
    if identifier not in {row['id'] for row in presets()}: raise ValueError('Choose an existing preset.')
    value=destination(path)
    return put('preset',identifier,{'id':identifier,'name':PRESETS[int(identifier)],'path':str(value)})


def digest(path):
    before=signature(no_links(path).stat())
    value=hashlib.sha256()
    with path.open('rb') as stream:
        if signature(os.fstat(stream.fileno()))!=before: raise ValueError('Source changed while opening.')
        while chunk:=stream.read(1024*1024): value.update(chunk)
    if signature(no_links(path).stat())!=before: raise ValueError('Source changed while reading.')
    return value.hexdigest(),before


def patch(media_id, changes):
    source,identifier=split(media_id)
    value=media(media_id)
    review_metadata.patch(value,changes)  # Validate before registering or writing.
    if source=='image-manager':
        with store.database() as db: found=db.execute('SELECT 1 FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
        if not found:
            if value['file_state']!='present': raise ValueError('Locate this unregistered file before saving a review.')
            store.read_source(source,identifier)
    return store.review(source,identifier,changes)


def batch(ids,changes):
    values=[media(identifier) for identifier in ids]
    for value in values: review_metadata.patch(value,changes)
    results=[]
    for identifier in ids:
        try: results.append({'media_id':identifier,'review':patch(identifier,changes)})
        except (ValueError,OSError) as error: results.append({'media_id':identifier,'error':str(error)})
    return {'items':results}


def prepare(ids,mode,preset_id='',collision='rename'):
    with LOCK:
        target_root=None
        if mode!='leave':
            preset=get('preset',preset_id)
            target_root=destination(preset['path'])
        entries=[]; occupied=set()
        for identifier in dict.fromkeys(ids):
            value=media(identifier)
            if mode=='leave': entries.append({'media_id':identifier,'status':'leave','media':value}); continue
            if identifier.startswith('media-manager:'): raise ValueError('Video transfers use the reviewed plan in the isolated Media Manager. Shared review metadata is available here.')
            if value['file_state']!='present': raise ValueError('Locate missing files and rescan changed files before organizing them.')
            source=no_links(Path(value['path'])); sha,stamp=digest(source)
            source_kind,source_id=split(identifier)
            if source_kind=='library':
                item=next(row for row in library.read_index()['images'] if row['id']==source_id)
                if sha!=item['sha256']: raise ValueError('Stored library image changed.')
                name=Path(item['name']).name
            else: name=source.name
            if not name or name in ('.','..') or re.search(r'[<>:"|?*\x00-\x1f]',name) or name.endswith((' ','.')) or re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)',name,re.I): raise ValueError('Use a safe local image filename before organizing it.')
            target=no_links(target_root/name)
            suffix=1
            while target.exists() or Path(str(target)+'.review.json').exists() or path_key(target) in occupied:
                if collision=='skip': target=None; break
                target=no_links(target_root/f'{Path(name).stem} ({suffix}){Path(name).suffix}'); suffix+=1
            if target is None: entries.append({'media_id':identifier,'status':'skip','media':value}); continue
            occupied.add(path_key(target))
            if source==target or source.is_relative_to(target_root): raise ValueError('Choose a destination outside the selected source folder.')
            entries.append({'media_id':identifier,'source':str(source),'target':str(target),'sha256':sha,'signature':stamp,'status':'ready','media':value})
        plan={'id':uuid4().hex,'status':'ready','mode':mode,'destination_preset_id':preset_id,'destination':str(target_root) if target_root else None,'created':now(),'entries':entries}
        return put('plan',plan['id'],plan)


def bind(media_id,path,sha,owned=True):
    source,identifier=split(media_id)
    if source=='library':
        with library.LOCK:
            index=library.read_index(); item=next(row for row in index['images'] if row['id']==identifier)
            item['review_location']=str(path); item['review_location_owned']=owned; item['path']=str(path); library.save_index(index)
    elif source=='image-manager':
        folder=manager.add_folder(str(path.parent),'output')
        details=image_metadata(path)
        with manager.database() as db:
            conflict=db.execute('SELECT id FROM images WHERE key=? AND id!=?',(path_key(path),identifier)).fetchone()
            if conflict: raise ValueError('This file is already bound to another catalog item.')
            db.execute('UPDATE images SET folder_id=?,relative=?,key=?,signature=?,sha256=?,available=1 WHERE id=?',
                       (folder['id'],path.name,path_key(path),json.dumps(details['signature']),sha,identifier))
        store.register(source,identifier,path.name,sha,json.dumps(details['signature']),store.media_record(source,identifier))
    elif source=='video-analyzer':
        from services import local_files
        value=get('video',identifier)
        try: active=local_files.get(value['metadata'].get('origin',{}).get('session_id'))
        except ValueError: active=None
        if active and active.path==Path(value['path']):
            if not active.lock.acquire(blocking=False): raise ValueError('Stop Video Analyzer work before relocating this video.')
            try:
                value.update(path=str(path),signature=signature(path.stat()),name=path.name)
                put('video',identifier,value)
                active.path=path; active.source_signature=signature(path.stat())
            finally: active.lock.release()
            return
        value.update(path=str(path),signature=signature(path.stat()),name=path.name)
        put('video',identifier,value)
    else: raise ValueError('Locate videos in their isolated Media Manager.')


def register_copy(entry,target):
    """Copies get their own review decisions while retaining source references."""
    if entry['media']['media_type']=='video':
        original=get('video',split(entry['media_id'])[1]); identifier=uuid4().hex
        record={**original,'id':identifier,'name':target.name,'path':str(target),'signature':signature(target.stat()),
                'metadata':{**original['metadata'],'source_media_id':entry['media_id']}}
        put('video',identifier,record)
        store.register('video-analyzer',identifier,target.name,entry['sha256'])
        store.review('video-analyzer',identifier,{key:entry['media'][key] for key in ('rating','review_status','caption','category','project','favorite','tags')})
        return 'video-analyzer:'+identifier
    folder=manager.add_folder(str(target.parent),'output')
    details=image_metadata(target); value=entry['media']
    with manager.database() as db:
        identifier=manager._upsert(db,folder['id'],target.name,target,details,now(),favorite=int(value['favorite']),tags=value['tags'])
        db.execute('UPDATE images SET sha256=? WHERE id=?',(entry['sha256'],identifier))
    manual={key:value[key] for key in ('rating','review_status','caption','category','project','favorite','tags')}
    record=review_metadata.media_record('image-manager',identifier,manual=manual,
        details={**value['metadata'],'source_media_id':entry['media_id']},path=str(target),file_state='present')
    store.register('image-manager',identifier,target.name,entry['sha256'],json.dumps(details['signature']),record)
    with store.database() as db:
        db.execute('INSERT INTO source_reviews VALUES(?,?,?,?) ON CONFLICT(source,id,digest) DO UPDATE SET value=excluded.value',
                   ('image-manager',identifier,entry['sha256'],json.dumps(manual)))
    return 'image-manager:'+identifier


def apply(identifier,confirmed=False):
    if confirmed is not True: raise ValueError('Review the plan and use its confirmation button.')
    with LOCK:
        plan=get('plan',identifier)
        if plan['status']!='ready': raise ValueError('This plan has already been used. Prepare another plan.')
        if plan['mode']!='leave':
            preset=get('preset',plan['destination_preset_id'])
            if str(destination(preset['path']))!=plan['destination']: raise ValueError('Destination preset changed. Prepare another plan.')
        for entry in plan['entries']:
            if entry['status']!='ready': continue
            current=media(entry['media_id'])
            if current['path']!=entry['source']: raise ValueError('Source location changed. Prepare another plan.')
            sha,stamp=digest(Path(entry['source']))
            if sha!=entry['sha256'] or stamp!=entry['signature']: raise ValueError('Source changed after review. Prepare another plan.')
            target=no_links(Path(entry['target']))
            if target.exists() or Path(str(target)+'.review.json').exists(): raise ValueError('Destination is occupied. Prepare another plan.')
        plan['status']='running'; plan['run_id']=RUN_ID; put('plan',identifier,plan)
        try:
            for entry in plan['entries']:
                if entry['status']!='ready': continue
                source=no_links(Path(entry['source'])); target=no_links(Path(entry['target']))
                no_links(target.parent).mkdir(parents=True,exist_ok=True)
                entry['status']='writing'; put('plan',identifier,plan)
                with source.open('rb') as stream,target.open('xb') as output:
                    if signature(os.fstat(stream.fileno()))!=entry['signature']: raise ValueError('Source changed before copying.')
                    shutil.copyfileobj(stream,output,1024*1024); output.flush(); os.fsync(output.fileno())
                if digest(target)[0]!=entry['sha256']: raise ValueError('Copied file did not pass SHA-256 verification. Original retained.')
                entry['status']='verified copy; source retained'; put('plan',identifier,plan)
                # Re-read current metadata: edits made after planning must survive.
                entry['media']=media(entry['media_id'])
                sidecar=Path(str(target)+'.review.json')
                with sidecar.open('x',encoding='utf-8') as output:
                    json.dump({**entry['media'],'path':str(target),'source_path':entry['source']},output,ensure_ascii=False,indent=2)
                    output.flush(); os.fsync(output.fileno())
                shutil.copystat(source,target,follow_symlinks=False)
                if plan['mode']=='move':
                    if digest(source)!=(entry['sha256'],entry['signature']): raise ValueError('Source changed; verified copy retained.')
                    bind(entry['media_id'],target,entry['sha256'])
                    # Validate the source path again after catalog updates.
                    if digest(source)!=(entry['sha256'],entry['signature']): raise ValueError('Source changed; source retained.')
                    source.unlink()
                else:
                    entry['copy_media_id']=register_copy(entry,target)
                entry['status']='moved' if plan['mode']=='move' else 'copied'
                entry['target_signature']=signature(target.stat()); put('plan',identifier,plan)
            plan['status']='complete'
        except (ValueError,OSError) as error:
            plan['status']='interrupted'; plan['error']=str(error)
        return put('plan',identifier,plan)


def undo(identifier,confirmed=False):
    if confirmed is not True: raise ValueError('Review the receipt and confirm undo.')
    with LOCK:
        plan=get('plan',identifier)
        if plan['mode']!='move' or plan['status'] not in ('complete','interrupted'): raise ValueError('Only completed moves can be safely returned. Copies remain on disk.')
        ids=[]
        for entry in plan['entries']:
            if entry['status']!='moved': continue
            source=no_links(Path(entry['source'])); target=no_links(Path(entry['target']))
            if source.exists() or not source.parent.is_dir() or media(entry['media_id'])['path']!=str(target) or digest(target)!=(entry['sha256'],entry['target_signature']):
                raise ValueError('A moved file or its original location changed. Undo is unavailable.')
            ids.append(entry)
        for entry in ids:
            source=Path(entry['source']); target=Path(entry['target'])
            with target.open('rb') as stream,source.open('xb') as output:
                shutil.copyfileobj(stream,output); output.flush(); os.fsync(output.fileno())
            if digest(source)[0]!=entry['sha256']: raise ValueError('Return copy failed verification; moved file retained.')
            shutil.copystat(target,source,follow_symlinks=False)
            bind(entry['media_id'],source,entry['sha256'])
            if digest(target)!=(entry['sha256'],entry['target_signature']): raise ValueError('Moved file changed; both copies retained.')
            target.unlink(); entry['status']='returned'; put('plan',identifier,plan)
        plan['status']='undone'; return put('plan',identifier,plan)


def locate(media_id,path):
    value=media(media_id)
    if value['file_state'] not in ('missing','unavailable'): raise ValueError('Locate is available for missing or unavailable files.')
    source,identifier=split(media_id)
    candidate=Path(path)
    if not candidate.is_absolute() or str(candidate).startswith(('\\\\','//')): raise ValueError('Choose a local absolute file.')
    if '..' in candidate.parts: raise ValueError('Choose a file without parent path segments.')
    candidate=no_links(candidate)
    if not candidate.is_file(): raise ValueError('Choose an existing file.')
    expected=value['metadata'].get('sha256')
    if not expected:
        with store.database() as db: row=db.execute('SELECT digest FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
        expected=row['digest'] if row else None
    if not expected: raise ValueError('No saved fingerprint is available. Rescan the source before recovery.')
    sha,_=digest(candidate)
    if sha!=expected: raise ValueError('That file does not match the saved SHA-256 fingerprint.')
    bind(media_id,candidate,sha,owned=False)
    records('ignored')
    with store.database() as db:
        db.execute('DELETE FROM workflow_records WHERE kind=? AND id=?',('ignored',media_id))
    return media(media_id)


def forget(media_id):
    value=media(media_id)
    if value['file_state'] not in ('missing','unavailable'): raise ValueError('Only stale unavailable entries can be removed from REVIEW.')
    put('ignored',media_id,{'id':media_id})
    return {'removed_from_review':True,'physical_file_deleted':False,'metadata_preserved':True}


def suggestions(media_id):
    media(media_id)
    return next((row for row in records('suggestion') if row['id']==media_id),None)


def resolve_suggestions(media_id,action,changes=None):
    value=get('suggestion',media_id)
    current=media(media_id)
    if value['fingerprint']!=current['metadata'].get('sha256'):
        # External adapters may hold a current digest in their source registry.
        source,identifier=split(media_id)
        with store.database() as db: row=db.execute('SELECT digest FROM sources WHERE source=? AND id=?',(source,identifier)).fetchone()
        if not row or row['digest']!=value['fingerprint']: raise ValueError('Suggestion source changed. Request fresh suggestions.')
    if action=='accept':
        proposed=changes if changes is not None else value['fields']
        allowed={key:proposed[key] for key in ('caption','category','tags') if key in proposed}
        if changes is None and 'tags' in allowed: allowed['tags']=list(dict.fromkeys([*current['tags'],*allowed['tags']]))
        patch(media_id,allowed)
    value['status']='accepted' if action=='accept' else 'ignored'
    return put('suggestion',media_id,value)


def add_tag(media_id,tag):
    with LOCK:
        value=media(media_id)
        return patch(media_id,{'tags':list(dict.fromkeys([*value['tags'],tag]))})


def approve(identifier):
    with LOCK:
        value=get('plan',identifier)
        if value['status']!='ready': raise ValueError('Prepare a fresh plan before approving it.')
        value['approved']=True
        return put('plan',identifier,value)


def coordinator_transfer(mode,identifier,preset_id):
    with LOCK:
        value=get('plan',identifier)
        if not value.get('approved') or value['mode']!=mode or value['destination_preset_id']!=preset_id:
            raise ValueError('Use the exact plan and preset explicitly approved in REVIEW.')
        return apply(identifier,True)


def native_record(identifier,manual=None):
    value=get('video',identifier)
    store.public(value['sha256'])
    location=review_metadata.location(lambda:no_links(Path(value['path'])),expected_signature=value['signature'],signature=signature)
    return review_metadata.media_record('video-analyzer',identifier,media_type='video',manual=manual if manual is not None else read_manual('video-analyzer',identifier,value['sha256']),
        details={**value['metadata'],'sha256':value['sha256'],'signature':value['signature']},**location)


def register_video(session_id):
    from services import local_files
    with local_files.operation(session_id,'video') as item:
        path=no_links(item.path); sha,stamp=digest(path)
        if item.source_signature and item.source_signature!=stamp: raise ValueError('Video changed since opening. Reopen it before registering it.')
        previous=next((row for row in records('video') if row['path']==str(path) and row['sha256']==sha),None)
        identifier=previous['id'] if previous else uuid4().hex
        value={'id':identifier,'name':path.name,'path':str(path),'sha256':sha,'signature':stamp,
               'metadata':{**item.data['metadata'],'analysis':item.data.get('analysis') or (previous['metadata'].get('analysis') if previous else None),'origin':{'kind':'video-analyzer','session_id':session_id}}}
        frames=item.data.get('frames') or []
        if frames:
            preview=no_links(item.directory/frames[0]['id'])
            if not preview.is_relative_to(item.directory) or not preview.is_file(): raise ValueError('Video preview is unavailable.')
            image=store.image(preview.read_bytes()); image.thumbnail((1024,1024)); output=io.BytesIO(); image.save(output,'JPEG',quality=85)
            preview_path=no_links(store.ROOT/'video-previews'/f'{identifier}.jpg')
            library.atomic(preview_path,output.getvalue()); value['preview']=str(preview_path)
            value['metadata']['preview_time']=frames[0].get('time',0)
        if signature(path.stat())!=stamp: raise ValueError('Video changed while registering. Reopen it first.')
        put('video',identifier,value); store.register('video-analyzer',identifier,path.name,sha)
        return native_record(identifier)


def video_preview(identifier):
    value=get('video',identifier); media_value=native_record(identifier)
    if media_value['file_state']!='present': raise ValueError('Locate or re-register this video before requesting suggestions.')
    if not value.get('preview'): raise ValueError('Extract a preview frame in Video Analyzer and register the video again.')
    path=no_links(Path(value['preview']))
    if not path.is_relative_to(no_links(store.ROOT/'video-previews')): raise ValueError('Invalid video preview binding.')
    return path.read_bytes(),value['sha256'],value['name']
