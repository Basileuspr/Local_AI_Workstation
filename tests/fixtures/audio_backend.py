"""Isolated real audio API for desktop upload QA; no chat or user storage."""
import json
from pathlib import Path
import socket
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from routes.audio import router
from services.session_guard import SessionGuard

app = FastAPI()
app.include_router(router)
app.add_middleware(SessionGuard)
app.add_middleware(CORSMiddleware, allow_origins=['app://local'], allow_methods=['*'], allow_headers=['*'])
listener = socket.socket()
listener.bind(('127.0.0.1', 0))
listener.listen(128)
print(json.dumps({'port':listener.getsockname()[1]}), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False)).run(sockets=[listener])
