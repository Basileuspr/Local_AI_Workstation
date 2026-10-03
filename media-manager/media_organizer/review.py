"""A narrow server-side review bridge. No host credential reaches the renderer."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import re
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from uuid import uuid4
import zipfile
from . import media_actions, manifest


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): raise ValueError('Review bridge refused a redirect.')


def request(operation,body=None,query=None,binary=False):
    if operation not in {'capabilities','catalog','job','stop','register','classify','review','person','face','merge','scenes'} and not re.fullmatch(r'faces/[a-f0-9]{32}',operation):
        raise ValueError('Unsupported review operation.')
    base=os.environ.get('LAW_MEDIA_REVIEW_BASE',''); token=os.environ.get('LAW_MEDIA_REVIEW_TOKEN','')
    url=urlsplit(base)
    if url.scheme!='http' or url.hostname!='127.0.0.1' or not url.port or url.username or url.password or url.path not in ('','/') or url.query or url.fragment or not token:
        raise ValueError('Open Media Manager inside Local AI Workstation to use Review & classify. Quit and reopen the app after updating.')
    address=base.rstrip('/')+'/visual-review/media/'+operation
    if query: address+='?'+urlencode(query)
    data=None if body is None else json.dumps(body).encode()
    req=Request(address,data=data,headers={'X-LAW-Review':token,'Content-Type':'application/json'})
    try:
        with build_opener(ProxyHandler({}),NoRedirect()).open(req,timeout=120) as response:
            payload=response.read(8*1024*1024+1)
            if len(payload)>8*1024*1024: raise ValueError('Review response exceeded its limit.')
            return payload if binary else json.loads(payload)
    except HTTPError as error:
        try: detail=json.loads(error.read(4096)).get('detail','Review request failed.')
        except (ValueError,AttributeError): detail='Review request failed.'
        raise ValueError(detail if isinstance(detail,str) else 'Invalid review request.') from None
    except URLError: raise ValueError('The workstation review service is unavailable. Reopen the app and retry.') from None


def record(state,run_id,record_id):
    data=state.library(run_id)
    row=next((r for r in data['records'] if r['RecordId']==record_id and not r.get('Trashed')),None)
    if not row: raise ValueError('Choose an available scanned video.')
    return row,state.media_path(run_id,record_id,data)


def sample(state,run_id,record_id):
    row,path=record(state,run_id,record_id)
    original=Path(row['CurrentPath']).absolute()
    if any(p.is_symlink() or p.is_junction() for p in (original,*original.parents)): raise ValueError('Review skips links and junctions.')
    before=path.stat(); stamp=(str(path),before.st_size,before.st_mtime_ns)
    cache=getattr(state,'review_hashes',{}); digest=cache.get(stamp)
    if not digest:
        with path.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
        if len(cache)>1000: cache.clear()
        cache[stamp]=digest; state.review_hashes=cache
    if digest!=str(row.get('SHA256','')).lower(): raise ValueError('Video changed since scanning. Rescan before classifying it.')
    preview=state.thumbnails.get(path,'full'); after=path.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns): raise ValueError('Video changed while reading.')
    origin=row.get('OriginRunId',run_id); identifier=row.get('OriginRecordId',record_id)
    return {'id':origin+'::'+identifier,'name':row['OriginalFilename'],'digest':digest,'image':base64.b64encode(preview).decode('ascii')}


def action(state,payload):
    operation=payload.get('operation')
    if operation in ('capabilities','job','stop'): return request(operation,{} if operation=='stop' else None)
    if operation=='catalog':
        value=request('catalog',query={'person':payload.get('person',''),'scene':payload.get('scene',''),'rating':payload.get('rating',''),'query':str(payload.get('query',''))[:200],'offset':max(0,int(payload.get('offset',0))),
            **{key:payload[key] for key in ('category','project','favorite','review_status') if key in payload}})
        # Use the native Tags palette, including tags on unclassified videos.
        names=[*value.get('available_tags',[]),*(tag['name'] for tag in media_actions.metadata(state.reports)['tags'])]
        value['available_tags']=sorted({name.casefold():name for name in names}.values(),key=str.casefold)
        return value
    if operation=='open':
        item=sample(state,payload.get('runId'),payload.get('recordId')); value=request('register',item)
        data=media_actions.metadata(state.reports); assigned=set(data['assignments'].get(item['digest'].upper(),[]))
        value['review']['tags']=[tag['name'] for tag in data['tags'] if tag['id'] in assigned]
        return value
    if operation=='classify':
        ids=payload.get('recordIds')
        if not isinstance(ids,list) or not 1<=len(ids)<=20: raise ValueError('Classify up to 20 selected video previews per batch.')
        items=[sample(state,payload.get('runId'),identifier) for identifier in dict.fromkeys(ids)]
        return request('classify',{'items':items,'faces':bool(payload.get('faces',True)),'model':str(payload.get('model',''))[:200]})
    if operation=='save':
        item=sample(state,payload.get('runId'),payload.get('recordId')); changes=payload.get('review',{})
        if not isinstance(changes,dict): raise ValueError('Choose valid review metadata.')
        data=media_actions.metadata(state.reports)
        assigned=set(data['assignments'].get(item['digest'].upper(),[]))
        tags=changes.get('tags',[tag['name'] for tag in data['tags'] if tag['id'] in assigned])
        if not isinstance(tags,list) or len(tags)>100 or any(not isinstance(tag,str) or not 1<=len(tag.strip())<=60 for tag in tags): raise ValueError('Tags need 1 to 60 characters.')
        request('register',item)
        result=request('review',{'source':'media-manager','id':item['id'],**{key:changes[key] for key in ('rating','caption','tags','category','project','favorite','review_status') if key in changes}})
        if 'tags' in changes:
            with state.lock:
                data=media_actions.metadata(state.reports); assigned=[]
                for label in tags:
                    tag=next((tag for tag in data['tags'] if tag['name'].casefold()==label.casefold()),None)
                    if not tag: tag={'id':uuid4().hex,'name':label}; data['tags'].append(tag)
                    assigned.append(tag['id'])
                data['assignments'][item['digest'].upper()]=assigned
                manifest.write_json(str(state.reports/'ui-metadata.json'),data)
        return result
    if operation in ('person','face','merge','scenes'): return request(operation,payload.get('value',{}))
    if operation=='export':
        ids=payload.get('recordIds',[])
        if not isinstance(ids,list) or not 1<=len(ids)<=20: raise ValueError('Export up to 20 reviewed video previews.')
        output=state.reports/'review-exports'; output.mkdir(exist_ok=True)
        destination=output/f'review-{uuid4().hex}.zip'; buffer=io.BytesIO(); records=[]
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as archive:
            for number,identifier in enumerate(ids,1):
                item=sample(state,payload.get('runId'),identifier); value=request('register',item)
                name=f'{number:03d}-preview.jpg'; archive.writestr(name,base64.b64decode(item['image']))
                archive.writestr(name+'.txt',value['review']['caption'])
                records.append({'name':item['name'],'video_sha256':item['digest'],'preview_file':name,**value})
            archive.writestr('review.json',json.dumps(records,indent=2,ensure_ascii=False))
        with destination.open('xb') as stream: stream.write(buffer.getvalue())
        return {'folder':str(output),'path':str(destination)}
    raise ValueError('Unknown review operation.')
