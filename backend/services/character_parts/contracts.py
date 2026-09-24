"""Reviewable anatomy labels, image-space rectangles, and training selections."""
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

PARTS = {
    "body": "Body without head", "torso": "Torso", "chest": "Chest", "abdomen": "Abdomen",
    "back": "Back", "pelvis": "Pelvis / hips", "buttocks": "Buttocks / glutes", "shoulder": "Shoulder", "arm": "Arm",
    "upper_arm": "Upper arm", "elbow": "Elbow", "forearm": "Forearm", "wrist": "Wrist",
    "hand": "Hand", "palm": "Palm", "hand_back": "Back of hand", "finger": "Finger",
    "leg": "Leg", "thigh": "Thigh", "knee": "Knee", "shin": "Shin", "calf": "Calf",
    "ankle": "Ankle", "foot": "Foot", "toe": "Toe", "eye": "Eye", "mouth": "Mouth", "custom": "Any area / custom",
}
VIEWS = {"unknown": "Uncertain / unspecified", "front": "Front", "back": "Back",
         "left_side": "Left side", "right_side": "Right side",
         "left_three_quarter": "Left three-quarter", "right_three_quarter": "Right three-quarter",
         "above": "From above", "below": "From below"}
SIDES = {"unspecified": "Unspecified", "left": "Character's left", "right": "Character's right", "both": "Both sides"}
Part = Literal[tuple(PARTS)]
View = Literal[tuple(VIEWS)]
Side = Literal[tuple(SIDES)]
Id = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
SourceId = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Unit = Annotated[float, Field(ge=0, le=1)]


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Region(Record):
    part: Part
    side: Side = "unspecified"
    view: View = "unknown"
    detail: str = Field(default="", max_length=100, description="Specific finger/toe, e.g. thumb, index finger or big toe. Empty if uncertain.")
    box: tuple[Unit, Unit, Unit, Unit] = Field(description="Normalized [left, top, right, bottom], relative to the displayed EXIF-oriented image.")
    caption: str = Field(default="", max_length=2000)
    notes: str = Field(default="", max_length=2000)
    flags: list[Annotated[str, Field(max_length=160)]] = Field(default_factory=list, max_length=12)

    @model_validator(mode="after")
    def nonempty_box(self):
        if self.box[2] <= self.box[0] or self.box[3] <= self.box[1]:
            raise ValueError("Draw a crop rectangle with a positive width and height")
        if self.part == "custom" and not self.detail.strip():
            raise ValueError("Name the custom area you want to focus on")
        return self


class Analysis(Record):
    caption: str = Field(max_length=2000, description="Caption describing the whole image, not an individual crop.")
    warnings: list[Annotated[str, Field(max_length=300)]] = Field(default_factory=list, max_length=12)
    regions: list[Region] = Field(default_factory=list, max_length=64)


class Selection(Region):
    source_id: SourceId
    export_mode: Literal["full", "crop", "both"] = "both"
    state: Literal["pending", "accepted", "rejected"] = "pending"


class Revision(Record):
    revision: int = Field(ge=1)


class SaveSelection(Revision):
    selection: Selection


class StateRequest(Revision):
    ids: list[Id] = Field(min_length=1, max_length=20000)
    state: Literal["pending", "accepted", "rejected"]


class AnalyzeRequest(Record):
    source_ids: list[SourceId] = Field(min_length=1, max_length=500)
    model: str = Field(min_length=1, max_length=200)
    parts: list[Part] = Field(min_length=1, max_length=len(PARTS))
    subject_hint: str = Field(default="", max_length=500)
    reference_selection_id: Id | None = None
    focus_description: str = Field(default="", max_length=1000)
