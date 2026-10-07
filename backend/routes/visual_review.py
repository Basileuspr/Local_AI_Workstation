import base64
import hashlib
import io
import json
import re
import zipfile
from typing import Annotated, Literal
from fastapi import APIRouter, HTTPException, Response
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from services import visual_review as store
from services import face_help
from services.visual_classification import classifier, capabilities
from services.review_metadata import ReviewFields

router=APIRouter(prefix='/visual-review',tags=['visual-review'])


async def call(function,*args,**kwargs):
    try: return await run_in_threadpool(function,*args,**kwargs)
    except face_help.StaleAnswer as error: raise HTTPException(409,str(error)) from error
    except (ValueError,OSError,KeyError) as error: raise HTTPException(422,str(error)) from error


class Selection(BaseModel):
    source: Literal['library','image-manager']
    ids: list[str] = Field(min_length=1,max_length=1000)


class Batch(Selection):
    faces: bool=True
    model: str=Field(default='',max_length=200)


class CatalogBatch(BaseModel):
    source: Literal['library','image-manager']
    faces: bool=True
    model: str=Field(default='',max_length=200)


class Review(ReviewFields):
    source: Literal['library','image-manager','media-manager']
    id: str=Field(min_length=1,max_length=300)


class Person(BaseModel):
    id: str
    name: str=Field(min_length=1,max_length=120)


class Correction(BaseModel):
    id: str
    person_id: str | None=None
    exclude: bool=False
    name: str | None=Field(default=None,min_length=1,max_length=120)


class Merge(BaseModel):
    source_id: str
    target_id: str


class Scenes(BaseModel):
    digest: str
    labels: list[str]=Field(max_length=34)


HelpSource = Literal['all', 'library', 'image-manager']
FaceId = Annotated[str, Field(pattern=r'^[a-f0-9]{32}$')]


class HelpQuestions(BaseModel):
    source: HelpSource = 'all'
    skip_ids: list[FaceId] = Field(default_factory=list, max_length=5000)
    include_answered: bool = False


class HelpAnswer(BaseModel):
    source: HelpSource = 'all'
    face_id: FaceId
    version: str = Field(pattern=r'^[a-f0-9]{64}:[a-f0-9]{0,32}$')
    decision: Literal['yes', 'no', 'not-face']
    name: str = Field(default='', max_length=120)
    person_id: FaceId | None = None
    suggestion_id: FaceId | None = None


class HelpUndo(BaseModel):
    source: HelpSource = 'all'
    face_id: FaceId
    undo_id: FaceId


@router.post('/help/questions')
async def help_questions(request: HelpQuestions):
    return await call(face_help.questions, request.source, request.skip_ids, request.include_answered)


@router.post('/help/answer')
async def help_answer(request: HelpAnswer):
    return await call(face_help.answer, request.source, request.face_id, request.version,
                      request.decision, request.name, request.person_id, request.suggestion_id)


@router.post('/help/undo')
async def help_undo(request: HelpUndo):
    return await call(face_help.undo, request.source, request.face_id, request.undo_id)


@router.get('/capabilities')
async def info(): return await call(capabilities)


@router.get('/catalog')
async def catalog(source:Literal['library','image-manager']='library',person:str='',scene:str='',offset:int=0,rating:str='',query:str='',category:str='',project:str='',favorite:bool|None=None,review_status:Literal['','unreviewed','reviewed','accepted','rejected']=''):
    return await call(store.catalog,source,person,scene,max(0,offset),rating=rating,query=query[:200],category=category,project=project,favorite=favorite,review_status=review_status)


@router.post('/open')
async def open_item(request:Selection):
    if len(request.ids)!=1: raise HTTPException(422,'Open one image at a time.')
    return await call(store.open_item,request.source,request.ids[0])


@router.post('/review')
async def save(request:Review):
    if any(len(tag.strip())>80 or not tag.strip() for tag in request.tags): raise HTTPException(422,'Tags need 1 to 80 characters.')
    return await call(store.review,request.source,request.id,request.model_dump(exclude={'source','id'},exclude_unset=True))


@router.post('/classify')
async def classify(request:Batch):
    try: return classifier.start(request.source,request.ids,request.faces,request.model)
    except ValueError as error: raise HTTPException(422,str(error)) from error


@router.get('/job')
async def job(id:str=''): return await call(classifier.status,id)


@router.post('/classify-catalog')
async def classify_catalog(request:CatalogBatch):
    ids,total=await call(store.pending_ids,request.source,request.faces,request.model)
    if not ids: return {'status':'complete','source':request.source,'processed':0,'total':0,'errors':[],'message':'All visible catalog items have the requested classifications.'}
    try:
        value=classifier.start(request.source,ids,request.faces,request.model)
        return {**value,'remaining_after_batch':max(0,total-len(ids))}
    except ValueError as error: raise HTTPException(422,str(error)) from error


@router.post('/stop')
async def stop(): return await classifier.stop()


@router.post('/person')
async def person(request:Person): return await call(store.rename_person,request.id,request.name)


@router.post('/face')
async def face(request:Correction): return await call(store.correct_face,request.id,request.person_id,request.exclude,request.name)


@router.post('/merge')
async def merge(request:Merge): return await call(store.merge_people,request.source_id,request.target_id)


@router.post('/scenes')
async def scenes(request:Scenes): return await call(store.set_scenes,request.digest,request.labels)


@router.get('/faces/{identifier}')
async def face_preview(identifier:str): return Response(await call(store.crop,identifier),media_type='image/jpeg',headers={'Cache-Control':'no-store'})


@router.post('/export')
async def export(request:Selection):
    if len(request.ids)>100: raise HTTPException(422,'Export up to 100 reviewed images at a time.')
    def build():
        output=io.BytesIO(); records=[]; total=0
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:
            for number,identifier in enumerate(request.ids,1):
                raw,digest,name=store.read_source(request.source,identifier); total+=len(raw)
                if total>256*1024*1024: raise ValueError('Export exceeds 256 MiB. Select fewer images.')
                safe=re.sub(r'[^\w. -]','_',name.replace('\\','/').split('/')[-1])[:120] or 'image'
                filename=f'{number:04d}-{safe}'
                review=store.review(request.source,identifier)
                archive.writestr(filename,raw); archive.writestr(filename+'.txt',review['caption'])
                records.append({'file':filename,'sha256':digest,**review,'classification':store.result(digest)})
            archive.writestr('review.json',json.dumps(records,ensure_ascii=False,indent=2))
        return output.getvalue()
    return Response(await call(build),media_type='application/zip')


# The isolated Media Manager server receives only a review-scoped credential.
# Its proxy sends bounded preview bytes from validated catalog IDs, never paths.
class Sample(BaseModel):
    id: str=Field(min_length=1,max_length=300)
    name: str=Field(max_length=240)
    digest: str=Field(pattern=r'^[a-f0-9]{64}$')
    image: str=Field(max_length=3_000_000)
    native_tags: list[str] | None=Field(default=None,max_length=100)


class MediaBatch(BaseModel):
    items: list[Sample]=Field(min_length=1,max_length=20)
    faces: bool=True
    model: str=Field(default='',max_length=200)


@router.post('/media/register')
async def media_register(request:Sample):
    raw=await call(base64.b64decode,request.image,validate=True)
    await call(store.image,raw)
    await call(store.register,'media-manager',request.id,request.name,request.digest)
    value=await call(store.review,'media-manager',request.id)
    if request.native_tags is not None: value=await call(store.sync_media_tags,request.id,request.native_tags)
    return {'digest':request.digest,'name':request.name,'review':value,'media':await call(store.media_record,'media-manager',request.id,value),'classification':await call(store.result,request.digest)}


@router.post('/media/classify')
async def media_classify(request:MediaBatch):
    samples={}
    for item in request.items:
        raw=await call(base64.b64decode,item.image,validate=True)
        await call(store.image,raw)
        samples[item.id]={'raw':raw,'digest':item.digest,'name':item.name}
    try: return classifier.start('media-manager',list(samples),request.faces,request.model,samples)
    except ValueError as error: raise HTTPException(422,str(error)) from error


@router.get('/media/capabilities')
async def media_info(): return await info()


@router.get('/media/catalog')
async def media_catalog(person:str='',scene:str='',offset:int=0,rating:str='',query:str='',category:str='',project:str='',favorite:bool|None=None,review_status:Literal['','unreviewed','reviewed','accepted','rejected']=''):
    return await call(store.catalog,'media-manager',person,scene,max(0,offset),rating=rating,query=query[:200],category=category,project=project,favorite=favorite,review_status=review_status)


@router.get('/media/job')
async def media_job():
    value=await job()
    return value if value and value['source']=='media-manager' else None


@router.post('/media/stop')
async def media_stop():
    if classifier.current and classifier.current['source']=='media-manager': return await stop()
    raise HTTPException(409,'No Media Manager classification is running.')


@router.post('/media/review')
async def media_review(request:Review):
    if request.source!='media-manager': raise HTTPException(403,'Media review scope required.')
    return await save(request)


@router.get('/media/review')
async def media_read(id:str): return await call(store.review,'media-manager',id)


def media_person(identifier):
    with store.database() as db:
        if not db.execute("SELECT 1 FROM faces f JOIN sources s ON s.digest=f.digest WHERE s.source='media-manager' AND f.person_id=?",(identifier,)).fetchone():
            raise HTTPException(403,'Choose a person group from Media Manager.')


@router.post('/media/person')
async def media_rename(request:Person):
    media_person(request.id); return await person(request)


@router.post('/media/face')
async def media_face(request:Correction):
    with store.database() as db:
        if not db.execute("SELECT 1 FROM faces f JOIN sources s ON s.digest=f.digest WHERE s.source='media-manager' AND f.id=?",(request.id,)).fetchone(): raise HTTPException(403,'Media face scope required.')
    if request.person_id: media_person(request.person_id)
    return await face(request)


@router.post('/media/merge')
async def media_merge(request:Merge):
    media_person(request.source_id); media_person(request.target_id); return await merge(request)


@router.post('/media/scenes')
async def media_scenes(request:Scenes):
    with store.database() as db:
        if not db.execute("SELECT 1 FROM sources WHERE source='media-manager' AND digest=?",(request.digest,)).fetchone(): raise HTTPException(403,'Media item scope required.')
    return await scenes(request)


@router.get('/media/faces/{identifier}')
async def media_crop(identifier:str):
    with store.database() as db:
        if not db.execute("SELECT 1 FROM faces f JOIN sources s ON s.digest=f.digest WHERE s.source='media-manager' AND f.id=?",(identifier,)).fetchone(): raise HTTPException(403,'Media face scope required.')
    return await face_preview(identifier)
