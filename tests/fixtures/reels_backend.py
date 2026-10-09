"""Owned HTTPS media fixture + deterministic local model adapters, no live accounts."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

repo=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(repo/'backend'),str(repo/'tests'/'backend')]
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi import FastAPI
import uvicorn
from routes.browser_media import router as media_router
from routes.reels import router as reels_router
from services import reels_analysis as analysis
from services.session_guard import SessionGuard
from test_local_files import make_video

work=Path(sys.argv[1]);video=work/'fixture.mp4';make_video(video,frames=30,audio=True)
os.environ['LAW_BROWSER_WORKFLOW_DIR']=str(work/'workflows'/'media')
os.environ['LAW_REELS_DATA_DIR']=str(work/'results')
os.environ['LAW_LOCAL_FILES_TOKEN']='fixture-native';os.environ['LAW_SESSION_TOKEN']='fixture-session'
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'browser.example.com')])
now=datetime.datetime.now(datetime.timezone.utc)
cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number())
    .not_valid_before(now-datetime.timedelta(minutes=5)).not_valid_after(now+datetime.timedelta(days=1))
    .add_extension(x509.SubjectAlternativeName([x509.DNSName('browser.example.com')]),critical=False).sign(key,hashes.SHA256()))
if (work/'fixture.pem').exists():
    cert=x509.load_pem_x509_certificate((work/'fixture.pem').read_bytes())
else:
    (work/'fixture.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    (work/'fixture.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))

async def ready(*args):return {'ready':True}
async def prepare(*args):pass
analysis.readiness=ready;analysis.prepare_runtime=prepare
analysis.audio.transcribe=lambda *args,**kwargs:{'duration':3,'segments':[{'start':0,'end':2.5,'text':'The creator demonstrates a local tool.'}]}
async def model(name,prompt,cancel,image=None,tokens=650,**kwargs):
    if image is not None:return 'A creator demonstrates a local tool. github.com/fixture/owned-tool'
    if prompt.startswith('Extract only'):
        group=json.loads(prompt.rsplit('\n',1)[1]);row=group[0]
        return json.dumps({'selected':[{'id':row['id'],'quote':row['text'][:120]}]})
    if prompt.startswith('Check each'):return '{"supported":true}'
    return json.dumps({'sentences':[{'text':'The creator demonstrates a local tool.','evidence':[{'id':'caption','quote':'demonstrates a local tool'}]},
        {'text':'They describe the tool in a brief demonstration.','evidence':[{'id':'speech0','quote':'demonstrates a local tool'}]}]})
analysis.video_analysis.complete=model
app=FastAPI();app.include_router(media_router);app.include_router(reels_router);app.add_middleware(SessionGuard)
sock=socket.socket();sock.bind(('127.0.0.1',0))
print(json.dumps({'port':sock.getsockname()[1],'video':str(video),'fingerprint':cert.fingerprint(hashes.SHA256()).hex()}),flush=True)
uvicorn.Server(uvicorn.Config(app,log_level='error',access_log=False)).run(sockets=[sock])
