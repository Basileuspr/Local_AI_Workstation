from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from services import app_integrations as integrations, linked_apps

from services.upload_routes import UploadRoute

router = APIRouter(route_class=UploadRoute, prefix='/integrations', tags=['integrations'])

class EmbedRequest(BaseModel):
    service: str = Field(pattern=r'^(discord|spotify)$')
    value: str = Field(max_length=2048)

class DiscordMessage(BaseModel):
    method: str = Field(default='webhook', pattern=r'^(webhook|bot)$')
    webhook: str = Field(default='', max_length=500)
    bot_token: str = Field(default='', max_length=200)
    channel_id: str = Field(default='', max_length=20)
    content: str = Field(default='', max_length=2000)
    title: str = Field(default='', max_length=256)
    description: str = Field(default='', max_length=4096)

@router.get('/status')
def status():
    return {'processes': linked_apps.processes(), 'phone': integrations.phone_readiness(),
            'spotify_capture': 'Windows system playback loopback; includes Spotify and other application audio.'}

@router.post('/embed')
def embed(value: EmbedRequest):
    try: return {'url': integrations.embed_url(value.service, value.value)}
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc

@router.post('/discord/preview')
def preview(value: DiscordMessage):
    return integrations.discord_payload(value.content, value.title, value.description)

@router.post('/discord/send')
async def send(payload: str = Form(..., max_length=10000), files: list[UploadFile] = File(default=[])):
    try:
        try: value = DiscordMessage.model_validate_json(payload).model_dump()
        except ValueError: raise HTTPException(400, 'Invalid Discord message request.') from None
        attachments = []; size = 0
        for index, file in enumerate(files):
            raw = await file.read()
            size += len(raw)
            name = (file.filename or f'attachment-{index}').replace('\\', '/').split('/')[-1]
            # Prefix names to avoid attachment URL collisions and remove control characters.
            import re
            name = f'{index}-' + re.sub(r'[^\w .-]', '_', name)[:100]
            attachments.append((name, raw, file.content_type or 'application/octet-stream'))
        return await integrations.send_discord(value, attachments)
    except ValueError as exc: raise HTTPException(400, str(exc)) from None
    finally:
        for file in files: await file.close()

@router.post('/spotify/recordings')
async def save_recording(file: UploadFile = File(...)):
    try: return integrations.save_recording(await file.read())
    except ValueError as exc: raise HTTPException(400, str(exc)) from exc
    finally: await file.close()

@router.get('/spotify/recordings/{ident}')
def recording(ident: str):
    try: return FileResponse(integrations.recording(ident), filename='spotify-playback.webm', media_type='audio/webm', headers={'Cache-Control': 'no-store'})
    except FileNotFoundError as exc: raise HTTPException(404, str(exc)) from exc
