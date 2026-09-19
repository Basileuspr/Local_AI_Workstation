"""Deterministic preflight; deliberately no inference, model discovery, or I/O."""

from .contracts import Workflow


def preflight(workflow: Workflow) -> dict:
    issues = []

    def issue(code, message, stage_id=None):
        issues.append({"code": code, "message": message, "stage_id": stage_id})

    if not workflow.stages:
        issue("stages_required", "Add at least one processing stage.")
    assets = {asset.id: asset for asset in workflow.assets}
    earlier_images = set()
    plan = []
    for number, stage in enumerate(workflow.stages, 1):
        source_asset = None
        if stage.operation == "txt2img":
            if stage.source is not None:
                issue("source_unsupported", f"Stage {number}: text-to-image does not use a source.", stage.id)
        elif stage.source is None:
            issue("source_required", f"Stage {number}: choose a source image or an earlier image output.", stage.id)
        elif stage.source.kind == "asset":
            source_asset = assets.get(stage.source.id)
            if source_asset is None:
                issue("source_invalid", f"Stage {number}: source is not an owned workflow asset.", stage.id)
        elif stage.source.id not in earlier_images:
            issue("source_invalid", f"Stage {number}: source must be an earlier image-producing stage, not text or a future stage.", stage.id)

        for field, required, code in (
            (stage.mask_asset_id, stage.operation == "inpaint", "mask"),
            (stage.control_asset_id, stage.operation == "controlnet", "control"),
        ):
            if required and not field:
                issue(f"{code}_required", f"Stage {number}: choose a {code} image.", stage.id)
            if field and field not in assets:
                issue(f"{code}_invalid", f"Stage {number}: {code} image is missing.", stage.id)
        if stage.operation == "inpaint" and source_asset and stage.mask_asset_id in assets:
            mask = assets[stage.mask_asset_id]
            if (mask.width, mask.height) != (source_asset.width, source_asset.height):
                issue("mask_size_mismatch", f"Stage {number}: mask and source dimensions must match.", stage.id)
        if stage.operation == "multi_reference" and not stage.reference_asset_ids:
            issue("references_required", f"Stage {number}: add at least one reference image.", stage.id)
        if any(ref not in assets for ref in stage.reference_asset_ids):
            issue("references_invalid", f"Stage {number}: a reference image is missing.", stage.id)
        if stage.operation != "describe":
            earlier_images.add(stage.id)
        plan.append({"number": number, **stage.model_dump(), "output_type": "text" if stage.operation == "describe" else "image"})
    return {"revision": workflow.revision, "ready": not issues, "inputs_valid": not issues, "issues": issues, "plan": plan}
