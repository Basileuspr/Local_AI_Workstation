"""Versioned records shared by storage, planning, and local runtime adapters."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from services.image_generation_limits import MAX_IMAGE_STEPS, MAX_IMAGE_GUIDANCE
from .scene_state import Scene, build_prompt, FrameRef

Id = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
AssetId = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Operation = Literal["describe", "txt2img", "img2img", "inpaint", "controlnet", "upscale", "multi_reference"]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class PromptSettings(Record):
    # Deliberately ONLY these five values; assets, providers and stages are not profiles.
    prompt: str = Field(default="", max_length=12000)
    negative_prompt: str = Field(default="", max_length=12000)
    seed: int = Field(default=-1, ge=-1, le=4294967295)
    steps: int = Field(default=30, ge=1, le=MAX_IMAGE_STEPS)
    guidance: float = Field(default=7, ge=0, le=MAX_IMAGE_GUIDANCE)


class Source(Record):
    kind: Literal["asset", "stage"]
    id: str

    @model_validator(mode="after")
    def valid_id(self):
        import re

        length = 64 if self.kind == "asset" else 32
        if not re.fullmatch(rf"[0-9a-f]{{{length}}}", self.id):
            raise ValueError("Invalid input reference")
        return self


class Stage(Record):
    id: Id
    operation: Operation
    source: Source | None = None
    source_mode: Literal["selected", "previous"] = "selected"
    lock_aspect_ratio: bool = True
    mask_asset_id: AssetId | None = None
    control_asset_id: AssetId | None = None
    reference_asset_ids: list[AssetId] = Field(default_factory=list, max_length=8)
    # Registered provider key, never a browser-supplied file path or download URL.
    provider_slot: str = Field(default="", max_length=100, pattern=r"^[a-zA-Z0-9_.-]*$")
    model_id: str = Field(default="", max_length=200)
    width: int = Field(default=512, ge=256, le=1024, multiple_of=8)
    height: int = Field(default=512, ge=256, le=1024, multiple_of=8)
    strength: float = Field(default=0.55, ge=0, le=1)
    control_scale: float = Field(default=1, ge=0, le=2)
    control_kind: Literal["edges", "depth", "pose", "other"] = "edges"
    upscale_factor: int = Field(default=2, ge=2, le=4)
    analysis_kind: Literal["description", "scene", "edit_guidance"] = "description"
    reference_roles: list[Annotated[str, Field(min_length=1, max_length=300)]] = Field(default_factory=list, max_length=8)


class CreateRequest(Record):
    name: str = Field(min_length=1, max_length=120)
    mode: Literal["stages", "scene"] = "stages"

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if not value.strip():
            raise ValueError("Name cannot be blank")
        return value.strip()


class Draft(CreateRequest):
    scene: Scene | None = None
    scene_notes: str = Field(default="", max_length=8000)
    prompt_settings: PromptSettings = Field(default_factory=PromptSettings)
    stages: list[Stage] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def compile_scene(self):
        if self.mode == "scene":
            self.scene = self.scene or Scene()
            scene = self.scene
            self.prompt_settings.prompt = build_prompt(scene.state)
            self.stages = [Stage(id="0" * 32, operation="img2img" if scene.source_asset_id else "txt2img",
                source=Source(kind="asset", id=scene.source_asset_id) if scene.source_asset_id else None,
                provider_slot="local-sdxl", model_id=scene.model_id, width=scene.width, height=scene.height,
                strength=scene.denoise, reference_asset_ids=scene.identity_asset_ids)]
        elif self.scene is not None:
            raise ValueError("Scene state requires iterative scene mode")
        if self.mode == "stages":
            previous = None
            for stage in self.stages:
                if stage.source_mode == "previous":
                    stage.source = Source(kind="stage", id=previous.id) if previous and stage.operation != "txt2img" else None
                if stage.operation != "describe":
                    previous = stage
        return self

    @field_validator("stages")
    @classmethod
    def unique_stages(cls, value):
        if len({stage.id for stage in value}) != len(value):
            raise ValueError("Stage IDs must be unique")
        return value


class RevisionRequest(Record):
    revision: int = Field(ge=1)


class DeleteWorkflowRequest(RevisionRequest):
    id: Id


class DeleteWorkflowsRequest(Record):
    workflows: list[DeleteWorkflowRequest] = Field(min_length=1, max_length=100)


class UpdateRequest(Draft):
    revision: int = Field(ge=1)


class Asset(Record):
    id: AssetId
    name: str
    suffix: Literal[".png", ".jpg", ".webp"]
    media_type: Literal["image/png", "image/jpeg", "image/webp"]
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    size_bytes: int = Field(gt=0)
    created_at: str
    origin: dict[str, str] | None = None


class Lineage(Record):
    workflow_id: Id
    revision: int = Field(ge=1)


class Workflow(Draft):
    schema_version: Literal[1] = 1
    id: Id
    revision: int = Field(ge=1)
    created_at: str
    updated_at: str
    assets: list[Asset] = Field(default_factory=list, max_length=100)
    parent: Lineage | None = None


class PreflightIssue(Record):
    code: str
    message: str
    stage_id: Id | None = None


class PlannedStage(Stage):
    number: int = Field(ge=1)
    output_type: Literal["image", "text"]


class PreflightReport(Record):
    revision: int = Field(ge=1)
    ready: bool
    inputs_valid: bool
    issues: list[PreflightIssue]
    plan: list[PlannedStage]


class SnapshotPaths(Record):
    outputs: str
    artifacts: str


class Snapshot(Record):
    schema_version: Literal[1] = 1
    id: Id
    workflow_id: Id
    created_at: str
    status: Literal["blocked", "prepared"]
    snapshot: Workflow
    preflight: PreflightReport
    outputs: list = Field(default_factory=list, max_length=0)
    paths: SnapshotPaths


class RunOutput(Record):
    id: Id
    stage_id: Id
    filename: str = Field(pattern=r"^outputs/[0-9a-f]{32}/[0-9a-f]{32}\.png$")
    sha256: AssetId
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class RunRecord(Record):
    schema_version: Literal[1] = 1
    id: Id
    workflow_id: Id
    request_id: Id
    status: Literal["queued", "running", "cancelling", "completed", "cancelled", "failed", "interrupted"]
    created_at: str
    updated_at: str
    seed: int = Field(ge=0, le=4294967295)
    stage_number: int = 0
    stage_count: int
    phase: str = "Waiting in Prompt Queue"
    step: int = 0
    total_steps: int = 0
    error: str | None = None
    outputs: list[RunOutput] = Field(default_factory=list, max_length=24)
    stage_results: list[dict] = Field(default_factory=list, max_length=24)
    accepted_output_ids: list[Id] = Field(default_factory=list, max_length=24)


class AcceptOutputRequest(RevisionRequest):
    output_id: Id


class ScenePatchRequest(RevisionRequest):
    changes: dict = Field(default_factory=dict, max_length=8)
    remove_objects: list[str] = Field(default_factory=list, max_length=24)


class SceneFrameRequest(RevisionRequest):
    frame: FrameRef
    action: Literal["continue", "restore", "branch"]


class SceneIdentityRequest(RevisionRequest):
    character_id: Id
