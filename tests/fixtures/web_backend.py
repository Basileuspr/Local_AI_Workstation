"""Owned model/page adapters behind real routes; no live accounts or crawl task."""
import datetime
import json
import os
from pathlib import Path
import socket
import sys
repo=Path(__file__).resolve().parents[2];work=Path(sys.argv[1])
sys.path[:0]=[str(repo/'backend'),str(repo/'tests'/'backend')]
os.environ['LAW_DATA_DIR']=str(work);os.environ['LAW_WEB_SYSTEM_DIR']=str(work/'web-system')
os.environ['LAW_SESSION_TOKEN']='fixture-session';os.environ['LAW_LOCAL_FILES_TOKEN']='fixture-native'
from cryptography import x509
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
import uvicorn
from services.session_guard import SessionGuard
from routes import web_system
from services import web_knowledge
from test_web_research import Fixture,Pages
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'browser.example.com')]);now=datetime.datetime.now(datetime.timezone.utc)
cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(now-datetime.timedelta(minutes=5)).not_valid_after(now+datetime.timedelta(days=1))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName('browser.example.com')]),critical=False).sign(key,hashes.SHA256()))
(work/'fixture.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.TraditionalOpenSSL,serialization.NoEncryption()))
(work/'fixture.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
manager=Fixture(Pages());web_system.manager=manager
web_system.search_config({'provider':'searxng','endpoint':'https://search.example.com/search'})
# Verify route handoff selection/provenance without touching actual Knowledge.
def ingest(document,**kwargs):
    normalized=web_knowledge.normalized(document);path=work/'saved-selection.json';path.write_text(json.dumps(normalized));return {'doc_id':'selected-fixture'}
web_knowledge.ingest=ingest
from routes import files
async def embedding(request,label,operation,*args):return operation(*args)
files._embedding_work=embedding
app=FastAPI();app.include_router(web_system.router);app.add_middleware(SessionGuard)
sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
print(json.dumps({'port':port,'fingerprint':cert.fingerprint(hashes.SHA256()).hex()}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False)).run(sockets=[sock])
