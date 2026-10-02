"""Real installed-model acceptance on a synthetic video; run with an idle GPU."""
import json
import os
from pathlib import Path
import sys
import tempfile
from uuid import uuid4

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
import av
from PIL import Image, ImageDraw
from fastapi import FastAPI
from fastapi.testclient import TestClient
from routes.local_files import router
from services import local_files

root=Path(tempfile.mkdtemp(prefix='law-video-analysis-qa-'))
source=root/'moving-circle.mp4'
with av.open(str(source),'w') as output:
    stream=output.add_stream('libx264',rate=10);stream.width=640;stream.height=360;stream.pix_fmt='yuv420p'
    for index in range(30):
        phase=index//10;position=[100,320,540][phase]
        with Image.new('RGB',(640,360),'white') as picture:
            draw=ImageDraw.Draw(picture);draw.ellipse((position-45,130,position+45,220),fill='red')
            draw.text((20,20),['LEFT','CENTER','RIGHT'][phase],fill='black',font_size=32)
            frame=av.VideoFrame.from_image(picture);frame.pts=index
            for packet in stream.encode(frame):output.mux(packet)
    for packet in stream.encode(None):output.mux(packet)
token=uuid4().hex;os.environ['LAW_LOCAL_FILES_TOKEN']=token
app=FastAPI();app.include_router(router)
with TestClient(app) as client:
    response=client.post('/local-files/open',headers={'x-local-files':token},json={'path':str(source)})
    response.raise_for_status();identifier=response.json()['id']
    try:
        print('Analyzing a synthetic three-second video with the real installed vision model.',flush=True)
        result=client.post(f'/local-files/{identifier}/video',json={'operation':'vision','model':sys.argv[1] if len(sys.argv)>1 else 'qwen3-vl:8b','preset':'quick','focus':'Describe the colored object and how its position differs across samples.'})
        result.raise_for_status();analysis=result.json()['data']['analysis']
        assert analysis['status']=='complete' and len(analysis['observations'])==3
        assert len(analysis['summary'])>80
        assert all(len(row['text'])>40 for row in analysis['observations'])
        (root/'analysis.json').write_text(json.dumps(analysis,indent=2),encoding='utf-8')
        print(json.dumps({'ok':True,'artifacts':str(root),'analysis':analysis},indent=2),flush=True)
    finally:client.delete(f'/local-files/{identifier}')
