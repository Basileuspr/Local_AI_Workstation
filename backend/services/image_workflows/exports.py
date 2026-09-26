"""Stage-ordered downloads and a gallery over existing, owned workflow outputs."""
import hashlib
import io
import json
import math
import re
import tempfile
import threading
import zipfile

from PIL import Image, ImageDraw, ImageOps, PngImagePlugin

from . import runner, store

LAYOUTS = {"grid", "row", "column"}
_export_lock = threading.RLock()


def completed(workflow_id, job_id):
    record = runner.read_run(workflow_id, job_id)
    if record["status"] in runner.ACTIVE:
        raise store.Conflict("Wait for the run to stop before exporting committed results")
    snapshot = store.get_job(workflow_id, job_id)
    stages = {stage["id"]: i for i, stage in enumerate(snapshot["snapshot"]["stages"], 1)}
    if any(output["stage_id"] not in stages for output in record["outputs"]):
        raise store.Conflict("An output does not belong to this run's saved stages")
    outputs = sorted(record["outputs"], key=lambda output: stages[output["stage_id"]])
    from services.image_vault import require_public
    for output in outputs: require_public(output["sha256"])
    return record, snapshot, [{**output, "stage_number": stages[output["stage_id"]]} for output in outputs]


def filename(snapshot, suffix):
    name = re.sub(r"[^A-Za-z0-9_-]+", "-", snapshot["snapshot"]["name"]).strip("-_")[:60] or "workflow"
    return f"{name}-{snapshot['id'][:8]}-{suffix}"


def archive(workflow_id, job_id):
    record, snapshot, outputs = completed(workflow_id, job_id)
    if not outputs:
        raise ValueError("This run has no image outputs to save")
    stream = tempfile.SpooledTemporaryFile(max_size=8 * 1024 * 1024)
    try:
        with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_STORED) as bundle:
            for output in outputs:
                path, _ = runner.output_path(workflow_id, job_id, output["id"])
                bundle.write(path, f"stage-{output['stage_number']:02d}-{output['id'][:8]}.png")
        stream.seek(0)
        return stream, filename(snapshot, "images.zip")
    except BaseException:
        stream.close()
        raise


def _paths(workflow_id, job_id, layout):
    if layout not in LAYOUTS:
        raise ValueError("Choose grid, row, or column")
    base = runner._job_dir(workflow_id, job_id) / "artifacts"
    return (store.confined(base / f"stitched-v1-{layout}.png"),
            store.confined(base / f"stitched-v1-{layout}.json"))


def _saved(workflow_id, job_id, layout, *, verify=True):
    path, metadata = _paths(workflow_id, job_id, layout)
    if not path.is_file() or not metadata.is_file():
        raise store.NotFound("Create this stitched image first")
    try:
        result = json.loads(metadata.read_bytes())
        if result["layout"] != layout or not all(key in result for key in ("name", "width", "height", "sha256")):
            raise ValueError("Invalid stitched image metadata")
        from services.image_vault import require_public
        require_public(result["sha256"])
        if verify and hashlib.sha256(path.read_bytes()).hexdigest() != result["sha256"]:
            raise ValueError("Hash mismatch")
        return path, result
    except (ValueError, KeyError, TypeError) as exc:
        raise store.Conflict("Stitched image is unreadable or changed on disk") from exc


def stitched_path(workflow_id, job_id, layout):
    completed(workflow_id, job_id)
    return _saved(workflow_id, job_id, layout)


def _canvas_size(outputs, layout):
    columns = len(outputs) if layout == "row" else 1 if layout == "column" else math.ceil(math.sqrt(len(outputs)))
    rows = math.ceil(len(outputs) / columns)
    width, height = max(o["width"] for o in outputs), max(o["height"] for o in outputs)
    scale = min(1, 2048 / max(width, height))
    while True:
        cell_width, cell_height = max(1, int(width * scale)), max(1, int(height * scale))
        size = (columns * (cell_width + 8) + 8, rows * (cell_height + 32) + 8)
        if size[0] * size[1] <= store.MAX_IMAGE_PIXELS and max(size) <= 16384:
            return columns, cell_width, cell_height, size
        scale *= .9


def stitch(workflow_id, job_id, layout):
    path, metadata_path = _paths(workflow_id, job_id, layout)
    with _export_lock:
        record, snapshot, outputs = completed(workflow_id, job_id)
        if not outputs:
            raise ValueError("This run has no image outputs to stitch")
        # Always check the original files, including when returning a cached composite.
        paths = [runner.output_path(workflow_id, job_id, output["id"])[0] for output in outputs]
        if path.exists() and metadata_path.exists():
            return _saved(workflow_id, job_id, layout)[1]
        columns, width, height, size = _canvas_size(outputs, layout)
        canvas = Image.new("RGB", size, "#171b24")
        try:
            draw = ImageDraw.Draw(canvas)
            for i, (output, source) in enumerate(zip(outputs, paths)):
                x, y = 8 + (i % columns) * (width + 8), 8 + (i // columns) * (height + 32)
                with Image.open(source) as original:
                    tile = ImageOps.exif_transpose(original).convert("RGBA")
                    try:
                        tile.thumbnail((width, height), Image.Resampling.LANCZOS)
                        canvas.paste(tile, (x + (width - tile.width) // 2, y + (height - tile.height) // 2), tile)
                    finally:
                        tile.close()
                draw.text((x + 4, y + height + 5), f"Stage {output['stage_number']}", fill="white")
            provenance = {"workflow_id": workflow_id, "job_id": job_id, "layout": layout,
                          "seed": record["seed"], "outputs": outputs}
            info = PngImagePlugin.PngInfo()
            info.add_text("workflow", json.dumps(provenance))
            while True:
                buffer = io.BytesIO()
                canvas.save(buffer, "PNG", pnginfo=info)
                content = buffer.getvalue()
                if len(content) <= store.MAX_UPLOAD_BYTES:
                    break
                resized = canvas.resize((max(1, int(canvas.width * .8)), max(1, int(canvas.height * .8))), Image.Resampling.LANCZOS)
                canvas.close()
                canvas = resized
            metadata = {"layout": layout, "width": canvas.width, "height": canvas.height,
                        "sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content),
                        "name": filename(snapshot, f"stitched-{layout}.png"), "created_at": store._now()}
            store._atomic_bytes(path, content)
            store._write(metadata_path, metadata)
            return metadata
        finally:
            canvas.close()


def accept_stitched(workflow_id, job_id, layout, revision):
    path, metadata = stitched_path(workflow_id, job_id, layout)
    with store._lock:
        workflow = store.get(workflow_id)
        store._check_revision(workflow, revision)
        known = {asset.id for asset in workflow.assets}
        workflow = store.add_asset(workflow_id, revision, metadata["name"], path.read_bytes())
        if metadata["sha256"] not in known:
            asset = next(asset for asset in workflow.assets if asset.id == metadata["sha256"])
            asset.origin = {"workflow_id": workflow_id, "job_id": job_id, "kind": "stitched", "layout": layout}
            store._write(store._directory(workflow_id) / "workflow.json", workflow.model_dump())
        return workflow


def gallery():
    """No migration or extra image copies: existing completed runs appear immediately."""
    runs, warnings = [], []
    for path in store.ROOT.glob("*/jobs/*/run.json"):
        workflow_id, job_id = path.parents[2].name, path.parent.name
        try:
            if runner.read_run(workflow_id, job_id)["status"] in runner.ACTIVE:
                continue
            record, snapshot, outputs = completed(workflow_id, job_id)
            if not outputs:
                continue
            base = f"/image-workflows/{workflow_id}/jobs/{job_id}"
            composites = []
            for layout in sorted(LAYOUTS):
                _, metadata_path = _paths(workflow_id, job_id, layout)
                if metadata_path.exists():
                    try:
                        # Listing stays lightweight; serving/accepting verifies the PNG hash.
                        _, metadata = _saved(workflow_id, job_id, layout, verify=False)
                        composites.append({**metadata, "url": f"{base}/stitched/{layout}"})
                    except (OSError, ValueError, store.Conflict, store.NotFound):
                        warnings.append(f"A stitched image in run {job_id[:8]} is unavailable; its files were preserved.")
            runs.append({"id": job_id, "workflow_id": workflow_id, "workflow_name": snapshot["snapshot"]["name"],
                         "created_at": record["created_at"], "status": record["status"],
                         "outputs": [{**output, "url": f"{base}/outputs/{output['id']}"} for output in outputs],
                         "composites": composites})
        except (OSError, ValueError, KeyError, store.Conflict, store.NotFound):
            warnings.append(f"Workflow run {job_id[:8]} could not be read; its files were preserved.")
    return {"runs": sorted(runs, key=lambda run: run["created_at"], reverse=True), "warnings": warnings}
