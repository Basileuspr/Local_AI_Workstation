"""Shared public retrieval without the importer's permanent page/image cache."""
import asyncio
from dataclasses import asdict, dataclass, field
import hashlib
import re
import time
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser
import xml.etree.ElementTree as ET

from services.web_access import WebAccess, WebError, PageText, decode_page, MAX_BYTES, MAX_TEXT, REDIRECT_STATUSES
from services import web_state
from services.process_lock import acquire


@dataclass
class Document:
    url:str
    title:str
    text:str
    retrieved_at:float
    content_hash:str
    requested_url:str=''
    source_id:str=''
    status:int=200
    etag:str|None=None
    last_modified:str|None=None
    canonical_url:str=''
    links:list[str]=field(default_factory=list)
    feeds:list[str]=field(default_factory=list)
    sitemaps:list[str]=field(default_factory=list)
    kind:str='page'
    truncated:bool=False
    published_at:str|None=None

    def metadata(self):
        return {k:v for k,v in asdict(self).items() if k not in {'text','links','feeds','sitemaps'}}


def digest(text):
    return hashlib.sha256(re.sub(r'\s+',' ',text).strip().encode()).hexdigest()


class FileGate:
    """Reuse the app OS lock for cross-process request-budget serialization."""
    def __init__(self,directory):self.directory=directory;self.handle=None;self.local=asyncio.Lock()
    async def __aenter__(self):
        await self.local.acquire()
        try:
            deadline=time.monotonic()+120
            while True:
                try:self.handle=acquire(self.directory);return self
                except RuntimeError:
                    if time.monotonic()>deadline:raise WebError('The shared web request lane is busy. Retry later.')
                    await asyncio.sleep(.15)
        except BaseException:self.local.release();raise
    async def __aexit__(self,*args):
        if self.handle:self.handle.close();self.handle=None
        self.local.release()


class Links(PageText):
    def __init__(self):super().__init__();self.links=[];self.feeds=[];self.canonical='';self.published_at=None
    def handle_starttag(self,tag,attrs):
        values=dict(attrs);super().handle_starttag(tag,attrs)
        if tag=='meta' and (values.get('property') or values.get('name') or '').lower() in {'article:published_time','date','datepublished','dc.date'}:
            date=values.get('content','')
            if re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T[\d:+.Z-]{5,30})?',date):self.published_at=date
        if tag=='a' and values.get('href') and len(self.links)<1000:self.links.append(values['href'])
        if tag=='link' and values.get('href'):
            rel=values.get('rel','').lower().split()
            if 'canonical' in rel:self.canonical=values['href']
            if 'alternate' in rel and values.get('type','').lower() in {'application/rss+xml','application/atom+xml'}:
                self.feeds.append(values['href'])


def xml_content(body,current):
    if re.search(rb'<!\s*(?:DOCTYPE|ENTITY)\b',body,re.I):raise WebError('XML declarations with entities are not supported.')
    try:tree=ET.fromstring(body)
    except ET.ParseError as exc:raise WebError('Feed or sitemap XML is unreadable.') from exc
    nodes=list(tree.iter())
    if len(nodes)>20000:raise WebError('Feed/sitemap node limit reached.')
    tag=lambda e:e.tag.rsplit('}',1)[-1].lower()
    kind=tag(tree);links=[];sitemaps=[];parts=[]
    if kind in {'urlset','sitemapindex'}:
        for e in nodes:
            if tag(e)=='loc' and e.text:(sitemaps if kind=='sitemapindex' else links).append(e.text.strip())
        return kind,'\n'.join(links or sitemaps),'Sitemap',links[:1000],[],sitemaps[:100]
    if kind not in {'rss','feed','rdf'}:raise WebError('Unsupported XML document.')
    for e in nodes:
        name=tag(e)
        if name in {'title','description','summary','content','encoded'}:
            parser=PageText();parser.feed('<body>'+' '.join(e.itertext())+'</body>');value=parser.text().strip()
            if value:parts.append(value)
        if name=='link':
            raw=e.attrib.get('href') or (e.text or '').strip()
            if raw and e.attrib.get('rel','alternate') in {'alternate','self'}:links.append(urljoin(current,raw))
    return 'feed','\n'.join(parts),parts[0][:300] if parts else 'Feed',links[:1000],[],[]


class Retriever:
    def __init__(self,access=None):
        self.access=access or WebAccess(root=web_state.root()/'transport')
        if access is None:self.access.lock=FileGate(self.access.root)
        self.policies={}

    async def raw(self,url,*,boundary=None,conditional=None,delay=10,max_bytes=MAX_BYTES):
        current=web_state.public_url(url);seen=set()
        for _ in range(6):
            if current in seen:raise WebError('Redirect loop.')
            seen.add(current)
            if boundary and not boundary(current):raise WebError('Redirect/destination is outside configured boundaries.')
            status,headers,body=await self.access._request(current,{},delay=delay,space=True,max_bytes=max_bytes,
                conditional=conditional,allow_http=True,accepted_statuses=(304,410))
            if status not in REDIRECT_STATUSES:return current,status,headers,body
            target=headers.get('location')
            if not target:raise WebError('Redirect has no destination.')
            destination=web_state.public_url(urljoin(current,target))
            if urlsplit(current).scheme=='https' and urlsplit(destination).scheme!='https':raise WebError('TLS downgrade redirects are blocked.')
            current=destination;conditional=None
        raise WebError('Redirect limit reached.')

    async def robots(self,url,boundary=None):
        u=urlsplit(url);origin=f'{u.scheme}://{u.netloc}';cached=self.policies.get(origin)
        if not cached or time.time()-cached[0]>3600:
            # Robots redirects are validated too. An unreachable policy is a
            # temporary failure, not permission to ignore a site's policy.
            _,status,headers,body=await self.raw(origin+'/robots.txt',boundary=boundary,max_bytes=1024*1024)
            parser=RobotFileParser()
            if status not in (200,404,410):raise WebError('Robots policy unavailable.')
            text='' if status in (404,410) else decode_page(body,headers.get('content-type',''))
            parser.parse(text.splitlines())
            sitemaps=re.findall(r'^\s*Sitemap:\s*(\S+)',text,re.I|re.M)[:20]
            self.policies[origin]=(time.time(),parser,sitemaps)
        parser,sitemaps=self.policies[origin][1:]
        if not parser.can_fetch('LocalAIWorkstation',url):raise WebError('This page is disallowed by robots.txt.')
        rate=parser.request_rate('LocalAIWorkstation')
        delay=max(10,parser.crawl_delay('LocalAIWorkstation') or 0,rate.seconds/rate.requests if rate and rate.requests else 0)
        return delay,sitemaps

    async def retrieve(self,url,*,boundary=None,policy_boundary=None,conditional=None,delay=10,source_id=''):
        requested=web_state.public_url(url);current=requested;seen=set();sitemaps=[]
        for _ in range(6):
            if current in seen:raise WebError('Redirect loop.')
            seen.add(current)
            if boundary and not boundary(current):raise WebError('Page is outside configured boundaries.')
            policy_delay,discovered=await self.robots(current,policy_boundary)
            sitemaps.extend(discovered)
            status,headers,body=await self.access._request(current,{},delay=max(delay,policy_delay),space=True,
                conditional=conditional,allow_http=True,accepted_statuses=(304,410))
            if status in REDIRECT_STATUSES:
                if not headers.get('location'):raise WebError('Redirect has no destination.')
                destination=web_state.public_url(urljoin(current,headers['location']))
                if urlsplit(current).scheme=='https' and urlsplit(destination).scheme!='https':raise WebError('TLS downgrade redirects are blocked.')
                current=destination;conditional=None;continue
            if status==304:
                return Document(current,'','',time.time(),'',requested,source_id,status,_header(headers,'etag'),_header(headers,'last-modified'),current)
            if status in (404,410):raise WebError(f'Page unavailable (HTTP {status}).')
            media=headers.get('content-type','').split(';')[0].strip().lower()
            xml=media in {'application/xml','text/xml','application/rss+xml','application/atom+xml'}
            links=[];feeds=[];canonical=current;kind='page';published=None
            if xml:
                kind,text,title,links,feeds,xml_maps=xml_content(body,current);sitemaps.extend(xml_maps)
            elif media=='text/plain':text=decode_page(body,headers.get('content-type')).strip();title=urlsplit(current).hostname
            elif media in {'text/html','application/xhtml+xml'}:
                parser=Links();parser.feed(decode_page(body,headers.get('content-type')))
                published=parser.published_at
                text=parser.text();title=parser.page_title();base=urljoin(current,parser.base) if parser.base else current
                links=[urljoin(base,u) for u in parser.links];feeds=[urljoin(base,u) for u in parser.feeds]
                if parser.canonical:
                    try:
                        candidate=web_state.public_url(urljoin(base,parser.canonical))
                        if not boundary or boundary(candidate):canonical=candidate
                    except (WebError,ValueError):pass
            else:raise WebError('Unsupported document type; public HTML, text, RSS/Atom and sitemaps are supported.')
            safe=lambda values,bound=boundary:list(dict.fromkeys(web_state.public_url(v) for v in values if _usable(v,bound)))
            return Document(current,(title or urlsplit(current).hostname)[:300],text[:MAX_TEXT],time.time(),digest(text[:MAX_TEXT]),
                requested,source_id,status,_header(headers,'etag'),_header(headers,'last-modified'),canonical,
                safe(links),safe(feeds,policy_boundary),safe(sitemaps,policy_boundary),kind,len(text)>MAX_TEXT,published)
        raise WebError('Redirect limit reached.')


def _header(headers,name):
    value=headers.get(name)
    return value if value and len(value)<=1000 and all(32<=ord(c)<=126 for c in value) else None


def _usable(url,boundary):
    try:
        canonical=web_state.public_url(url)
        return not boundary or boundary(canonical)
    except (WebError,ValueError):return False
