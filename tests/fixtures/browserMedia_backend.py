"""Isolated browser QA backend, no application data or live accounts."""
import json
import os
from pathlib import Path
import socket
import sys

repo=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(repo/'backend'),str(repo/'tests'/'backend')]
from fastapi import FastAPI
import uvicorn
from routes.browser_media import router
from services.session_guard import SessionGuard
from test_local_files import make_video

work=Path(sys.argv[1]);video=work/'fixture.mp4';make_video(video,frames=30,audio=True)
os.environ['LAW_BROWSER_WORKFLOW_DIR']=str(work/'workflows'/'media')
os.environ['LAW_LOCAL_FILES_TOKEN']='fixture-native'
os.environ['LAW_SESSION_TOKEN']='fixture-session'
app=FastAPI();app.include_router(router);app.add_middleware(SessionGuard)
sock=socket.socket();sock.bind(('127.0.0.1',0))
print(json.dumps({'port':sock.getsockname()[1],'video':str(video)}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False)).run(sockets=[sock])
