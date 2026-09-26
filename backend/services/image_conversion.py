"""Local image conversion with separate outputs and internal-only metadata."""
import hashlib
import io
import json
import re
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
from config import settings
from services import image_vault, session_store

ROOT = settings.data_dir / "artifacts" / "conversions"
FORMATS = {"png": ("PNG", "image/png"), "jpg": ("JPEG", "image/jpeg"), "webp": ("WEBP", "image/webp"), "bmp": ("BMP", "image/bmp"), "tiff": ("TIFF", "image/tiff")}
MAX_BYTES = 20 * 1024 * 1024


def conversion_target(text):
    text = re.sub(r"```[\s\S]*?```", "", text).strip().lower()
    if re.search(r"\b(how|explain|don't|do not)\b", text): return None
    if not re.search(r"\b(convert|save|export|turn|change)\b", text): return None
    match = re.search(r"\b(?:to|as|into)\s+(?:(?:an?|the)\s+)?\.?(png|jpe?g|webp|bmp|tiff?)\b", text)
    return {"jpeg": "jpg", "tif": "tiff"}.get(match[1], match[1]) if match else None


def convert(raw, name, target, quality=92, session_id=None):
    if target not in FORMATS: raise ValueError("Choose PNG, JPG, WebP, BMP, or TIFF.")
    if not raw or len(raw) > MAX_BYTES: raise ValueError("Choose an image up to 20 MB.")
    digest = hashlib.sha256(raw).hexdigest(); image_vault.require_public(digest)
    try:
        with Image.open(io.BytesIO(raw)) as original:
            if original.width * original.height > 24_000_000: raise ValueError("Choose an image up to 24 megapixels.")
            if getattr(original, "n_frames", 1) != 1: raise ValueError("Animated and multipage files are not supported yet. Choose a still image.")
            image = ImageOps.exif_transpose(original).convert("RGBA")
            if target in ("jpg", "bmp"):
                background = Image.new("RGB", image.size, "white"); background.paste(image, mask=image.getchannel("A")); image = background
            output = io.BytesIO(); options = {"quality": quality} if target in ("jpg", "webp") else {}
            image.save(output, format=FORMATS[target][0], **options)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("This file could not be decoded as a supported image.") from exc
    name = re.sub(r"[^\w .-]", "_", Path(name.replace("\\", "/")).stem)[:90].strip(" .") or "image"
    if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])", name): name = "image-" + name
    ident = uuid.uuid4().hex
    ROOT.mkdir(parents=True, exist_ok=True)
    data = output.getvalue()
    image_vault.require_public(hashlib.sha256(data).hexdigest())
    destination = ROOT / f"{ident}.{target}"
    destination.write_bytes(data)
    result = {"id": ident, "kind": "converted-image", "name": name + "." + target, "format": target, "size": len(data), "width": image.width, "height": image.height}
    (ROOT / f"{ident}.json").write_text(json.dumps({**result, "source_hash": digest, "session_id": session_id}), encoding="utf-8")
    return result


def read(ident):
    if not re.fullmatch(r"[a-f0-9]{32}", ident): raise FileNotFoundError("Converted file not found.")
    meta = ROOT / f"{ident}.json"
    if meta.is_symlink(): raise FileNotFoundError("Converted file not found.")
    try: value = json.loads(meta.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc: raise FileNotFoundError("Converted file not found.") from exc
    if value.get("session_id") and not session_store.get_session(value["session_id"]): raise FileNotFoundError("Restore the source chat to download this file.")
    image_vault.require_public(value["source_hash"])
    target = value["format"]
    if target not in FORMATS: raise FileNotFoundError("Converted file not found.")
    file = ROOT / f"{ident}.{target}"
    if not file.is_file() or file.is_symlink() or file.resolve().parent != ROOT.resolve(): raise FileNotFoundError("Converted file not found.")
    image_vault.guard_path(file)
    return value, file


def convert_chat(session_id, prompt, target):
    from services.chat_documents import image_inventory
    inventory = list(image_inventory(session_id).values())
    if not inventory: raise ValueError("Attach an image to this chat before requesting conversion.")
    matches = [item for item in inventory if item["name"].lower() in prompt.lower()]
    if len(matches) == 1: chosen = matches[0]
    elif len(inventory) == 1 or re.search(r"\b(this|last|latest)\b", prompt, re.I): chosen = inventory[-1]
    else: raise ValueError("Name the image to convert, or request conversion of the latest image.")
    found = session_store.get_session_image_by_id(session_id, chosen["message_id"], chosen["image_id"])
    if not found: raise ValueError("The attached image is unavailable.")
    return convert(found[0], chosen["name"], target, session_id=session_id)
