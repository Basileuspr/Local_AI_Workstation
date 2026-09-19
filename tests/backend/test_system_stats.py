import subprocess
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import system_stats as stats


def test_gpu_units_multiple_devices_and_unsupported_sensors(monkeypatch):
    monkeypatch.setattr(stats, "run_command", lambda args: '0, GPU A, 0, 44, 1815, 7001, 8192, 2048, 60.5\n1, GPU B, [N/A], [Not Supported], 1200, 5000, 4096, 0, N/A\n')
    gpus, error = stats.read_gpus()
    assert error is None
    assert len(gpus) == 2
    assert gpus[0]["usage_percent"] == 0
    assert gpus[0]["vram_total_bytes"] == 8 * 1024 ** 3
    assert gpus[1]["temperature_c"] is None
    assert gpus[1]["usage_percent"] is None
    assert gpus[1]["vram_used_bytes"] == 0


@pytest.mark.parametrize("failure", [FileNotFoundError(), subprocess.TimeoutExpired("nvidia-smi", 4)])
def test_gpu_failure_is_partial_not_whole_dashboard(monkeypatch, failure):
    def fail(args):
        raise failure
    monkeypatch.setattr(stats, "run_command", fail)
    gpus, error = stats.read_gpus()
    assert gpus == []
    assert "unavailable" in error


def test_each_drive_survives_inaccessible_neighbor(monkeypatch):
    monkeypatch.setattr(stats.psutil, "disk_partitions", lambda all: [NS(device=name, mountpoint=name, fstype="NTFS", opts="rw,fixed") for name in ["C:\\", "E:\\", "C:\\"]])
    def usage(path):
        if path == "E:\\":
            raise PermissionError()
        return NS(total=100, used=60, free=40, percent=60)
    monkeypatch.setattr(stats.psutil, "disk_usage", usage)
    drives = stats.read_drives()
    assert len(drives) == 2
    assert drives[0]["free_bytes"] == 40
    assert drives[1]["free_bytes"] is None
    assert drives[1]["error"]


def test_snapshot_cache_expiry_and_route_without_data_stores(monkeypatch):
    from routes.system_stats import router
    from routes import system_stats as route
    clock = [100]
    calls = []
    monkeypatch.setattr(stats.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(stats, "read_hardware", lambda: ([], []))
    monkeypatch.setattr(stats, "read_gpus", lambda: ([], "GPU unavailable"))
    monkeypatch.setattr(stats, "read_drives", lambda: [])
    monkeypatch.setattr(stats, "cpu_name", lambda: "Test CPU")
    monkeypatch.setattr(stats.psutil, "cpu_percent", lambda interval: calls.append(interval) or 0)
    monkeypatch.setattr(stats.psutil, "cpu_freq", lambda: None)
    monkeypatch.setattr(stats.psutil, "cpu_count", lambda logical=True: 8 if logical else 4)
    monkeypatch.setattr(stats.psutil, "virtual_memory", lambda: NS(total=100, available=75, percent=25))
    sampler = stats.StatsSampler()
    monkeypatch.setattr(route, "sampler", sampler)
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        first = client.get("/system/stats").json()
        assert client.get("/system/stats").json() == first
        assert calls == [0.15]
        assert first["ram"]["used_bytes"] == 25
        assert first["cpu"]["usage_percent"] == 0
        assert first["cpu"]["clock_mhz"] is None
        assert first["warnings"] == ["GPU unavailable"]
        clock[0] += 3
        assert client.get("/system/stats").status_code == 200
        assert calls == [0.15, 0.15]


@pytest.mark.parametrize("value", [None, "N/A", "nan", "inf", "-1"])
def test_invalid_sensor_values_are_not_zero(value):
    assert stats.number(value) is None
