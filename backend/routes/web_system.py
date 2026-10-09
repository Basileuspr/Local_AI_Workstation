"""Separate temporary research and deliberately configured recurring sources."""
from typing import Literal
from fastapi import APIRouter, HTTPException, Request, Query
from pydantic import BaseModel, ConfigDict, Field
from services import web_state as state, web_content, web_background, web_knowledge
from services.web_research import manager, search_config
from services.web_access import WebError
from routes.local_files import native

router=APIRouter(prefix='/web-system',tags=['web-system'])


class Strict(BaseModel):model_config=ConfigDict(extra='forbid')
class ResearchRequest(Strict):
    question:str=Field(min_length=3,max_length=2000)
    model:str=Field(min_length=1,max_length=200)
    urls:list[str]=Field(default_factory=list,max_length=6)
    max_pages:int=Field(default=6,ge=1,le=6)
    follow_links:bool=True
class SearchConfig(Strict):
    provider:Literal['wikipedia','searxng']='wikipedia'
    endpoint:str=Field(default='',max_length=2000)
class Background(Strict):enabled:bool
class BrowserPage(Strict):
    url:str=Field(max_length=2000)
    title:str=Field(max_length=300)
    text:str=Field(max_length=8000)
class SaveDocument(Strict):
    research_id:str|None=Field(default=None,pattern=r'^[a-f0-9]{32}$')
    source_ref:str|None=Field(default=None,pattern=r'^S[1-8]$')
    source_id:str|None=Field(default=None,pattern=r'^[a-f0-9]{32}$')
    url:str|None=Field(default=None,max_length=2000)


def checked(operation,*args):
    try:return operation(*args)
    except (WebError,ValueError):raise HTTPException(400,'Invalid or unavailable web operation. Check public source boundaries and current job state.') from None


@router.get('/state')
def listing():return state.listing()
@router.get('/search')
def search_settings():return search_config()
@router.put('/search')
def update_search(body:SearchConfig):return checked(search_config,body.model_dump())
@router.post('/background')
async def background(body:Background,request:Request):
    native(request)
    try:return await web_background.configure(body.enabled)
    except ValueError as exc:raise HTTPException(400,str(exc)) from None
@router.post('/sources')
def create_source(body:state.Source):return checked(state.save_source,body)
@router.put('/sources/{sid}')
def update_source(sid:str,body:state.Source):return checked(state.save_source,body,sid)
@router.post('/sources/{sid}/check')
def check_source(sid:str):return {'id':checked(state.enqueue,sid)}
@router.get('/sources/{sid}/pages')
def source_pages(sid:str):return checked(state.pages,sid)
@router.get('/sources/{sid}/content')
def source_content(sid:str,url:str=Query(max_length=2000)):
    checked(state.identifier,sid);document=checked(web_content.get,sid,checked(state.public_url,url))
    return {'document':web_knowledge.normalized(document)}
@router.post('/sources/{sid}/clear-content')
def clear_source(sid:str):checked(state.source,sid);web_content.clear(sid);return {'cleared':True}
@router.post('/jobs/{ident}/cancel')
def cancel_job(ident:str):checked(state.cancel,ident);return {'cancel_requested':True}
@router.post('/research')
async def research(body:ResearchRequest):return checked(manager.start,body.question,body.model,body.urls,body.max_pages,body.follow_links)
@router.get('/research/{ident}')
async def research_status(ident:str):return checked(manager.state,ident)
@router.post('/research/{ident}/cancel')
async def cancel_research(ident:str):checked(manager.state,ident);return await manager.cancel(ident)
@router.post('/research/{ident}/discard')
async def discard_research(ident:str):checked(manager.state,ident);return await manager.discard(ident)
@router.post('/research/{ident}/browser-page')
async def browser_page(ident:str,body:BrowserPage,request:Request):
    native(request)
    try:return await manager.browser_page(ident,body.model_dump())
    except (WebError,ValueError):raise HTTPException(400,'Rendered page is unavailable, unsafe, empty or the research is still active.') from None
@router.post('/knowledge')
async def save_knowledge(body:SaveDocument,request:Request):
    # Human UI controls this handoff; not advertised as a model tool.
    if body.research_id and body.source_ref and not body.source_id and not body.url:
        document=checked(manager.document,body.research_id,body.source_ref)
    elif body.source_id and body.url and not body.research_id and not body.source_ref:
        document=checked(web_content.get,body.source_id,checked(state.public_url,body.url))
    else:raise HTTPException(400,'Select one complete captured research or retained source document.')
    from routes.files import _embedding_work
    try:return await _embedding_work(request,'Save selected web evidence to Knowledge',web_knowledge.ingest,document)
    except ValueError:raise HTTPException(400,'The selected evidence could not be indexed locally.') from None
