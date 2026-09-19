"""Face detector/embedder contracts. Model loading happens only on first use.

The pipeline talks to this interface and never to a specific model, so a
different detector can be added by registering another provider here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class DetectedFace:
    """One detected face in source-image pixel coordinates."""

    box: tuple[float, float, float, float]
    confidence: float
    landmarks: tuple[tuple[float, float], ...] = ()
    embedding: tuple[float, ...] = ()

    @property
    def width(self) -> float:
        return max(0.0, self.box[2] - self.box[0])

    @property
    def height(self) -> float:
        return max(0.0, self.box[3] - self.box[1])


@dataclass
class ProviderStatus:
    key: str
    name: str
    ready: bool
    device: str
    detail: str
    files: list[dict] = field(default_factory=list)


class FaceProvider(Protocol):
    key: str
    name: str

    def status(self) -> ProviderStatus:
        """Report readiness without loading anything."""

    def detect(self, image, cancelled=None) -> list[DetectedFace]:
        """Return every visible face, with embeddings when supported."""

    def unload(self) -> bool:
        """Release model memory; the next detect reloads on demand."""


_REGISTRY: dict[str, FaceProvider] = {}


def register(provider: FaceProvider) -> None:
    _REGISTRY[provider.key] = provider


def get_provider(key: str | None = None) -> FaceProvider:
    if not _REGISTRY:
        from services.faces import insight_onnx  # noqa: F401  (registers on import)
    if key:
        if key not in _REGISTRY:
            raise ValueError(f"Unknown face provider '{key}'")
        return _REGISTRY[key]
    ready = [provider for provider in _REGISTRY.values() if provider.status().ready]
    if not ready:
        raise ValueError("No face model is installed yet. Install the face models from the Faces tab first.")
    return ready[0]


def catalog() -> list[ProviderStatus]:
    if not _REGISTRY:
        from services.faces import insight_onnx  # noqa: F401
    return [provider.status() for provider in _REGISTRY.values()]
