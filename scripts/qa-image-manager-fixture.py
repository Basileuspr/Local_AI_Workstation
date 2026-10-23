"""Add isolated still-image folders to the existing synthetic desktop fixture."""
from pathlib import Path
import os
import runpy
import shutil
import sys
import time
from PIL import Image
import uvicorn

root = Path(sys.argv[1]).resolve()
source = root / 'image-source'; source.mkdir()
output = root / 'image-output'; output.mkdir()
Image.new('RGB', (640, 400), '#336f9b').save(source / 'landscape.png')
shutil.copy2(source / 'landscape.png', source / 'landscape-copy.png')
Image.new('RGB', (400, 640), '#8a4964').save(source / 'portrait.jpg')
Image.new('RGB', (32, 32), 'red').save(source / 'animated.gif', save_all=True, append_images=[Image.new('RGB', (32, 32), 'blue')], duration=100, loop=0)
scroll_source = root / 'scroll-source'; scroll_source.mkdir()
for index in range(52):
    Image.new('RGB', (80, 60), (index * 4, 100, 180)).save(scroll_source / f'image-{index:03d}.png')
original_config = uvicorn.Config
def configure(app, *args, **kwargs):
    # The parent fixture sets isolated LAW_* paths and the session token before
    # importing application routes. Attach our independent router at that point.
    from routes.image_manager import router
    if os.environ.get('LAW_QA_IMAGE_SCAN_GATE') == '1':
        from services import image_manager
        original_metadata = image_manager.image_metadata

        def gated_metadata(path):
            gate = root / 'pause-scan'
            if gate.exists():
                (root / 'scan-paused').touch()
                deadline = time.monotonic() + 45
                while gate.exists() and time.monotonic() < deadline:
                    time.sleep(0.05)
                if gate.exists():
                    raise ValueError('Synthetic scan gate timed out')
            return original_metadata(path)

        image_manager.image_metadata = gated_metadata
    app.include_router(router)
    return original_config(app, *args, **kwargs)
uvicorn.Config = configure
runpy.run_path(str(Path(__file__).with_name('qa-generation-controls-fixture.py')), run_name='__main__')
