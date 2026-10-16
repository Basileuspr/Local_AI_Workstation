"""Ordered gallery composites using existing source ownership and layout rules."""
import base64
import io
import threading

from PIL import Image, ImageOps

from services import image_library as library, image_vault as vault
from services.image_manager_layout import regular_sheet
from services.image_workflows import store

LOCK = threading.Lock()
MAX_SOURCE_BYTES = 128 * 1024 * 1024
BACKGROUNDS = {"dark": "#171b24", "white": "#ffffff", "transparent": (0, 0, 0, 0)}


def compose(sources, options, *, preview=False):
    # Bound concurrent CPU/memory use; no model or GPU work is involved.
    with LOCK:
        inputs, total = [], 0
        for number, source in enumerate(sources, 1):
            try:
                data, _ = library.source_bytes(source)
                total += len(data)
                if total > MAX_SOURCE_BYTES:
                    raise ValueError("Choose fewer frames: source images exceed 128 MiB")
                info = library.inspect(data, "frame.png")
                vault.require_public(info["sha256"])
                with Image.open(io.BytesIO(data)) as original:
                    width, height = original.size
                    if original.getexif().get(274) in {5, 6, 7, 8}:
                        width, height = height, width
                inputs.append({"id": number, "data": data, "width": width, "height": height,
                               "sha256": info["sha256"]})
            except vault.LockedImageError:
                raise
            except (ValueError, KeyError, TypeError, OSError, store.NotFound, store.Conflict) as error:
                raise ValueError(f"Frame {number}: {error}") from error

        width = max(item["width"] for item in inputs)
        height = max(item["height"] for item in inputs)
        scale = min(1, options["tile_size"] / max(width, height))
        sheet = regular_sheet(inputs, {
            "layout": {"row": "horizontal", "column": "vertical", "grid": "grid"}[options["layout"]],
            "width": max(1, int(width * scale)), "height": max(1, int(height * scale)),
            "columns": options["columns"], "gap": options["gap"], "size_mode": "fit", "format": "png",
        }, {"max_stitched_side": 16384, "fit_canvas_side": 16384, "fit_canvas_pixels": library.MAX_PIXELS})
        with Image.new("RGBA", (sheet["width"], sheet["height"]), BACKGROUNDS[options["background"]]) as canvas:
            for item, placement in zip(inputs, sheet["placements"]):
                with Image.open(io.BytesIO(item["data"])) as original:
                    with ImageOps.exif_transpose(original) as oriented:
                        with oriented.convert("RGBA") as tile:
                            tile.thumbnail((placement["width"], placement["height"]), Image.Resampling.LANCZOS)
                            canvas.alpha_composite(tile, (placement["x"] + (placement["width"] - tile.width) // 2,
                                                          placement["y"] + (placement["height"] - tile.height) // 2))
            # Recheck access after rendering; never publish an input that became locked.
            for item in inputs:
                vault.require_public(item["sha256"])
            if preview:
                canvas.thumbnail((1600, 1600), Image.Resampling.LANCZOS)
            buffer = io.BytesIO()
            canvas.save(buffer, "PNG")
            content = buffer.getvalue()
        result = {key: sheet[key] for key in ("width", "height", "columns", "rows", "reduced")}
        if preview:
            return {**result, "preview": "data:image/png;base64," + base64.b64encode(content).decode("ascii")}
        if len(content) > library.MAX_BYTES:
            raise ValueError("The stitched PNG exceeds 20 MiB. Reduce Frame size and try again.")
        return library.import_image(content, f"Stitched-{options['layout']}.png", {
            "kind": "stitch", "sources": sources, "source_hashes": [item["sha256"] for item in inputs],
            "options": options,
        })
