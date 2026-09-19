"""
Tests for configuration resolution.

The contract that matters: a bad environment variable must degrade to the
default and record a warning, never raise. A user whose app will not start
cannot read the error explaining why.
"""

from pathlib import Path

import pytest

import config
from config import ENV_PREFIX, Settings, load_settings


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    """Start each test from a known-empty environment."""
    for key in list(__import__("os").environ):
        if key.startswith(ENV_PREFIX):
            monkeypatch.delenv(key, raising=False)


def env(monkeypatch, name, value):
    monkeypatch.setenv(f"{ENV_PREFIX}{name}", value)


# --- defaults --------------------------------------------------------------

def test_defaults_are_loopback_and_local_ollama():
    settings = load_settings()

    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.ollama_base_url == "http://localhost:11434"
    assert settings.embedding_model == "nomic-embed-text"
    assert settings.warnings == ()


def test_default_paths_live_under_the_project():
    settings = load_settings()

    assert settings.data_dir == config.PROJECT_ROOT / "data"
    assert settings.models_dir == config.PROJECT_ROOT / "models"


def test_default_origins_name_the_app_and_exclude_generic_browser_origins():
    settings = load_settings()

    # The packaged app has its own scheme, so "is this our window?" is a question
    # the backend can answer. "null" is shared with every sandboxed iframe on the
    # internet and must never stand for this application again.
    assert "app://local" in settings.allowed_origins
    assert "null" not in settings.allowed_origins
    assert "http://localhost:5173" in settings.allowed_origins
    assert "http://evil.example.com" not in settings.allowed_origins


def test_the_requested_context_window_is_configurable_and_sane():
    assert load_settings().num_ctx >= 2048


# --- overrides -------------------------------------------------------------

def test_host_and_port_are_overridable(monkeypatch):
    env(monkeypatch, "HOST", "0.0.0.0")
    env(monkeypatch, "PORT", "9123")

    settings = load_settings()

    assert settings.host == "0.0.0.0"
    assert settings.port == 9123


def test_ollama_url_is_overridable_and_normalised(monkeypatch):
    env(monkeypatch, "OLLAMA_URL", "http://192.168.1.50:11434/")

    assert load_settings().ollama_base_url == "http://192.168.1.50:11434"


def test_embedding_and_chat_models_are_overridable(monkeypatch):
    env(monkeypatch, "EMBEDDING_MODEL", "mxbai-embed-large")
    env(monkeypatch, "CHAT_MODEL", "qwen3.5:9b")

    settings = load_settings()

    assert settings.embedding_model == "mxbai-embed-large"
    assert settings.default_chat_model == "qwen3.5:9b"


def test_allowed_origins_accept_a_comma_separated_list(monkeypatch):
    env(monkeypatch, "ALLOWED_ORIGINS", "null, http://localhost:1234")

    assert load_settings().allowed_origins == ("null", "http://localhost:1234")


# --- portable relocation ---------------------------------------------------

def test_relocating_the_data_dir_moves_every_derived_path(monkeypatch, tmp_path):
    """One variable must relocate all writable state for a portable build."""
    env(monkeypatch, "DATA_DIR", str(tmp_path / "portable"))

    settings = load_settings()
    root = tmp_path / "portable"

    assert settings.sessions_dir == root / "sessions"
    assert settings.knowledge_base_dir == root / "knowledge_base"
    assert settings.memory_db_path == root / "memory.db"
    assert settings.prompt_index_path == root / "prompt_index.json"
    assert settings.prompt_index_draft_path == root / "prompt_index_draft.json"
    assert settings.generated_images_dir == root / "generated_images"
    assert settings.thinking_log_path == root / "thinking" / "thinking.log"
    assert settings.log_dir == root / "logs"


def test_log_dir_can_be_moved_independently_of_the_data_dir(monkeypatch, tmp_path):
    env(monkeypatch, "DATA_DIR", str(tmp_path / "data"))
    env(monkeypatch, "LOG_DIR", str(tmp_path / "elsewhere"))

    settings = load_settings()

    assert settings.log_dir == tmp_path / "elsewhere"
    assert settings.sessions_dir == tmp_path / "data" / "sessions"


def test_models_dir_relocation_moves_the_diffusers_path(monkeypatch, tmp_path):
    env(monkeypatch, "MODELS_DIR", str(tmp_path / "weights"))

    assert load_settings().diffusers_dir == tmp_path / "weights" / "diffusers"


# --- malformed input degrades safely ---------------------------------------

def test_non_numeric_port_falls_back_and_warns(monkeypatch):
    env(monkeypatch, "PORT", "not-a-port")

    settings = load_settings()

    assert settings.port == 8000
    assert any("PORT" in w for w in settings.warnings)


def test_out_of_range_port_falls_back_and_warns(monkeypatch):
    env(monkeypatch, "PORT", "0")

    settings = load_settings()

    assert settings.port == 8000
    assert settings.warnings


def test_empty_variable_is_treated_as_unset(monkeypatch):
    env(monkeypatch, "OLLAMA_URL", "   ")

    settings = load_settings()

    assert settings.ollama_base_url == "http://localhost:11434"
    assert settings.warnings == ()


def test_empty_origins_list_falls_back_to_defaults(monkeypatch):
    env(monkeypatch, "ALLOWED_ORIGINS", " , , ")

    settings = load_settings()

    assert settings.allowed_origins == config.DEFAULT_ALLOWED_ORIGINS
    assert settings.warnings


def test_overlap_larger_than_chunk_size_is_corrected(monkeypatch):
    """An overlap at or above chunk size makes the splitter loop forever."""
    env(monkeypatch, "CHUNK_SIZE", "500")
    env(monkeypatch, "CHUNK_OVERLAP", "900")

    settings = load_settings()

    assert settings.chunk_overlap < settings.chunk_size
    assert any("CHUNK_OVERLAP" in w for w in settings.warnings)


def test_below_minimum_budget_falls_back(monkeypatch):
    env(monkeypatch, "KNOWLEDGE_BASE_MAX_CHARS", "5")

    settings = load_settings()

    assert settings.knowledge_base_max_chars == 8000
    assert settings.warnings


def test_loading_never_raises_on_hostile_input(monkeypatch):
    for name in ("PORT", "CHUNK_SIZE", "CHUNK_OVERLAP", "DURABLE_MEMORY_MAX_CHARS"):
        env(monkeypatch, name, ";drop table--")

    settings = load_settings()

    assert isinstance(settings, Settings)
    assert settings.port == 8000


# --- diagnostics -----------------------------------------------------------

def test_describe_reports_the_values_support_will_ask_for():
    described = " | ".join(load_settings().describe())

    assert "127.0.0.1:8000" in described
    assert "http://localhost:11434" in described
    assert "data dir" in described
    assert "log dir" in described


def test_settings_are_immutable():
    """Runtime mutation would let one request change another's configuration."""
    settings = load_settings()

    with pytest.raises(Exception):
        settings.port = 1234
