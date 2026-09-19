"""Delete owned workflow files and detach independently saved copies globally."""
import copy
import json
import shutil
from pathlib import Path

from . import store, runner
from services import image_library as library, image_vault as vault
from services.request_queue import queue, TERMINAL


def linked(origin, ids):
    return isinstance(origin, dict) and origin.get("workflow_id") in ids


def confined(path, root):
    root, path = Path(root).absolute(), Path(path).absolute()
    if not path.is_relative_to(root) or not path.resolve().is_relative_to(root.resolve()):
        raise ValueError("Deletion target escapes app storage")
    for part in [path, *path.parents]:
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError("Deletion targets cannot contain links or junctions")
        if part == root: break
    return path


def detach_workflow(record, ids):
    changed = False
    if linked(record.get("parent"), ids): record["parent"] = None; changed = True
    scene = record.get("scene")
    if scene and linked(scene.get("parent_frame"), ids):
        scene["parent_frame"] = None
        changed = True
    for asset in record.get("assets", []):
        if linked(asset.get("origin"), ids): asset["origin"] = None; changed = True
    return changed


def delete_many(requests, token=None):
    ids = {request.id for request in requests}
    if not ids or len(ids) != len(requests): raise ValueError("Choose distinct workflows to delete")
    # Match the vault-to-library lock order used when restoring private copies.
    with vault.LOCK, library.LOCK, store._lock:
        workflows = []
        for request in requests:
            if not store._directory(request.id).exists(): continue  # Idempotent retry after partial batch cleanup.
            workflow = store.get(request.id, allow_deleting=True)
            store._check_revision(workflow, request.revision)
            workflows.append(workflow)
        if any(workflow_id in ids for workflow_id, _ in runner.manager.active):
            raise store.Conflict("Finish or stop the selected workflow runs before deleting them")
        with queue._lock:
            if any(job.kind == "workflow" and job.status not in TERMINAL for job in queue.jobs):
                raise store.Conflict("Finish or stop queued workflow runs before deleting workflows")

        # Validate every owned tree, including nested entries, before mutation.
        roots = [store._directory(workflow.id) for workflow in workflows]
        deleted_jobs = {path.name for root in roots for path in (root / "jobs").glob("*") if path.is_dir()}
        for root in roots:
            for target in root.rglob("*"): store.confined(target)
        confined(library.ROOT / "index.json", library.ROOT)
        confined(vault.ROOT / "index.enc", vault.ROOT)
        index = copy.deepcopy(library.read_index())
        policy = vault.config()
        key = vault.key_for(token) if policy and policy["locks"] else None
        private = vault.private_index(key) if key else []

        affected_folders = set()
        saved_count = 0
        for image in [*index["images"], *private]:
            if linked(image.get("origin"), ids):
                affected_folders.update(image.get("folder_ids", []))
                if image["origin"].get("folder_id"): affected_folders.add(image["origin"]["folder_id"])
                image["origin"] = {"kind": "saved"}
                image["_detached_workflow"] = True
                saved_count += 1
        shared_folders = set()
        for image in [*index["images"], *private]:
            if not image.get("_detached_workflow"):
                shared_folders.update(image.get("folder_ids", []))
                if (image.get("origin") or {}).get("folder_id"): shared_folders.add(image["origin"]["folder_id"])
        removed_folders = affected_folders - shared_folders
        removed_folders.update(folder["id"] for folder in index["folders"] if linked(folder, ids) and folder["id"] not in shared_folders)
        index["folders"] = [folder for folder in index["folders"] if folder["id"] not in removed_folders]
        for folder in index["folders"]:
            if linked(folder, ids): folder.pop("workflow_id", None)
        for image in [*index["images"], *private]:
            image.pop("_detached_workflow", None)
            if "folder_ids" in image: image["folder_ids"] = [value for value in image["folder_ids"] if value not in removed_folders]

        updates = []
        for path in store.ROOT.glob("*/workflow.json"):
            if path.parent.name in ids: continue
            record = store.get(path.parent.name, allow_deleting=True).model_dump()
            if detach_workflow(record, ids):
                record.update(revision=record["revision"] + 1, updated_at=store._now())
                updates.append((path, record))
            # Remove lineage in preparation history as well as editable drafts.
            for snapshot_path in path.parent.glob("jobs/*/job.json"):
                store.confined(snapshot_path)
                snapshot = store.get_job(path.parent.name, snapshot_path.parent.name, allow_deleting=True)
                if detach_workflow(snapshot["snapshot"], ids): updates.append((snapshot_path, snapshot))

        # Each metadata write is atomic. Keep workflow.json until all cleanup
        # finishes, so an I/O failure leaves a visible workflow the user can retry.
        for workflow in workflows:
            store._write(store._directory(workflow.id) / "deletion.json", {"id": workflow.id, "revision": workflow.revision, "name": workflow.name, "created_at": workflow.created_at})
        for path, record in updates: store._write(path, record)
        library.save_index(index)
        if key: vault.save_private(key, private)
        with queue._lock:
            queue.jobs = [job for job in queue.jobs if not (job.kind == "workflow" and job.request_id in deleted_jobs)]
        for root in roots:
            for target in list(root.iterdir()):
                if target.name in {"workflow.json", "deletion.json"}: continue
                target = store.confined(target)
                if target.is_dir(): shutil.rmtree(target)
                else: target.unlink()
        for root in roots:
            (root / "workflow.json").unlink(missing_ok=True)
            (root / "deletion.json").unlink()
            root.rmdir()
        return {"deleted": sorted(ids), "detached_images": saved_count, "removed_folders": sorted(removed_folders),
                "updated_workflows": [{"id": record["id"], "revision": record["revision"]} for path, record in updates if path.name == "workflow.json"]}
