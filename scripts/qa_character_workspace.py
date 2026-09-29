"""Disposable character/Knowledge stores, real endpoints, fixed test embeddings."""
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import threading
import time
import wave

root = Path(tempfile.mkdtemp(prefix='law-character-workspace-'))
token = secrets.token_urlsafe(32)
os.environ.update(LAW_DATA_DIR=str(root/'data'),LAW_LOG_DIR=str(root/'logs'),LAW_MODELS_DIR=str(root/'models'),LAW_SESSION_TOKEN=token,ANONYMIZED_TELEMETRY='False')
project = Path(__file__).resolve().parents[1]
sys.path.insert(0,str(project/'backend'))
sys.path.insert(0,str(project/'tests/backend'))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import files, faces, audio, image_library as image_routes
from services import knowledge_base as kb
from services.faces import bank
from services.character_parts import store as parts
from services.session_guard import SessionGuard
from test_face_bank import seed, unit
from PIL import Image
import av
import numpy as np
import uvicorn

dataset, face_ids = seed('Synthetic reference',[unit([1,0])])
original = bank.create_character('Atlas',dataset,face_ids,notes='An existing character with one synthetic face reference.')
bank.create_character('Bea',notes='Another character for navigation checks.')
part_dataset=parts.create('Explorer hands')
reference_file=root/'Synthetic voice.wav'
with wave.open(str(reference_file),'wb') as output:
    output.setnchannels(1);output.setsampwidth(2);output.setframerate(16000);output.writeframes(b'\0\0'*16000*6)
image_file=root/'Character portrait.png'
Image.new('RGB',(80,60),(35,130,190)).save(image_file)
video_files=[]
for suffix,codec in [('mp4','libx264'),('webm','libvpx')]:
    video_file=root/f'Character motion.{suffix}'
    with av.open(str(video_file),'w') as output:
        stream=output.add_stream(codec,rate=12);stream.width=96;stream.height=64;stream.pix_fmt='yuv420p'
        for i in range(24):
            pixels=np.zeros((64,96,3),dtype=np.uint8);pixels[:]=(30,90+i*5,180)
            frame=av.VideoFrame.from_ndarray(pixels,format='rgb24');frame.pts=i
            for packet in stream.encode(frame):output.mux(packet)
        for packet in stream.encode(None):output.mux(packet)
    video_files.append(str(video_file))
unsupported_file=root/'Unsupported clip.avi';unsupported_file.write_bytes(b'An unsupported video fixture')
kb._create_embeddings = lambda texts,cancel_event=None: [[1.,0.,0.] for _ in texts]
kb._get_collection()  # Initialize the disposable store before concurrent UI reads.
async def no_inference(kind): pass
files.prepare_runtime = no_inference
app = FastAPI()
app.include_router(files.router);app.include_router(faces.router);app.include_router(audio.router)
app.include_router(image_routes.router)
app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware,allow_origins=['app://local'],allow_methods=['*'],allow_headers=['*'])
sock = socket.socket();sock.bind(('127.0.0.1',0))
server = uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False))
thread = threading.Thread(target=server.run,kwargs={'sockets':[sock]},daemon=True);thread.start()
while not server.started: time.sleep(.02)
print(json.dumps({'url':f'http://127.0.0.1:{sock.getsockname()[1]}','token':token,'directory':str(root),'original_id':original['id'],'parts_id':part_dataset['id'],'reference_file':str(reference_file),'image_file':str(image_file),'video_files':video_files,'unsupported_file':str(unsupported_file)}),flush=True)
sys.stdin.readline();server.should_exit=True;thread.join(timeout=10)
