"""
Shared pytest fixtures.

The backend modules import each other as top-level packages (`from services.x
import y`), so `backend/` has to be on sys.path before any test imports them.
"""

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[2] / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture
def sessions_dir(tmp_path, monkeypatch):
    """
    Point the session store at a throwaway directory.

    SESSIONS_DIR is a module-level constant, so tests that touch disk must
    redirect it or they will read and write the developer's real chat history.
    """
    from services import session_store

    target = tmp_path / "sessions"
    target.mkdir()
    monkeypatch.setattr(session_store, "SESSIONS_DIR", target)
    monkeypatch.setattr(session_store, "TRASH_DIR", tmp_path / "trash")
    monkeypatch.setattr(session_store, "BACKUPS_DIR", tmp_path / "backups")
    monkeypatch.setattr(session_store, "GENERATED_IMAGES_DIR", tmp_path / "generated_images")
    return target


@pytest.fixture
def prompt_index_paths(tmp_path, monkeypatch):
    """Redirect the prompt index and its draft file to a throwaway directory."""
    from services import prompt_index_store

    entries = tmp_path / "prompt_index.json"
    draft = tmp_path / "prompt_index_draft.json"
    monkeypatch.setattr(prompt_index_store, "PROMPT_INDEX_PATH", entries)
    monkeypatch.setattr(prompt_index_store, "PROMPT_INDEX_DRAFT_PATH", draft)
    return entries, draft


@pytest.fixture
def lora_paths(tmp_path, monkeypatch):
    """Keep LoRA projects, copied datasets, and adapters out of user data."""
    from services import lora_store

    root = tmp_path / "lora"
    monkeypatch.setattr(lora_store, "LORA_DIR", root)
    monkeypatch.setattr(lora_store, "PROJECTS_DIR", root / "projects")
    monkeypatch.setattr(lora_store, "ADAPTERS_DIR", root / "adapters")
    monkeypatch.setattr(lora_store, "COMPLETE_LORAS_DIR", root / "Complete LoRas")
    monkeypatch.setattr(lora_store, "RUNS_DIR", root / "runs")
    monkeypatch.setattr(lora_store, "TRAINING_LOCK_PATH", root / "training.lock")
    return root


# The backend now requires a per-launch session credential and a loopback Host,
# so tests that drive the real app must present both, exactly as the desktop
# window does. Tests that build a bare router app are unaffected.
SESSION_TOKEN = "test-session-token"
API_BASE_URL = "http://127.0.0.1:8000"
AUTH_HEADERS = {"X-LAW-Session": SESSION_TOKEN}


@pytest.fixture(autouse=True)
def _session_token(monkeypatch):
    monkeypatch.setenv("LAW_SESSION_TOKEN", SESSION_TOKEN)
    return SESSION_TOKEN
