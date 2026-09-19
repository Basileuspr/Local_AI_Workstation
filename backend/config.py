"""
Environment-aware configuration.

Every value that differs between a developer checkout, a portable USB build,
and someone else's machine is resolved here, once. Modules keep their own
module-level constant so tests can still redirect a single path, but the
default that constant starts from comes from this file.

Two rules hold throughout:

1. Nothing here raises. A malformed environment variable falls back to the
   default and records a warning; a bad setting must never stop the backend
   from starting, because a user who cannot start the app cannot read the
   error either.
2. Nothing here logs. Logging is configured from these values, so importing
   the logger would be circular. Warnings accumulate in `settings.warnings`
   and main.py emits them once logging is up.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ENV_PREFIX = "LAW_"

PROJECT_ROOT = Path(__file__).resolve().parents[1]

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
DEFAULT_OLLAMA_URL = "http://localhost:11434"
DEFAULT_EMBEDDING_MODEL = "nomic-embed-text"
DEFAULT_CHAT_MODEL = "mistral"
DEFAULT_OCR_MODEL = "qwen3-vl:8b"

# The packaged app is served over its own app:// scheme so it has a real,
# nameable origin. It used to load from file://, whose "null" origin is shared
# with every sandboxed iframe on the internet -- that made "is this our app?"
# unanswerable, so "null" is deliberately absent here. The Vite dev server is
# the other legitimate caller.
APP_ORIGIN = "app://local"
DEFAULT_ALLOWED_ORIGINS = (
    APP_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def _env(name: str) -> str | None:
    raw = os.environ.get(f"{ENV_PREFIX}{name}")
    if raw is None:
        return None
    raw = raw.strip()
    return raw or None


def _env_int(name: str, default: int, warnings: list[str], minimum: int = 1) -> int:
    raw = _env(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        warnings.append(f"{ENV_PREFIX}{name}={raw!r} is not an integer; using {default}")
        return default
    if value < minimum:
        warnings.append(f"{ENV_PREFIX}{name}={value} is below {minimum}; using {default}")
        return default
    return value


def _env_path(name: str, default: Path, warnings: list[str]) -> Path:
    raw = _env(name)
    if raw is None:
        return default
    try:
        return Path(raw).expanduser()
    except (OSError, ValueError):
        warnings.append(f"{ENV_PREFIX}{name}={raw!r} is not a usable path; using {default}")
        return default


def _env_origins(name: str, default: tuple[str, ...], warnings: list[str]) -> tuple[str, ...]:
    raw = _env(name)
    if raw is None:
        return default
    origins = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not origins:
        warnings.append(f"{ENV_PREFIX}{name} was empty; using the built-in origins")
        return default
    return origins


@dataclass(frozen=True)
class Settings:
    """Resolved configuration for one backend process."""

    host: str
    port: int

    ollama_base_url: str
    embedding_model: str
    default_chat_model: str
    ocr_model: str
    ocr_timeout_seconds: int
    ocr_min_page_chars: int

    data_dir: Path
    models_dir: Path

    log_dir: Path
    log_level: str

    allowed_origins: tuple[str, ...]

    num_ctx: int
    durable_memory_max_chars: int
    knowledge_base_max_chars: int
    chunk_size: int
    chunk_overlap: int

    warnings: tuple[str, ...] = field(default=())

    # --- derived paths -----------------------------------------------------
    # Everything the app writes hangs off data_dir, so a portable build can
    # relocate all of it by setting one variable.

    @property
    def sessions_dir(self) -> Path:
        return self.data_dir / "sessions"

    @property
    def knowledge_base_dir(self) -> Path:
        return self.data_dir / "knowledge_base"

    @property
    def memory_db_path(self) -> Path:
        return self.data_dir / "memory.db"

    @property
    def prompt_index_path(self) -> Path:
        return self.data_dir / "prompt_index.json"

    @property
    def prompt_index_draft_path(self) -> Path:
        return self.data_dir / "prompt_index_draft.json"

    @property
    def generated_images_dir(self) -> Path:
        return self.data_dir / "generated_images"

    @property
    def image_workflows_dir(self) -> Path:
        return self.data_dir / "image_workflows"

    @property
    def lora_dir(self) -> Path:
        return self.data_dir / "lora"

    @property
    def lora_adapters_dir(self) -> Path:
        return self.lora_dir / "adapters"

    @property
    def thinking_log_path(self) -> Path:
        return self.data_dir / "thinking" / "thinking.log"

    @property
    def diffusers_dir(self) -> Path:
        return self.models_dir / "diffusers"

    def describe(self) -> list[str]:
        """Human-readable summary, logged at startup to make support easier."""
        return [
            f"listening on {self.host}:{self.port}",
            f"ollama at {self.ollama_base_url}",
            f"embedding model {self.embedding_model}",
            f"PDF OCR model {self.ocr_model}",
            f"data dir {self.data_dir}",
            f"models dir {self.models_dir}",
            f"log dir {self.log_dir}",
            f"allowed origins {', '.join(self.allowed_origins)}",
        ]


def load_settings() -> Settings:
    """Read the environment and resolve a complete configuration."""
    warnings: list[str] = []

    data_dir = _env_path("DATA_DIR", PROJECT_ROOT / "data", warnings)
    models_dir = _env_path("MODELS_DIR", PROJECT_ROOT / "models", warnings)
    log_dir = _env_path("LOG_DIR", data_dir / "logs", warnings)

    chunk_size = _env_int("CHUNK_SIZE", 500, warnings, minimum=50)
    chunk_overlap = _env_int("CHUNK_OVERLAP", 100, warnings, minimum=0)
    if chunk_overlap >= chunk_size:
        warnings.append(
            f"{ENV_PREFIX}CHUNK_OVERLAP={chunk_overlap} must be smaller than "
            f"chunk size {chunk_size}; using {chunk_size // 5}"
        )
        chunk_overlap = chunk_size // 5

    return Settings(
        host=_env("HOST") or DEFAULT_HOST,
        port=_env_int("PORT", DEFAULT_PORT, warnings, minimum=1),
        ollama_base_url=(_env("OLLAMA_URL") or DEFAULT_OLLAMA_URL).rstrip("/"),
        embedding_model=_env("EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL,
        default_chat_model=_env("CHAT_MODEL") or DEFAULT_CHAT_MODEL,
        ocr_model=_env("OCR_MODEL") or DEFAULT_OCR_MODEL,
        ocr_timeout_seconds=_env_int("OCR_TIMEOUT_SECONDS", 240, warnings, minimum=10),
        ocr_min_page_chars=_env_int("OCR_MIN_PAGE_CHARS", 20, warnings, minimum=1),
        data_dir=data_dir,
        models_dir=models_dir,
        log_dir=log_dir,
        log_level=(_env("LOG_LEVEL") or "INFO").upper(),
        allowed_origins=_env_origins("ALLOWED_ORIGINS", DEFAULT_ALLOWED_ORIGINS, warnings),
        # The context the app actually asks Ollama for. Previously nothing was
        # sent, so Ollama used its own default while the interface sized its
        # meter and its compaction triggers from the model's *trained* window --
        # often sixteen times larger. Sending it makes the two agree by
        # construction instead of by coincidence.
        num_ctx=_env_int("NUM_CTX", 16384, warnings, minimum=2048),
        durable_memory_max_chars=_env_int("DURABLE_MEMORY_MAX_CHARS", 4800, warnings, minimum=200),
        knowledge_base_max_chars=_env_int("KNOWLEDGE_BASE_MAX_CHARS", 8000, warnings, minimum=200),
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        warnings=tuple(warnings),
    )


settings = load_settings()
