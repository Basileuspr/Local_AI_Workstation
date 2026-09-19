"""
Tests for logging setup.

Logging is the tool used when something breaks on a machine we cannot inspect,
so its own failure modes matter: it must never raise, never take the app down
with it, and never silently stop recording.
"""

import logging
from pathlib import Path

import pytest

from services import app_logging


@pytest.fixture
def log_dir(tmp_path, monkeypatch):
    """Redirect logging at the environment level and reset module state."""
    target = tmp_path / "logs"
    monkeypatch.setenv(app_logging.LOG_DIR_ENV, str(target))
    monkeypatch.setattr(app_logging, "_configured", False)
    yield target
    # Detach handlers so a temp directory is not held by later tests.
    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()


# --- configuration resolution ---------------------------------------------

def test_log_dir_defaults_under_the_data_directory(monkeypatch):
    monkeypatch.delenv(app_logging.LOG_DIR_ENV, raising=False)

    assert app_logging.resolve_log_dir() == app_logging.DEFAULT_LOG_DIR
    assert app_logging.DEFAULT_LOG_DIR.name == "logs"


def test_log_dir_honours_the_environment_override(monkeypatch, tmp_path):
    monkeypatch.setenv(app_logging.LOG_DIR_ENV, str(tmp_path / "elsewhere"))

    assert app_logging.resolve_log_dir() == tmp_path / "elsewhere"


def test_level_defaults_to_info(monkeypatch):
    monkeypatch.delenv(app_logging.LOG_LEVEL_ENV, raising=False)

    assert app_logging.resolve_level() == logging.INFO


@pytest.mark.parametrize(
    "value, expected",
    [("DEBUG", logging.DEBUG), ("warning", logging.WARNING), ("  ERROR  ", logging.ERROR)],
)
def test_level_parses_names_case_insensitively(monkeypatch, value, expected):
    monkeypatch.setenv(app_logging.LOG_LEVEL_ENV, value)

    assert app_logging.resolve_level() == expected


def test_unparseable_level_falls_back_to_info(monkeypatch):
    """A typo in an env var must not stop the backend from starting."""
    monkeypatch.setenv(app_logging.LOG_LEVEL_ENV, "LOUD")

    assert app_logging.resolve_level() == logging.INFO


# --- setup behaviour -------------------------------------------------------

def test_setup_creates_the_log_directory_and_file(log_dir):
    path = app_logging.setup_logging(force=True)

    assert path is not None
    assert log_dir.is_dir()
    app_logging.get_logger("test").info("hello")
    assert path.exists()


def test_messages_reach_the_file_with_level_and_timestamp(log_dir):
    path = app_logging.setup_logging(force=True)

    app_logging.get_logger("backend.sample").warning("disk is filling up")

    contents = path.read_text(encoding="utf-8")
    assert "disk is filling up" in contents
    assert "WARNING" in contents
    assert "backend.sample" in contents
    # Leading ISO-ish date, e.g. 2026-08-07 15:04:05
    assert contents[:4].isdigit()


def test_exception_logging_records_the_traceback(log_dir):
    """logger.exception replaced bare prints precisely to capture these."""
    path = app_logging.setup_logging(force=True)

    try:
        raise ValueError("upstream exploded")
    except ValueError:
        app_logging.get_logger("backend.sample").exception("operation failed")

    contents = path.read_text(encoding="utf-8")
    assert "operation failed" in contents
    assert "ValueError: upstream exploded" in contents
    assert "Traceback" in contents


def test_third_party_loggers_share_the_file(log_dir):
    """Handlers live on the root logger so uvicorn output lands here too."""
    path = app_logging.setup_logging(force=True)

    logging.getLogger("uvicorn.error").warning("port already in use")

    assert "port already in use" in path.read_text(encoding="utf-8")


def test_setup_is_idempotent(log_dir):
    app_logging.setup_logging(force=True)
    handler_count = len(logging.getLogger().handlers)

    app_logging.setup_logging()
    app_logging.setup_logging()

    assert len(logging.getLogger().handlers) == handler_count


def test_repeated_setup_does_not_duplicate_lines(log_dir):
    path = app_logging.setup_logging(force=True)
    app_logging.setup_logging()

    app_logging.get_logger("backend.sample").info("only once")

    assert path.read_text(encoding="utf-8").count("only once") == 1


def test_debug_is_suppressed_at_the_default_level(log_dir, monkeypatch):
    monkeypatch.delenv(app_logging.LOG_LEVEL_ENV, raising=False)
    path = app_logging.setup_logging(force=True)

    app_logging.get_logger("backend.sample").debug("noisy detail")

    assert "noisy detail" not in path.read_text(encoding="utf-8")


def test_debug_is_recorded_when_the_level_is_lowered(log_dir, monkeypatch):
    monkeypatch.setenv(app_logging.LOG_LEVEL_ENV, "DEBUG")
    path = app_logging.setup_logging(force=True)

    app_logging.get_logger("backend.sample").debug("noisy detail")

    assert "noisy detail" in path.read_text(encoding="utf-8")


def test_rotation_is_configured_with_a_bounded_size(log_dir):
    from logging.handlers import RotatingFileHandler

    app_logging.setup_logging(force=True)

    rotating = [h for h in logging.getLogger().handlers if isinstance(h, RotatingFileHandler)]
    assert len(rotating) == 1
    assert rotating[0].maxBytes == app_logging.MAX_BYTES
    assert rotating[0].backupCount == app_logging.BACKUP_COUNT
    assert rotating[0].backupCount > 0


def test_an_unwritable_log_directory_degrades_to_console(monkeypatch, tmp_path):
    """A read-only install location must not prevent the backend from running."""
    blocker = tmp_path / "not-a-directory"
    blocker.write_text("", encoding="utf-8")
    monkeypatch.setenv(app_logging.LOG_DIR_ENV, str(blocker / "logs"))
    monkeypatch.setattr(app_logging, "_configured", False)

    path = app_logging.setup_logging(force=True)

    assert path is None
    # Console logging survives, so diagnostics are not lost entirely.
    assert logging.getLogger().handlers

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()


def test_log_file_path_reports_where_records_are_written(monkeypatch, tmp_path):
    monkeypatch.setenv(app_logging.LOG_DIR_ENV, str(tmp_path / "logs"))

    assert app_logging.log_file_path() == tmp_path / "logs" / app_logging.LOG_FILENAME
