import json
import subprocess
from types import SimpleNamespace as NS

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from services import system_stats as stats


def test_gpu_units_multiple_devices_and_unsupported_sensors(monkeypatch):
    monkeypatch.setattr(stats, "run_command", lambda args: '0, GPU A, 0, 44, 1815, 7001, 8192, 2048, 60.5, 616.64, 94.04.3a\n1, GPU B, [N/A], [Not Supported], 1200, 5000, 4096, 0, N/A, 616.64, [N/A]\n')
    gpus, error = stats.read_gpus()
    assert error is None
    assert len(gpus) == 2
    assert gpus[0]["usage_percent"] == 0
    assert gpus[0]["vram_total_bytes"] == 8 * 1024 ** 3
    assert gpus[1]["temperature_c"] is None
    assert gpus[1]["usage_percent"] is None
    assert gpus[1]["vram_used_bytes"] == 0
    assert gpus[0]["driver_version"] == "616.64"
    assert gpus[0]["vbios_version"] == "94.04.3a"
    assert gpus[1]["vbios_version"] is None


def test_windows_hardware_reports_models_versions_and_memory_modules(monkeypatch):
    monkeypatch.setattr(stats, "os", NS(name="nt"))
    payload = {
        "computer": {"Manufacturer": "Example", "Model": "System Product Name", "SystemType": "x64-based PC"},
        "os": {"Caption": "Windows 11", "Version": "10.0.26200", "BuildNumber": "26200", "OSArchitecture": "64-bit"},
        "boards": [{"Manufacturer": "Board maker", "Product": "Board A", "Version": "Rev 2"}],
        "bios": {"Manufacturer": "BIOS maker", "SMBIOSBIOSVersion": "1720"},
        "ram": [{"DeviceLocator": "DIMM1", "Manufacturer": "RAM maker", "PartNumber": " Part-A  ", "Capacity": 16 * 1024 ** 3, "ConfiguredClockSpeed": 3200}],
        "disks": [{"Index": 0, "Model": "SSD A", "FirmwareRevision": "1.2", "Size": 500 * 1024 ** 3, "InterfaceType": "SCSI", "MediaType": "Fixed hard disk media"}],
        "sensors": [{"Name": "CPU Package", "Value": 44, "Parent": "/cpu/0"}, {"Name": "GPU", "Value": 55, "Parent": "/gpu/0"}],
    }
    monkeypatch.setattr(stats, "run_command", lambda args: json.dumps(payload))
    hardware = stats.read_hardware()
    assert hardware["system"]["model"] is None
    assert hardware["system"]["os_name"] == "Windows 11"
    assert hardware["system"]["bios_version"] == "1720"
    assert hardware["system"]["motherboards"] == [{"manufacturer": "Board maker", "model": "Board A", "version": "Rev 2"}]
    assert hardware["ram_modules"][0]["part_number"] == "Part-A"
    assert hardware["ram_modules"][0]["capacity_bytes"] == 16 * 1024 ** 3
    assert hardware["physical_disks"][0]["index"] == 0
    assert hardware["physical_disks"][0]["firmware_version"] == "1.2"
    assert hardware["temperatures"] == [{"name": "CPU Package", "temperature_c": 44}]
    assert hardware["warnings"] == []


@pytest.mark.parametrize("response", ["not JSON", "{}", '{"ram":null,"sensors":null,"disks":null,"boards":null}', "null"])
def test_unavailable_windows_metadata_keeps_basic_system_information(monkeypatch, response):
    monkeypatch.setattr(stats, "os", NS(name="nt"))
    monkeypatch.setattr(stats, "run_command", lambda args: response)
    hardware = stats.read_hardware()
    assert hardware["system"]["os_name"]
    assert hardware["ram_modules"] == []
    assert hardware["physical_disks"] == []
    assert hardware["warnings"]


def test_windows_hardware_timeout_preserves_partial_dashboard(monkeypatch):
    monkeypatch.setattr(stats, "os", NS(name="nt"))
    def timeout(args):
        raise subprocess.TimeoutExpired("powershell.exe", 4)
    monkeypatch.setattr(stats, "run_command", timeout)
    hardware = stats.read_hardware()
    assert hardware["system"]["os_version"]
    assert hardware["warnings"]


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
    hardware_calls = []
    monkeypatch.setattr(stats.time, "monotonic", lambda: clock[0])
    monkeypatch.setattr(stats, "read_hardware", lambda: hardware_calls.append(clock[0]) or {"system": {"bios_version": "1720"}, "physical_disks": [{"model": "SSD A"}], "warnings": ["Some hardware details unavailable"]})
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
        assert first["warnings"] == ["Some hardware details unavailable", "GPU unavailable"]
        assert first["system"]["bios_version"] == "1720"
        assert first["physical_disks"] == [{"model": "SSD A"}]
        assert first["hardware_sampled_at"]
        clock[0] += 3
        second = client.get("/system/stats").json()
        assert second["hardware_sampled_at"] == first["hardware_sampled_at"]
        assert second["warnings"] == first["warnings"]
        assert hardware_calls == [100]
        assert calls == [0.15, 0.15]
        clock[0] += 13
        assert client.get("/system/stats").status_code == 200
        assert hardware_calls == [100, 116]


@pytest.mark.parametrize("value", [None, "N/A", "nan", "inf", "-1"])
def test_invalid_sensor_values_are_not_zero(value):
    assert stats.number(value) is None
