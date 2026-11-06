"""Provider contracts and operations. Model loading happens only on execution."""

from dataclasses import dataclass
from pathlib import Path
from threading import Event
from typing import Protocol
from typing import Callable

from .contracts import Operation, PromptSettings, Stage


@dataclass(frozen=True)
class PreparedStage:
    """Runner-resolved owned paths, not raw browser-supplied filesystem paths."""

    stage: Stage
    prompt_settings: PromptSettings
    source: Path | None
    mask: Path | None
    control: Path | None
    references: tuple[Path, ...]


@dataclass(frozen=True)
class StageResult:
    # Runner must validate that paths are within its assigned artifact directory.
    image_paths: tuple[Path, ...] = ()
    text: str | None = None
    metadata: dict | None = None


class WorkflowCancelled(Exception):
    pass


@dataclass(frozen=True)
class ExecutionContext:
    request_id: str
    output_dir: Path
    cancel_event: Event
    progress: Callable = lambda **values: None

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise WorkflowCancelled("Workflow stopped")


class WorkflowProvider(Protocol):
    key: str
    operations: frozenset[Operation]

    async def execute(self, request: PreparedStage, context: ExecutionContext) -> StageResult:
        """Await real worker exit and resource cleanup even when cancelled."""
        ...


OPERATIONS = [
    {"id": "txt2img", "label": "Text to image", "output": "image", "help": "Create a first frame from the complete visible scene prompt with installed SDXL."},
    {"id": "describe", "label": "Describe / OCR", "output": "text", "help": "Describe an image and transcribe its visible text. Suggestions must be reviewed before using them as prompts."},
    {"id": "img2img", "label": "Image to image", "output": "image", "help": "Rework a source image using your prompt. Higher strength permits larger changes; likeness is not guaranteed."},
    {"id": "inpaint", "label": "Masked editing", "output": "image", "help": "Edit the white area of a matching-size mask; black marks the area to preserve. Gray blends between source and result."},
    {"id": "controlnet", "label": "ControlNet guidance", "output": "image", "help": "Guide SDXL with Canny edges extracted from the source or an uploaded edge map. Control influence preserves structure; change strength controls redesign."},
    {"id": "upscale", "label": "Upscale", "output": "image", "help": "Choose conventional Lanczos resizing or trained Real-ESRGAN detail reconstruction. Trained detail is an estimate, not recovered ground truth."},
    {"id": "multi_reference", "label": "Multi-reference editing", "output": "image", "help": "Use a source plus up to eight images with IP-Adapter Plus. All references are pooled for appearance; identity and separate subjects are not guaranteed."},
    {"id": "outpaint", "label": "Outpaint / extend canvas", "output": "image", "help": "Set the final canvas and new border widths. SDXL generates outside the fitted source; its interior pixels remain unchanged."},
]


def catalog() -> dict:
    from .adapters import capability_catalog
    return capability_catalog(OPERATIONS)
