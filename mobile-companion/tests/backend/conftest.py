"""Reuse workstation test isolation for the companion's backend tests."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "workstation_test_fixtures", Path(__file__).resolve().parents[3] / "tests/backend/conftest.py")
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
sessions_dir = shared.sessions_dir
_session_token = shared._session_token
# Existing workstation tests import these constants from the top-level conftest.
# Pytest can load either test root first, so expose the same shared values here.
API_BASE_URL = shared.API_BASE_URL
AUTH_HEADERS = shared.AUTH_HEADERS
SESSION_TOKEN = shared.SESSION_TOKEN
