"""Only runs against a dedicated disposable gallery fixture directory."""
import io
import os
from pathlib import Path

root = Path(os.environ.get('LAW_DATA_DIR', '')).absolute()
assert root.parent.name.startswith('law-stitcher-qa-'), 'Use a dedicated temporary fixture directory.'

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageDraw
from routes.image_library import router
from services import image_library as library

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=['app://local'], allow_methods=['*'], allow_headers=['*'])
app.include_router(router)
originals = {}
for number in range(1, 40):
    with Image.new('RGB', (320, 180), (25 + number * 3, 50, 100 + number * 2)) as image:
        draw = ImageDraw.Draw(image)
        draw.rectangle((20 + number, 40, 90 + number, 125), fill='#ffc85c')
        draw.text((150, 80), f'Scene {number:02}', fill='white')
        stream = io.BytesIO(); image.save(stream, 'PNG')
    item = library.import_image(stream.getvalue(), f'Scene {number:02}.png', {'kind': 'fixture'})
    originals[item['id']] = library.image_bytes(item['id'])


@app.get('/fixture/check')
def check():
    unchanged = all(library.image_bytes(item_id) == value for item_id, value in originals.items())
    stitches = [item for item in library.public_index()['images'] if item['origin']['kind'] == 'stitch']
    return {'originals_unchanged': unchanged, 'stitches': stitches}


@app.post('/fixture/large')
def large():
    path = root / 'large-fixture.png'
    with Image.new('RGB', (6144, 6144), '#273548') as image:
        draw = ImageDraw.Draw(image)
        for number in range(60):
            x, y = number % 8 * 768, number // 8 * 768
            draw.rectangle((x + 20, y + 20, x + 748, y + 748), fill=(30 + number * 3, 80, 200 - number * 2))
            draw.text((x + 100, y + 100), f'FRAME {number + 1:02}', fill='white', font_size=90)
        image.save(path, 'PNG', compress_level=0)
        image.thumbnail((1600, 1600))
        preview = io.BytesIO(); image.save(preview, 'PNG')
    return library.import_composite(path, preview.getvalue(), 6144, 6144, {'kind': 'fixture-large', 'options': {'layout': 'grid'}})
