"""Verify the current image-plus-caption ZIP contract using synthetic QA data."""
from pathlib import Path
import sys
import zipfile
from PIL import Image

root=Path(sys.argv[1])
for filename,count in [('review-image.zip',1),('review-selected.zip',2)]:
    with zipfile.ZipFile(root/filename) as archive:
        images=[name for name in archive.namelist() if name.endswith('.png')]
        assert len(images) == count
        for name in images:
            source='review-a.png' if name.endswith('review-a.png') else 'review-b.png'
            assert archive.read(name) == (root/source).read_bytes()
            if source == 'review-a.png':
                assert archive.read(name.replace('.png','.txt')).decode('utf-8') == 'Caption saved before export'
outputs=list((root/'data'/'generated_images').glob('*.png'))
assert len(outputs) == 4
for output in outputs:
    with Image.open(output) as image:
        image.load()
        assert image.size == (512,512)
print('Original ZIP payloads, saved caption sidecars and all batch PNG sizes verified')
