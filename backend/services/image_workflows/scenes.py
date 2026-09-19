"""Scene operations over owned workflow assets and immutable run snapshots."""
from . import store, runner
from .contracts import Draft, UpdateRequest, Workflow
from .scene_state import Scene, patch_state


def require_scene(workflow):
    if workflow.mode != "scene" or workflow.scene is None:
        raise ValueError("Choose an iterative scene")
    return workflow.scene


def save(workflow):
    return store.update(workflow.id, UpdateRequest.model_validate({
        key: value for key, value in workflow.model_dump().items() if key in UpdateRequest.model_fields}))


def patch(workflow_id, request):
    with store._lock:
        workflow = store.get(workflow_id)
        store._check_revision(workflow, request.revision)
        scene = require_scene(workflow)
        scene.state = patch_state(scene.state, request.changes, request.remove_objects)
        return save(workflow)


def frames(workflow_id):
    require_scene(store.get(workflow_id))
    result, warnings = [], []
    for job in runner.list_jobs(workflow_id):
        if not job["execution"]:
            continue
        run = runner.read_run(workflow_id, job["id"])
        if run["status"] in runner.ACTIVE:
            continue
        snapshot = store.get_job(workflow_id, job["id"])["snapshot"]
        scene = snapshot.get("scene")
        if not scene:
            continue
        for output in run["outputs"]:
            try:
                runner.output_path(workflow_id, job["id"], output["id"])
            except (ValueError, OSError, store.Conflict, store.NotFound):
                warnings.append(f"Frame in run {job['id'][:8]} is unavailable or private.")
                continue
            result.append({"frame": {"workflow_id": workflow_id, "job_id": job["id"], "output_id": output["id"]},
                "created_at": run["created_at"], "output": output, "scene": scene,
                "prompt_settings": snapshot["prompt_settings"], "seed": run["seed"], "status": run["status"],
                "operation": snapshot["stages"][0]["operation"], "stage_results": run["stage_results"]})
    return {"frames": result, "warnings": warnings}


def _add_copy(workflow, name, content, origin):
    from services.image_vault import require_public
    asset = store._inspect_image(name, content)
    require_public(asset.id)
    if asset.id not in {item.id for item in workflow.assets}:
        if len(workflow.assets) >= 100:
            raise ValueError("Workflow has 100 assets. Start a new scene to add more references.")
        asset.origin = origin
        store._atomic_bytes(store._directory(workflow.id) / "assets" / f"{asset.id}{asset.suffix}", content)
        workflow.assets.append(asset)
    return asset.id


def choose_frame(workflow_id, request):
    with store._lock:
        current = store.get(workflow_id)
        store._check_revision(current, request.revision)
        require_scene(current)
        ref = request.frame
        # Frame selection is scoped to this scene's history; branches copy inputs
        # at creation, so later parent deletion cannot break their generation.
        if ref.workflow_id != workflow_id:
            raise ValueError("Choose a frame from this scene's history")
        path, output = runner.output_path(ref.workflow_id, ref.job_id, ref.output_id)
        snapshot = Workflow.model_validate(store.get_job(ref.workflow_id, ref.job_id)["snapshot"])
        require_scene(snapshot)
        run = runner.read_run(ref.workflow_id, ref.job_id)
        draft = current.model_copy(deep=True)
        draft.scene = snapshot.scene.model_copy(deep=True)
        draft.prompt_settings = snapshot.prompt_settings.model_copy(deep=True)
        draft.prompt_settings.seed = run["seed"] if request.action == "restore" else -1
        if request.action == "branch":
            draft = store._create(Draft.model_validate({k: v for k, v in draft.model_dump().items() if k in Draft.model_fields}),
                assets=[a.model_copy(deep=True) for a in current.assets], parent={"workflow_id": current.id, "revision": current.revision})
            draft.name = f"Branch - {current.name}"[:120]
            for asset in draft.assets:
                source, _ = store.asset_path(current.id, asset.id)
                store._atomic_bytes(store._directory(draft.id) / "assets" / source.name, source.read_bytes())
        if request.action != "restore":
            draft.scene.source_asset_id = _add_copy(draft, f"Frame {ref.job_id[:8]}.png", path.read_bytes(),
                {"workflow_id": ref.workflow_id, "job_id": ref.job_id, "stage_id": output["stage_id"]})
            draft.scene.parent_frame = ref
        # Recompile derived prompt/stage fields; publish once after copies exist.
        values = draft.model_dump()
        if request.action != "branch":
            values.update(revision=current.revision + 1, updated_at=store._now())
        draft = Workflow.model_validate(values)
        store._write(store._directory(draft.id) / "workflow.json", draft.model_dump())
        return draft


def attach_identity(workflow_id, request):
    from services.faces import bank, store as faces
    bundle = bank.reference_bundle(request.character_id)
    primary = bundle["primary_reference"]
    if not primary:
        raise ValueError("Choose a primary reference in Character Face Bank first")
    entries = [primary, *bundle["additional_references"]][:8]
    # Read and validate every source before modifying the scene.
    copies = [(entry, faces.crop_path(entry["dataset_id"], entry["face_id"]).read_bytes()) for entry in entries]
    for _, content in copies:
        store._inspect_image("identity.png", content)
    with store._lock:
        workflow = store.get(workflow_id)
        store._check_revision(workflow, request.revision)
        scene = require_scene(workflow)
        ids = []
        for entry, content in copies:
            ids.append(_add_copy(workflow, f"{bundle['name']} reference.png", content, {
                "character_id": bundle["character_id"], "dataset_id": entry["dataset_id"], "face_id": entry["face_id"]}))
        scene.identity_asset_ids = list(dict.fromkeys(ids))
        scene.state.character.profile_id = bundle["character_id"]
        scene.state.character.name = bundle["name"]
        values = workflow.model_dump()
        values.update(revision=workflow.revision + 1, updated_at=store._now())
        workflow = Workflow.model_validate(values)
        store._write(store._directory(workflow.id) / "workflow.json", workflow.model_dump())
        return workflow
