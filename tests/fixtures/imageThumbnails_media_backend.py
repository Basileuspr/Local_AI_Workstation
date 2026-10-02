"""Disposable image-folder browser fixture using the actual Media Manager server."""
from pathlib import Path
import sys
import tempfile
import json
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'media-manager'))
from media_organizer.ui_server import make_server

with tempfile.TemporaryDirectory(prefix='law-media-thumbnail-preview-') as temporary:
    root = Path(temporary); source = root / 'source'; source.mkdir()
    for index, color in enumerate(['#4169a1', '#cc713d', '#397e60', '#915fb0']):
        image = Image.new('RGB', (1200, 600), color)
        ImageDraw.Draw(image).ellipse((140, 140, 440, 440), fill='white')
        image.save(source / f'{index + 1}.png')
    server = make_server(port=8087, reports=str(root / 'reports'))
    print(json.dumps({'url': 'http://127.0.0.1:8087', 'source': str(source)}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
