"""Validated presentation metadata, separate from indexed document content."""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

KnowledgeNodeIcon = Literal["none", "document", "star", "person", "idea", "book", "flag", "check"]


class KnowledgeNodeOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    label: str = Field(default="", max_length=100)
    color: str = Field(default="#6d9cbc", pattern=r"^#[0-9a-fA-F]{6}$")
    shape: Literal["circle", "square", "diamond", "hexagon"] = "circle"
    size: int = Field(default=24, ge=14, le=48)
    size_mode: Literal["chunks", "fixed"] = "chunks"
    icon: KnowledgeNodeIcon = "document"
    border: Literal["solid", "dashed", "none"] = "solid"
    label_mode: Literal["short", "full", "hidden"] = "short"
    font_size: int = Field(default=13, ge=10, le=20)
    tags: list[str] = Field(default_factory=list, max_length=12)
    note: str = Field(default="", max_length=2000)
    locked: bool = False

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, values):
        tags = list(dict.fromkeys(value.strip() for value in values if value.strip()))
        if any(len(tag) > 30 for tag in tags):
            raise ValueError("Tags must be at most 30 characters")
        return tags
