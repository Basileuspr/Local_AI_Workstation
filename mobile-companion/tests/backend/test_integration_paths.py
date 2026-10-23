"""The scoped source folder must still integrate with a normally launched desktop."""
import os
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[3]


def test_backend_loads_companion_from_an_unrelated_working_directory(tmp_path):
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "backend"),
                   "LAW_DATA_DIR": str(tmp_path / "data"),
                   "LAW_LOG_DIR": str(tmp_path / "logs"),
                   "LAW_MODELS_DIR": str(tmp_path / "models"),
                   "LAW_IMAGE_MANAGER_DIR": str(tmp_path / "image-catalog")}
    code = """
import main
from mobile_companion import routes
from services import maintenance_gate
assert main.mobile_router is routes.router
assert routes._instance is None  # importing must not start phone access
print('companion-loaded')
"""
    result = subprocess.run([sys.executable, "-B", "-c", code], cwd=tmp_path,
                            env=environment, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    assert "companion-loaded" in result.stdout
