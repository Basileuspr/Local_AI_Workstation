"""
Application logging.

The desktop build has no console: Electron pipes the backend's stdout into a
devtools window nobody sees, and a packaged app has no terminal at all. So
everything worth diagnosing has to reach a file on disk that a user can be
asked to send back.

Handlers are attached to the root logger so third-party loggers (uvicorn,
httpx) land in the same file, giving one chronological record of a session.
"""

from __future__ import annotations

import logging
import os
import re
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from config import settings

# These names are still read directly so a test can redirect logging without
# rebuilding the whole settings object. config applies the same variables.
LOG_DIR_ENV = "LAW_LOG_DIR"
LOG_LEVEL_ENV = "LAW_LOG_LEVEL"

DEFAULT_LOG_DIR = settings.log_dir
LOG_FILENAME = "backend.log"

# Roughly a few thousand requests per file, five files retained. Enough to
# cover a long session without letting a runaway loop fill the disk.
MAX_BYTES = 2_000_000
BACKUP_COUNT = 5

LOG_FORMAT = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

_configured = False
_file_handler = None

# Image tags and download links carry the session credential as a query value,
# and uvicorn's access line prints the whole path. A log is the one artefact a
# user is most likely to send to someone else, so the value never reaches it.
_TOKEN_PATTERN = re.compile(r"((?:law_token|apiToken)=)[^&\s\"']+", re.I)
_HEADER_PATTERN = re.compile(r"((?:Bearer\s+|X-LAW-Session[\"']?\s*[:=]\s*[\"']?))[^\s\"',;}]+", re.I)


def redact(value):
    return _HEADER_PATTERN.sub(r"\1REDACTED", _TOKEN_PATTERN.sub(r"\1REDACTED", value))


class SafeFormatter(logging.Formatter):
    def format(self, record):
        return redact(super().format(record))


class ResilientFileHandler(RotatingFileHandler):
    available = True
    failures = 0

    def emit(self, record):
        before = self.failures
        super().emit(record)
        self.available = self.failures == before

    def handleError(self, record):
        if self.available:
            try:
                sys.stderr.write("File logging failed; console logging continues. Check free disk space and log folder permissions.\n")
            except OSError:
                pass
        self.available = False
        self.failures += 1


def logging_status():
    return {"file_available": bool(_file_handler and _file_handler.available),
            "detail": None if _file_handler and _file_handler.available else
            "Backend file logging unavailable. Check free disk space and log folder permissions; console logging continues."}


def _mentions_token(record: logging.LogRecord) -> bool:
    if isinstance(record.msg, str) and _TOKEN_PATTERN.search(record.msg):
        return True
    args = record.args if isinstance(record.args, tuple) else (record.args,) if record.args else ()
    return any(isinstance(item, str) and _TOKEN_PATTERN.search(item) for item in args)


class RedactSessionToken(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not _mentions_token(record):
            return True
        try:
            # Render first, then redact. Rewriting the format string on its own
            # can delete a %s whose argument still exists, which breaks the very
            # line we were trying to clean.
            rendered = record.getMessage()
        except (TypeError, ValueError):
            return True
        record.msg = _TOKEN_PATTERN.sub(r"\1REDACTED", rendered)
        record.args = ()
        return True


def resolve_log_dir() -> Path:
    """Where log files are written. Overridable for packaged builds."""
    override = os.environ.get(LOG_DIR_ENV)
    return Path(override) if override else DEFAULT_LOG_DIR


def resolve_level() -> int:
    """
    Log level from the environment, defaulting to INFO.

    An unparseable value falls back to INFO rather than raising: a bad env var
    must never stop the application from starting.
    """
    raw = (os.environ.get(LOG_LEVEL_ENV) or settings.log_level or "").strip().upper()
    if not raw:
        return logging.INFO
    resolved = logging.getLevelName(raw)
    return resolved if isinstance(resolved, int) else logging.INFO


def log_file_path() -> Path:
    return resolve_log_dir() / LOG_FILENAME


def setup_logging(force: bool = False) -> Path | None:
    """
    Attach a rotating file handler and a console handler to the root logger.

    Idempotent: repeated calls are ignored so importing the app twice does not
    duplicate every line. Returns the log file path, or None if the directory
    could not be created -- console logging still works in that case, because
    losing the log file must not take the application down with it.
    """
    global _configured, _file_handler
    if _configured and not force:
        return log_file_path() if _file_handler and _file_handler.available else None
    _file_handler = None

    root = logging.getLogger()
    for handler in list(root.handlers):
        root.removeHandler(handler)
        handler.close()

    level = resolve_level()
    root.setLevel(level)
    formatter = SafeFormatter(LOG_FORMAT, datefmt=DATE_FORMAT)
    # On the handlers, not on the root logger: a logger's filters are consulted
    # only for records logged directly to it, so a root filter never sees
    # uvicorn.access records, which are exactly the ones carrying the query.
    redact = RedactSessionToken()

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    console.setLevel(level)
    console.addFilter(redact)
    root.addHandler(console)

    resolved_path: Path | None = None
    try:
        directory = resolve_log_dir()
        directory.mkdir(parents=True, exist_ok=True)
        file_handler = ResilientFileHandler(
            directory / LOG_FILENAME,
            maxBytes=MAX_BYTES,
            backupCount=BACKUP_COUNT,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(level)
        file_handler.addFilter(redact)
        root.addHandler(file_handler)
        resolved_path = directory / LOG_FILENAME
        _file_handler = file_handler
    except OSError as exc:
        root.warning("File logging unavailable, continuing with console only: %s", exc)

    # Chatty third-party loggers would otherwise bury the application's own
    # lines at DEBUG level.
    logging.getLogger("httpx").setLevel(max(level, logging.WARNING))
    logging.getLogger("httpcore").setLevel(max(level, logging.WARNING))

    _configured = True
    return resolved_path


def get_logger(name: str) -> logging.Logger:
    """Module-level logger. Callers do not need to know setup ran."""
    return logging.getLogger(name)
