"""Versioned visible scene state, partial updates, and deterministic prompts.

No inference or filesystem access belongs here. A future action planner can
propose the same bounded patches that the manual editor uses today.
"""
from copy import deepcopy
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(max_length=400)]
Id = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
AssetId = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Character(Record):
    profile_id: Id | None = None
    name: Text = ""
    appearance: Text = ""
    clothing: Text = ""
    accessories: Text = ""


class Environment(Record):
    location: Text = ""
    background: Text = ""


class Camera(Record):
    framing: Text = ""
    angle: Text = ""
    focal_length: Text = ""
    orientation: Text = ""
    position: Text = ""


class Lighting(Record):
    source: Text = ""
    direction: Text = ""
    intensity: Text = ""
    style: Text = ""


class Body(Record):
    stance: Text = ""
    left_arm: Text = ""
    right_arm: Text = ""
    left_hand: Text = ""
    right_hand: Text = ""
    wrist_rotation: Text = ""
    gaze: Text = ""
    orientation: Text = ""


class SceneObject(Record):
    id: Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")]
    name: Text = ""
    appearance: Text = ""
    position: Text = ""
    orientation: Text = ""
    contact: Text = ""
    progression: Text = ""


class SceneState(Record):
    schema_version: Literal[1] = 1
    character: Character = Field(default_factory=Character)
    environment: Environment = Field(default_factory=Environment)
    camera: Camera = Field(default_factory=Camera)
    lighting: Lighting = Field(default_factory=Lighting)
    body: Body = Field(default_factory=Body)
    objects: list[SceneObject] = Field(default_factory=list, max_length=24)
    current_action: Text = ""
    visual_style: Text = ""

    @model_validator(mode="after")
    def unique_objects(self):
        if len({obj.id for obj in self.objects}) != len(self.objects):
            raise ValueError("Scene object IDs must be unique")
        return self


class FrameRef(Record):
    workflow_id: Id
    job_id: Id
    output_id: Id


class Scene(Record):
    state: SceneState = Field(default_factory=SceneState)
    source_asset_id: AssetId | None = None
    parent_frame: FrameRef | None = None
    identity_asset_ids: list[AssetId] = Field(default_factory=list, max_length=8)
    model_id: str = Field(default="", max_length=200)
    width: int = Field(default=512, ge=256, le=1024, multiple_of=8)
    height: int = Field(default=512, ge=256, le=1024, multiple_of=8)
    denoise: float = Field(default=0.25, ge=0, le=1)


def patch_state(state: SceneState, changes: dict, remove_objects=()) -> SceneState:
    """Merge fields; object patches address stable IDs and never replace peers.

    Empty strings explicitly clear text. Object removal is a separate explicit
    list, so a partial planner/manual update cannot accidentally erase objects.
    """
    def merge(current, patch):
        if not isinstance(patch, dict) or not isinstance(current, dict):
            return deepcopy(patch)
        result = deepcopy(current)
        for key, value in patch.items():
            if key not in current:
                raise ValueError(f"Unknown scene field: {key}")
            result[key] = merge(current[key], value)
        return result

    values = state.model_dump()
    changes = deepcopy(changes)
    if "objects" in changes:
        patches = changes.pop("objects")
        if not isinstance(patches, list) or len(patches) > 24:
            raise ValueError("Object patches must be a list of at most 24 objects")
        known = {obj["id"]: obj for obj in values["objects"]}
        seen = set()
        for patch in patches:
            if not isinstance(patch, dict) or not isinstance(patch.get("id"), str) or patch["id"] in seen:
                raise ValueError("Each object patch needs a unique object ID")
            seen.add(patch["id"])
            known[patch["id"]] = merge(known[patch["id"]], patch) if patch["id"] in known else patch
        values["objects"] = list(known.values())
    if set(remove_objects) - {obj["id"] for obj in values["objects"]}:
        raise ValueError("Cannot remove an unknown scene object")
    values["objects"] = [obj for obj in values["objects"] if obj["id"] not in remove_objects]
    return SceneState.model_validate(merge(values, changes))


def build_prompt(state: SceneState) -> str:
    parts = []
    def add(label, value):
        if value.strip():
            parts.append(f"{label}: {value.strip().rstrip('.') }.")
    add("Visual style", state.visual_style)
    for key, value in state.character.model_dump(exclude={"profile_id"}).items():
        add(f"Character {key}", value)
    for group in ("environment", "camera", "lighting", "body"):
        for key, value in getattr(state, group).model_dump().items():
            add(f"{group.capitalize()} {key.replace('_', ' ')}", value)
    for obj in state.objects:
        label = obj.name.strip() or obj.id
        add("Visible object", label)
        for key, value in obj.model_dump(exclude={"id", "name"}).items():
            add(f"{label} {key}", value)
    add("Visible action", state.current_action)
    prompt = " ".join(parts)
    if len(prompt) > 12000:
        raise ValueError("Scene description exceeds 12,000 characters. Shorten its visible details.")
    return prompt
