"""Real Image Tools API, restricted to dedicated disposable fixture data."""
import os
from pathlib import Path

root = Path(os.environ.get('LAW_DATA_DIR', '')).absolute()
assert root.parent.name.startswith('law-image-tools-'), 'Set the dedicated temporary fixture directory.'

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from routes.image_manager import router
from services.image_manager import manager
from services.image_manager_metadata import open_local_image

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1:5193','app://local'], allow_methods=['*'], allow_headers=['*'])
app.include_router(router)
source = root.parent / 'source'
output = root.parent / 'output'
source.mkdir(parents=True, exist_ok=True)
output.mkdir(parents=True, exist_ok=True)
fixtures = [('one.png', (40, 20), 'red'), ('two.png', (20, 40), 'blue')]
if os.environ.get('LAW_QA_IMAGE_TOOLS_LARGE') == '1':
    fixtures = [('one.png', (10000, 5000), 'red'), ('two.bmp', (5000, 5000), 'blue')]
for name, size, color in fixtures:
    with Image.new('RGB', size, color) as image: image.save(source / name)
for index in range(2,int(os.environ.get('LAW_QA_IMAGE_TOOLS_COUNT','2'))):
    Image.new('RGB',(16,16),(index%256,40,100)).save(source/f'fixture-{index:04d}.png')


@app.get('/fixture/folders')
def folders():
    return {'source': str(source), 'output': str(output)}


@app.get('/fixture/result')
def result():
    job = manager.state()['job']
    value = job.get('result', {}).get('image_tools') if job else None
    dimensions = {}
    if value:
        for item in value['images'] + value.get('sheets', []):
            with open_local_image(item['path']) as image:
                dimensions[Path(item['path']).name] = list(image.size)
    return {'job': job, 'dimensions': dimensions}
