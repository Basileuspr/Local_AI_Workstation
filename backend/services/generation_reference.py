"""Validated original images for Generate's close-variation mode."""
import hashlib
import io

from PIL import Image, ImageOps

from services import image_store, image_vault
from services.image_workflows.store import MAX_UPLOAD_BYTES, _inspect_image
from services.image_generation_cache import PreparationCache

preparation_cache = PreparationCache(max_entries=8)


def store_reference(name, content):
    asset = _inspect_image(name, content)
    image_vault.require_public(asset.id)
    return {"reference": image_store.put_bytes(content), "name": asset.name,
            "width": asset.width, "height": asset.height, "media_type": asset.media_type}


def reference_bytes(reference):
    if not image_store.is_reference(reference):
        raise ValueError("Choose a valid reference image.")
    stored = image_store.get_bytes(reference)
    if stored is None:
        raise ValueError("Reference image is missing or locked. Upload it again or unlock it first.")
    content, _ = stored
    if len(content) > MAX_UPLOAD_BYTES or hashlib.sha256(content).hexdigest() != reference[5:]:
        raise ValueError("Reference image changed or exceeds the 20 MiB limit.")
    return content


def prepare_reference(reference, width, height, fit):
    # Re-read and verify the source, including vault access, on every hit.
    try:
        content = reference_bytes(reference)
    except ValueError:
        preparation_cache.clear()
        raise
    key = (reference, width, height, fit)
    cached = preparation_cache.get(key, lambda image: image.copy())
    if cached is not None:
        return cached
    prepared = _prepare_reference_content(content, width, height, fit)
    # Pillow's RGB core uses four bytes per pixel, despite three-byte exports.
    preparation_cache.put(key, prepared, prepared.width * prepared.height * 4, lambda image: image.copy())
    return prepared


def _prepare_reference_content(content, width, height, fit):
    _inspect_image("reference", content)
    with Image.open(io.BytesIO(content)) as original:
        oriented = ImageOps.exif_transpose(original).convert("RGBA")
        image = Image.alpha_composite(Image.new("RGBA", oriented.size, "white"), oriented).convert("RGB")
    if fit == "crop":
        return ImageOps.fit(image, (width, height), Image.Resampling.LANCZOS)
    if fit == "edge":
        # Preserve the complete source and extend its border pixels into padding.
        # White bars can otherwise become new scene content during denoising.
        scaled = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
        x, y = (width - scaled.width) // 2, (height - scaled.height) // 2
        result = Image.new("RGB", (width, height))
        columns = [(0, 1, 0, x), (0, scaled.width, x, scaled.width),
                   (scaled.width - 1, scaled.width, x + scaled.width, width - x - scaled.width)]
        rows = [(0, 1, 0, y), (0, scaled.height, y, scaled.height),
                (scaled.height - 1, scaled.height, y + scaled.height, height - y - scaled.height)]
        for left, right, dx, dw in columns:
            for top, bottom, dy, dh in rows:
                if dw and dh:
                    result.paste(scaled.crop((left, top, right, bottom)).resize((dw, dh), Image.Resampling.NEAREST), (dx, dy))
        return result
    if fit != "contain":
        raise ValueError("Choose Fit whole image, Extend edges, or Crop to fill.")
    return ImageOps.pad(image, (width, height), Image.Resampling.LANCZOS, color="white")
