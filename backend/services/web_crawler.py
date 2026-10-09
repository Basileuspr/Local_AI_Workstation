"""Resumable bounded crawler; page bodies survive only an explicit retention policy."""
import asyncio
import time
from urllib.parse import urlsplit, urlunsplit

from services import web_state as state, web_content
from services.web_access import WebError
from services.web_retrieval import Retriever


class Crawler:
    def __init__(self,retriever=None,clock=time.time):self.retriever=retriever or Retriever();self.clock=clock

    async def process(self,row,owner,*,running=lambda:True):
        uid=row['id'];record=row['record'];src=record['source'];start=self.clock()
        page_bound=lambda url:state.permitted(url,src)
        policy_bound=lambda url:state.permitted(url,src,discovery=True)
        def stopped():
            return not running() or state.job(uid)['record'].get('cancel_requested') or not state.source(src['id'])['enabled']
        async def obtain(url,**kwargs):
            task=asyncio.create_task(self.retriever.retrieve(url,**kwargs))
            try:
                while not task.done():
                    if stopped():task.cancel();raise asyncio.CancelledError()
                    await asyncio.wait({task},timeout=.25)
                return await task
            finally:
                if not task.done():task.cancel()
                await asyncio.gather(task,return_exceptions=True)
        try:
            while record['frontier'] and record['checked']+record['failures']<src['max_pages']:
                if stopped():raise asyncio.CancelledError()
                ready=[p for p in record['frontier'] if p.get('not_before',0)<=self.clock()]
                if not ready:
                    state.checkpoint(uid,owner,record,state='RETRY',available=min(p['not_before'] for p in record['frontier']));return
                record['frontier']=ready+[p for p in record['frontier'] if p not in ready]
                if self.clock()-start>600:
                    state.checkpoint(uid,owner,record,state='RETRY',available=self.clock()+60);return
                pending=record['frontier'][0];url=pending['url'];depth=pending['depth'];metadata=pending.get('discovery',False)
                bound=policy_bound if metadata else page_bound
                if url in record['seen'] or not bound(url) or depth>src['max_depth'] and not metadata:
                    record['frontier'].pop(0);state.checkpoint(uid,owner,record);continue
                old=state.page(src['id'],url)
                conditional={}
                if old:
                    if old.get('etag'):conditional['If-None-Match']=old['etag']
                    if old.get('last_modified'):conditional['If-Modified-Since']=old['last_modified']
                if src['policy']=='keep_latest':
                    try:web_content.get(src['id'],url)
                    except ValueError:conditional={}
                try:
                    doc=await obtain(url,boundary=bound,policy_boundary=policy_bound,conditional=conditional,
                        delay=src['request_interval_seconds'],source_id=src['id'])
                    if doc.status==304 and (not old or not old.get('content_hash')):raise WebError('Unexpected 304 without previous content.')
                    changed=doc.status!=304 and (not old or old.get('content_hash')!=doc.content_hash)
                    # Only full, supported documents may reach configured actions.
                    if doc.truncated:raise WebError('Page extraction exceeded the complete-content limit.')
                    if doc.status==200 and doc.kind=='page' and not doc.text.strip():raise WebError('Unsupported empty or JavaScript-rendered page; manual browser capture is required.')
                    event=web_content.apply(doc,changed,src)
                    now=self.clock();page={**(old or {}),**doc.metadata(),'url':url,'canonical_url':doc.canonical_url or url,
                        'first_seen':old.get('first_seen',now) if old else now,'last_seen':now,'last_checked':now,
                        'last_changed':now if changed else old.get('last_changed',now),'failure_count':0,'next_retry':None,'http_status':doc.status}
                    page.pop('error',None)
                    if doc.status==304:
                        page['content_hash']=old['content_hash'];page['etag']=doc.etag or old.get('etag');page['last_modified']=doc.last_modified or old.get('last_modified')
                        page['title']=old.get('title','');page['canonical_url']=old.get('canonical_url',url)
                        page['published_at']=old.get('published_at')
                    record['frontier'].pop(0);record['seen'].append(url);record['checked']+=1;record['changed']+=int(changed)
                    if doc.canonical_url not in record['seen']:record['seen'].append(doc.canonical_url)
                    candidates=[]
                    if depth<src['max_depth']:candidates.extend((link,depth+1,False) for link in doc.links if page_bound(link))
                    if src['discover_feeds']:candidates.extend((link,depth,True) for link in doc.feeds if policy_bound(link))
                    if src['discover_sitemaps']:candidates.extend((link,depth,True) for link in doc.sitemaps if policy_bound(link))
                    if not record['discovered']:
                        record['discovered']=True
                        if src['discover_sitemaps']:
                            u=urlsplit(src['seed_url']);candidates.append((urlunsplit((u.scheme,u.netloc,'/sitemap.xml','','')),0,True))
                    waiting={p['url'] for p in record['frontier']}
                    for link,level,discovery in candidates:
                        if link not in waiting and link not in record['seen'] and len(record['frontier'])<src['max_pages']*4:
                            record['frontier'].append({'url':link,'depth':level,'attempt':0,'discovery':discovery});waiting.add(link)
                    state.checkpoint(uid,owner,record,page=page,event=event)
                except (WebError,ValueError) as exc:
                    # Do not persist exception bodies, fetched text or secrets.
                    now=self.clock();pending['attempt']+=1
                    policy=any(word in str(exc).lower() for word in ('disallowed','denied','blocked','outside','unsupported','credential','complete-content limit','unavailable (http 404)','unavailable (http 410)'))
                    retry=not policy and pending['attempt']<4
                    wait=min(3600,60*2**(pending['attempt']-1))
                    if any(word in str(exc).lower() for word in ('hourly','cooldown','pause')):wait=3600
                    page={**(old or {}),'url':url,'canonical_url':old.get('canonical_url',url) if old else url,
                        'first_seen':old.get('first_seen',now) if old else now,'last_seen':now,'last_checked':now,
                        'failure_count':(old.get('failure_count',0) if old else 0)+1,'next_retry':now+wait if retry else None,
                        'http_status':404 if '404' in str(exc) else 410 if '410' in str(exc) else None,'error':'policy_or_unsupported' if policy else 'temporary_retrieval_failure'}
                    if retry:
                        # Checkpoint this page before yielding; other pages can
                        # run while it backs off, and retries survive a crash.
                        record['frontier'].pop(0);pending['not_before']=now+wait;record['frontier'].append(pending)
                    else:record['frontier'].pop(0);record['seen'].append(url);record['failures']+=1
                    state.checkpoint(uid,owner,record,page=page)
                # Rotate deferred failures rather than block the rest of a site.
                ready=[p for p in record['frontier'] if p.get('not_before',0)<=self.clock()]
                if record['frontier'] and not ready:
                    state.checkpoint(uid,owner,record,state='RETRY',available=min(p['not_before'] for p in record['frontier']));return
                record['frontier']=ready+[p for p in record['frontier'] if p not in ready]
            # A configured page budget deliberately bounds this run. Frontier
            # overflow is observable and resumes at the next scheduled crawl.
            final='PARTIAL' if record['failures'] or record['frontier'] else 'COMPLETED'
            if not record['checked'] and record['failures']:final='FAILED'
            state.checkpoint(uid,owner,record,state=final)
        except asyncio.CancelledError:
            final='CANCELLED' if state.job(uid)['record'].get('cancel_requested') else 'RETRY'
            state.checkpoint(uid,owner,record,state=final,available=self.clock()+30)
        except Exception:
            # A worker failure retains the current page and frontier. A new
            # process can recover it without replaying completed checkpoints.
            state.checkpoint(uid,owner,record,state='RETRY',available=self.clock()+60)
