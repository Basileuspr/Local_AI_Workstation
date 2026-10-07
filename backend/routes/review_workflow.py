from typing import Literal
from fastapi import APIRouter, Query
from pydantic import BaseModel, ConfigDict, Field
from routes.visual_review import call
from services import review_workflow as workflow
from services.review_metadata import ReviewFields
from services.visual_classification import classifier

router=APIRouter(prefix='/visual-review/workflow',tags=['review-workflow'])


class Request(BaseModel):
    model_config=ConfigDict(extra='forbid')


class IDs(Request):
    media_ids:list[str]=Field(min_length=1,max_length=100)


class Edit(IDs):
    changes:ReviewFields


class Preset(Request):
    destination_preset_id:str=Field(max_length=80)
    path:str=Field(min_length=1,max_length=1000)


class Plan(IDs):
    mode:Literal['copy','move','leave']
    destination_preset_id:str=Field(default='',max_length=80)
    collision:Literal['rename','skip']='rename'


class Confirm(Request):
    reviewed_plan_id:str=Field(max_length=80)
    confirmed:Literal[True]


class Locate(Request):
    media_id:str=Field(max_length=360)
    path:str=Field(min_length=1,max_length=1000)


class MediaID(Request):
    media_id:str=Field(max_length=360)


class Suggest(IDs):
    model:str=Field(min_length=1,max_length=200)


class Resolve(MediaID):
    action:Literal['accept','ignore']
    changes:ReviewFields|None=None


@router.get('/list')
async def listing(source:Literal['','library','image-manager','media-manager','video-analyzer']='',status:Literal['','unreviewed','reviewed','accepted','rejected']='',favorite:bool|None=None,query:str=Query(default='',max_length=200),offset:int=Query(default=0,ge=0),limit:int=Query(default=48,ge=1,le=100)):
    return await call(workflow.listing,source,status,favorite,query,offset,limit)


@router.get('/metadata')
async def metadata(media_id:str=Query(max_length=360)):
    return await call(workflow.media,media_id)


@router.post('/edit')
async def edit(request:Edit):
    return await call(workflow.batch,request.media_ids,request.changes.model_dump(exclude_unset=True))


@router.get('/presets')
async def presets(): return await call(workflow.presets)


@router.post('/presets')
async def preset(request:Preset): return await call(workflow.set_preset,request.destination_preset_id,request.path)


@router.post('/plan')
async def plan(request:Plan): return await call(workflow.prepare,request.media_ids,request.mode,request.destination_preset_id,request.collision)


@router.post('/apply')
async def apply(request:Confirm): return await call(workflow.apply,request.reviewed_plan_id,request.confirmed)


@router.get('/plans')
async def plans(): return await call(workflow.records,'plan')


@router.post('/undo')
async def undo(request:Confirm): return await call(workflow.undo,request.reviewed_plan_id,request.confirmed)


@router.post('/locate')
async def locate(request:Locate): return await call(workflow.locate,request.media_id,request.path)


@router.post('/forget')
async def forget(request:MediaID): return await call(workflow.forget,request.media_id)


@router.get('/suggestions')
async def suggestions(media_id:str=Query(max_length=360)): return await call(workflow.suggestions,media_id)


@router.post('/suggest')
async def suggest(request:Suggest):
    values=[workflow.split(identifier) for identifier in request.media_ids]
    sources={source for source,_ in values}
    if len(sources)!=1 or 'media-manager' in sources:
        from fastapi import HTTPException
        raise HTTPException(422,'Select images from one source. Video vision suggestions use the isolated Media Manager preview bridge.')
    return await call_start(next(iter(sources)),[identifier for _,identifier in values],request.model)


async def call_start(source,ids,model):
    # start creates an asyncio task and must run on the request event loop.
    from fastapi import HTTPException
    try: return classifier.start(source,ids,False,model,suggestions=True)
    except ValueError as error: raise HTTPException(422,str(error)) from error


@router.post('/suggestions')
async def resolve(request:Resolve):
    return await call(workflow.resolve_suggestions,request.media_id,request.action,request.changes.model_dump(exclude_unset=True) if request.changes else None)


# Coordinator tools expose only ID-based operations, never preset setup, paths,
# plan approval, recovery, deletion or arbitrary shell/HTTP dispatch.
class Tag(MediaID):
    tag:str=Field(min_length=1,max_length=80)


class Classification(MediaID):
    category:str=Field(max_length=120)


class Execute(Request):
    reviewed_plan_id:str=Field(max_length=80)
    destination_preset_id:str=Field(max_length=80)


@router.get('/coordinator/list')
async def coordinator_list(source:Literal['','library','image-manager','media-manager','video-analyzer']='',offset:int=Query(default=0,ge=0),limit:int=Query(default=48,ge=1,le=100)):
    return await call(workflow.listing,source,'',None,'',offset,limit)


@router.get('/coordinator/list_unreviewed')
async def coordinator_unreviewed(source:Literal['','library','image-manager','media-manager','video-analyzer']='',offset:int=Query(default=0,ge=0),limit:int=Query(default=48,ge=1,le=100)):
    return await call(workflow.listing,source,'unreviewed',None,'',offset,limit)


@router.get('/coordinator/get_metadata')
async def coordinator_metadata(media_id:str=Query(max_length=360)): return await call(workflow.media,media_id)


@router.post('/coordinator/add_tag')
async def add_tag(request:Tag): return await call(workflow.add_tag,request.media_id,request.tag)


@router.post('/coordinator/set_classification')
async def classification(request:Classification): return await call(workflow.patch,request.media_id,{'category':request.category})


@router.post('/coordinator/copy')
async def copy(request:Execute): return await call(workflow.coordinator_transfer,'copy',request.reviewed_plan_id,request.destination_preset_id)


@router.post('/coordinator/move')
async def move(request:Execute): return await call(workflow.coordinator_transfer,'move',request.reviewed_plan_id,request.destination_preset_id)


@router.post('/approve')
async def approve(request:Confirm): return await call(workflow.approve,request.reviewed_plan_id)


class RegisterVideo(Request):
    session_id:str=Field(min_length=1,max_length=80)


@router.post('/register-video')
async def register_video(request:RegisterVideo): return await call(workflow.register_video,request.session_id)


@router.get('/videos/{identifier}/content')
async def video_content(identifier:str):
    from fastapi import HTTPException
    from fastapi.responses import FileResponse
    value=await call(workflow.native_record,identifier)
    if value['file_state']!='present': raise HTTPException(409,'Video changed or is unavailable. Locate or register it again.')
    return FileResponse(value['path'])
