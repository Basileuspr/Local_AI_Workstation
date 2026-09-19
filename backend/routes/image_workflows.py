"""Revision-checked workflows, queued execution, cancellation and reviewed results."""

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, Path
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

from services.image_workflows import providers, store, runner, exports
from services.image_workflows.contracts import CreateRequest, RevisionRequest, UpdateRequest, AcceptOutputRequest
from services.image_workflows.contracts import DeleteWorkflowRequest, DeleteWorkflowsRequest
from services.image_workflows import deletion, scenes
from services.image_workflows.contracts import ScenePatchRequest, SceneFrameRequest, SceneIdentityRequest
from services.image_vault import PinError

router = APIRouter(prefix="/image-workflows", tags=["image-workflows"])


@router.on_event("startup")
async def recover_runs():
    await run_in_threadpool(runner.manager.recover)


@router.on_event("shutdown")
async def stop_runs():
    await runner.manager.shutdown()


def call(function, *args):
    try:
        return function(*args)
    except store.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except store.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except PinError as exc:
        raise HTTPException(423, "Enter your Locked Images PIN to remove encrypted workflow associations.") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except OSError as exc:
        raise HTTPException(500, "Workflow storage failed. Existing records have not been reset.") from exc


@router.get("/capabilities")
def capabilities():
    return providers.catalog()


@router.get("/images")
def images():
    return call(exports.gallery)


@router.get("")
def list_workflows():
    return call(store.list_workflows)


@router.post("", status_code=201)
def create(request: CreateRequest):
    return call(store.create, request.name, request.mode)


def delete_records(records, authorization):
    try:
        return call(deletion.delete_many, records, (authorization or "").removeprefix("Bearer "))
    except HTTPException as error:
        if error.status_code == 500:
            error.detail = "Workflow cleanup did not finish. Some associations may already be detached. Reload the workflow list and retry deletion."
        raise


@router.post("/delete")
def delete_workflows(request: DeleteWorkflowsRequest, authorization: str | None = Header(default=None)):
    return delete_records(request.workflows, authorization)


@router.delete("/{workflow_id}")
def delete_workflow(request: RevisionRequest, workflow_id: str = Path(pattern=r"^[0-9a-f]{32}$"), authorization: str | None = Header(default=None)):
    return delete_records([DeleteWorkflowRequest(id=workflow_id, revision=request.revision)], authorization)


@router.get("/{workflow_id}")
def get(workflow_id: str):
    return call(store.get, workflow_id)


@router.put("/{workflow_id}")
def update(workflow_id: str, request: UpdateRequest):
    return call(store.update, workflow_id, request)


@router.patch("/{workflow_id}/scene")
def patch_scene(workflow_id: str, request: ScenePatchRequest):
    return call(scenes.patch, workflow_id, request)


@router.get("/{workflow_id}/scene/frames")
def scene_frames(workflow_id: str):
    return call(scenes.frames, workflow_id)


@router.post("/{workflow_id}/scene/frame")
def choose_scene_frame(workflow_id: str, request: SceneFrameRequest):
    return call(scenes.choose_frame, workflow_id, request)


@router.post("/{workflow_id}/scene/identity")
def scene_identity(workflow_id: str, request: SceneIdentityRequest):
    return call(scenes.attach_identity, workflow_id, request)


@router.post("/{workflow_id}/assets", status_code=201)
async def upload(workflow_id: str, revision: int = Form(..., ge=1), file: UploadFile = File(...)):
    try:
        content = await file.read(store.MAX_UPLOAD_BYTES + 1)
        if len(content) > store.MAX_UPLOAD_BYTES:
            raise HTTPException(413, "Image exceeds the 20 MiB upload limit.")
        return await run_in_threadpool(call, store.add_asset, workflow_id, revision, file.filename or "image", content)
    finally:
        await file.close()


@router.get("/{workflow_id}/assets/{asset_id}")
def asset(workflow_id: str, asset_id: str):
    path, metadata = call(store.asset_path, workflow_id, asset_id)
    return FileResponse(path, media_type=metadata.media_type, headers={"X-Content-Type-Options": "nosniff"})


@router.post("/{workflow_id}/preflight")
def validate(workflow_id: str, request: RevisionRequest):
    return call(runner.validate, workflow_id, request.revision)


@router.post("/{workflow_id}/jobs", status_code=201)
def prepare(workflow_id: str, request: RevisionRequest):
    return call(runner.prepare, workflow_id, request.revision)


@router.get("/{workflow_id}/jobs")
def jobs(workflow_id: str):
    return {"jobs": call(runner.list_jobs, workflow_id)}


@router.get("/{workflow_id}/jobs/{job_id}")
def job(workflow_id: str, job_id: str):
    return call(store.get_job, workflow_id, job_id)


@router.post("/{workflow_id}/branch", status_code=201)
def branch(workflow_id: str, request: RevisionRequest):
    return call(store.branch, workflow_id, request.revision)


@router.post("/{workflow_id}/execute")
async def execute(workflow_id: str, request: RevisionRequest):
    try:
        return await runner.manager.start(workflow_id, request.revision)
    except store.NotFound as exc:
        raise HTTPException(404, str(exc)) from exc
    except store.Conflict as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/{workflow_id}/jobs/{job_id}/run")
def run_state(workflow_id: str, job_id: str):
    return call(runner.read_run, workflow_id, job_id)


@router.post("/{workflow_id}/jobs/{job_id}/stop")
async def stop(workflow_id: str, job_id: str):
    call(runner.read_run, workflow_id, job_id)
    return await runner.manager.cancel(workflow_id, job_id)


@router.get("/{workflow_id}/jobs/{job_id}/outputs/{output_id}")
def output(workflow_id: str, job_id: str, output_id: str):
    path, _ = call(runner.output_path, workflow_id, job_id, output_id)
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})


@router.post("/{workflow_id}/jobs/{job_id}/accept")
def accept(workflow_id: str, job_id: str, request: AcceptOutputRequest):
    return call(runner.accept_output, workflow_id, job_id, request.output_id, request.revision)


@router.get("/{workflow_id}/jobs/{job_id}/download")
def download(workflow_id: str, job_id: str):
    stream, name = call(exports.archive, workflow_id, job_id)
    def chunks():
        try:
            while chunk := stream.read(256 * 1024):
                yield chunk
        finally:
            stream.close()
    return StreamingResponse(chunks(), media_type="application/zip", background=BackgroundTask(stream.close), headers={
        "Content-Disposition": f'attachment; filename="{name}"', "Cache-Control": "no-store",
        "Access-Control-Expose-Headers": "Content-Disposition"})


@router.post("/{workflow_id}/jobs/{job_id}/stitched/{layout}")
def stitch(workflow_id: str, job_id: str, layout: str):
    return call(exports.stitch, workflow_id, job_id, layout)


@router.get("/{workflow_id}/jobs/{job_id}/stitched/{layout}")
def stitched(workflow_id: str, job_id: str, layout: str, download: bool = False):
    path, metadata = call(exports.stitched_path, workflow_id, job_id, layout)
    return FileResponse(path, media_type="image/png", filename=metadata["name"] if download else None,
                        headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                                 "Access-Control-Expose-Headers": "Content-Disposition"})


@router.post("/{workflow_id}/jobs/{job_id}/stitched/{layout}/accept")
def accept_stitched(workflow_id: str, job_id: str, layout: str, request: RevisionRequest):
    return call(exports.accept_stitched, workflow_id, job_id, layout, request.revision)
