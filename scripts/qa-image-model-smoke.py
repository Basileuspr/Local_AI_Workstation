"""One real installed image-model smoke using disposable output and no adapters."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import tempfile

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--model',required=True)
parser.add_argument('--size',type=int,default=256)
parser.add_argument('--steps',type=int,default=2)
args=parser.parse_args()
output=Path(tempfile.mkdtemp(prefix='law-model-smoke-'))
os.environ['LAW_DATA_DIR']=str(output)
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from PIL import Image
from routes.image_generation import ImageGenerationRequest, generate_image
from services.image_generation import manager,OUTPUT_DIR
from services.request_queue import queue
from services import storage_libraries as storage

class Client:
    async def is_disconnected(self): return False

async def run():
    print(json.dumps({'model':args.model,'output':str(output)}),flush=True)
    result=await generate_image(ImageGenerationRequest(model_id=args.model,prompt='A blue ceramic cup on a wooden table, daylight',
        width=args.size,height=args.size,steps=args.steps,guidance_scale=4.5,seed=123,request_id='model-smoke'),Client())
    with Image.open(storage.resolve(OUTPUT_DIR/result['filename'])) as image:
        image.load()
        assert image.size == (args.size,args.size)
        assert image.info['local_ai_seed'] == '123'
    assert queue.active is None
    report={'ok':True,'model':args.model,'size':[args.size,args.size],'steps':args.steps,
            **{key:result[key] for key in ['filename','seed','generation_seconds','peak_vram_bytes']}}
    (output/'result.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report),flush=True)

try: asyncio.run(run())
finally: manager.unload_for_training()
