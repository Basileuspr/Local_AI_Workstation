"""Reproduce the companion's geometric install icons; requires existing Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "mobile" / "public"
for size in (192, 512):
    scale = size / 192
    image = Image.new("RGB", (size, size), "#101c26")
    draw = ImageDraw.Draw(image)
    def box(values):
        return tuple(round(value * scale) for value in values)
    draw.rounded_rectangle(box((38, 47, 154, 128)), radius=round(12 * scale), outline="#7ce4d0", width=round(8 * scale))
    for line in ((96, 128, 96, 146), (73, 149, 119, 149), (70, 74, 57, 85), (57, 85, 70, 96),
                 (122, 74, 135, 85), (135, 85, 122, 96), (105, 70, 87, 101)):
        draw.line(box(line), fill="#7ce4d0", width=round(7 * scale))
    image.save(root / f"icon-{size}.png")
