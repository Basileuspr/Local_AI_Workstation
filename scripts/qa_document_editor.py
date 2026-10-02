"""Disposable document-only server for the browser fixture. No user data access."""
import os
from pathlib import Path
import sys
import tempfile

scratch = Path(tempfile.gettempdir()) / 'law-document-editor-qa'
os.environ['LAW_DATA_DIR'] = str(scratch / 'data')
os.environ['LAW_LOG_DIR'] = str(scratch / 'logs')
os.environ['LAW_MODELS_DIR'] = str(scratch / 'models')
os.environ['LAW_SESSION_TOKEN'] = 'editor-qa-token'
os.environ['LAW_ALLOWED_ORIGINS'] = 'http://127.0.0.1:5176'
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from services.session_guard import SessionGuard
from routes.document_editor import router
import uvicorn

origin = 'http://127.0.0.1:5176'
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=[origin], allow_methods=['POST'], allow_headers=['Content-Type'])
app.add_middleware(SessionGuard)
app.include_router(router)

if __name__ == '__main__':
    uvicorn.run(app, host='127.0.0.1', port=8016, access_log=False)
