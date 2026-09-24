"""Quality regression for synthetic exported PNGs, not model-quality inference."""
import json
from pathlib import Path
import sys
from PIL import Image, ImageChops, ImageStat, ImageDraw

root = Path(sys.argv[1])
images = {name: Image.open(root / f'detail-{name}.png').convert('RGB')
          for name in ('reference', 'source', 'deblur', 'refinement', 'combined', 'preview', 'original-preview')}
assert all(image.size == (1800, 900) for image in images.values())
assert images['preview'].tobytes() == images['deblur'].tobytes(), '100% preview must match exported pixels'
assert images['original-preview'].tobytes() == images['source'].tobytes(), '100% original must not be enlarged from a thumbnail'
def mse(image):
    return sum(value ** 2 for value in ImageStat.Stat(ImageChops.difference(images['reference'], image)).rms) / 3
errors = {name: round(mse(images[name]), 3) for name in ('source', 'deblur', 'refinement', 'combined')}
for name in ('deblur', 'refinement', 'combined'):
    assert errors[name] < errors['source'], (name, errors)
# Crop at native pixel scale for an inspectable comparison; never resample it.
sheet = Image.new('RGB', (4 * 360, 280), '#111b28')
draw = ImageDraw.Draw(sheet)
for i, name in enumerate(('source', 'deblur', 'refinement', 'combined')):
    sheet.paste(images[name].crop((200, 200, 560, 440)), (i * 360, 40))
    draw.text((i * 360 + 10, 10), name, fill='white')
sheet.save(root / 'detail-comparison.png')
(root / 'detail-metrics.json').write_text(json.dumps(errors, indent=2), encoding='utf-8')
print('Deblur/refinement/combined exports reduce error against the known sharp reference; native preview equals export. MSE: ' + json.dumps(errors))
