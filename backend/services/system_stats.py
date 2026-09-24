"""Read-only, bounded hardware sampling. No model loading or data-store access."""

import csv
import io
import json
import math
import os
import platform
import subprocess
import threading
import time
from datetime import datetime, timezone

import psutil


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (TypeError, ValueError):
        return None


def description(value):
    if not isinstance(value, str):
        return None
    value = value.strip()
    if value.lower() in ("", "n/a", "[n/a]", "[not supported]", "unknown", "none",
                         "not specified", "default string", "system product name",
                         "system manufacturer", "to be filled by o.e.m."):
        return None
    return value


def run_command(args):
    return subprocess.run(
        args, capture_output=True, text=True, timeout=4, check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    ).stdout


def read_gpus():
    fields = "index,name,utilization.gpu,temperature.gpu,clocks.current.graphics,clocks.current.memory,memory.total,memory.used,power.draw,driver_version,vbios_version"
    try:
        output = run_command(["nvidia-smi", f"--query-gpu={fields}", "--format=csv,noheader,nounits"])
        gpus = []
        for row in csv.reader(io.StringIO(output), skipinitialspace=True):
            if len(row) != 11:
                continue
            index, name, *values, driver, vbios = row
            usage, temp, clock, memory_clock, total, used, power = map(number, values)
            gpus.append({
                "id": index.strip(), "name": name.strip(), "usage_percent": usage,
                "temperature_c": temp, "clock_mhz": clock, "memory_clock_mhz": memory_clock,
                "vram_total_bytes": total * 1024 ** 2 if total is not None else None,
                "vram_used_bytes": used * 1024 ** 2 if used is not None else None,
                "power_w": power,
                "driver_version": description(driver), "vbios_version": description(vbios),
            })
        return gpus, None if gpus else "No NVIDIA GPU readings were returned."
    except (OSError, subprocess.SubprocessError):
        return [], "GPU readings unavailable. This version uses the NVIDIA driver monitoring tool."


WINDOWS_HARDWARE = r"""
$ErrorActionPreference = 'SilentlyContinue'
$ram = @(Get-CimInstance Win32_PhysicalMemory | Select-Object DeviceLocator,ConfiguredClockSpeed,Manufacturer,PartNumber,Capacity)
$computer = Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer,Model,SystemType
$boards = @(Get-CimInstance Win32_BaseBoard | Select-Object Manufacturer,Product,Version)
$bios = Get-CimInstance Win32_BIOS | Select-Object Manufacturer,SMBIOSBIOSVersion
$osInfo = Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber,OSArchitecture
$disks = @(Get-CimInstance Win32_DiskDrive | Select-Object Index,Model,FirmwareRevision,Size,InterfaceType,MediaType)
$sensors = @()
foreach ($namespace in @('root/LibreHardwareMonitor','root/OpenHardwareMonitor')) {
    $sensors = @(Get-CimInstance -Namespace $namespace -ClassName Sensor | Where-Object { $_.SensorType -eq 'Temperature' } | Select-Object Name,Value,Parent)
    if ($sensors.Count -gt 0) { break }
}
@{ram=$ram; sensors=$sensors; computer=$computer; boards=$boards; bios=$bios; os=$osInfo; disks=$disks} | ConvertTo-Json -Depth 4 -Compress
"""


def read_hardware():
    hardware = {
        "temperatures": [], "ram_modules": [], "physical_disks": [], "warnings": [],
        "system": {"os_name": f"{platform.system()} {platform.release()}",
                   "os_version": platform.version(), "architecture": platform.machine()},
    }
    if os.name == "nt":
        try:
            data = json.loads(run_command(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_HARDWARE]))
            hardware["temperatures"] = [
                {"name": entry["Name"], "temperature_c": number(entry.get("Value"))}
                for entry in data.get("sensors") or []
                if "cpu" in (str(entry.get("Parent", "")) + str(entry.get("Name", ""))).lower()
            ]
            hardware["ram_modules"] = [{
                "slot": description(entry.get("DeviceLocator")) or "Memory module",
                "speed_mts": number(entry.get("ConfiguredClockSpeed")) or None,
                "manufacturer": description(entry.get("Manufacturer")),
                "part_number": description(entry.get("PartNumber")),
                "capacity_bytes": number(entry.get("Capacity")),
            } for entry in data.get("ram") or []]
            computer, bios, operating_system = (data.get(key) or {} for key in ("computer", "bios", "os"))
            system = hardware["system"]
            system.update(
                manufacturer=description(computer.get("Manufacturer")), model=description(computer.get("Model")),
                description=description(computer.get("SystemType")),
                bios_manufacturer=description(bios.get("Manufacturer")), bios_version=description(bios.get("SMBIOSBIOSVersion")),
                os_build=description(operating_system.get("BuildNumber")),
                motherboards=[{"manufacturer": description(entry.get("Manufacturer")),
                               "model": description(entry.get("Product")), "version": description(entry.get("Version"))}
                              for entry in data.get("boards") or []],
            )
            for key, source in (("os_name", "Caption"), ("os_version", "Version"), ("architecture", "OSArchitecture")):
                system[key] = description(operating_system.get(source)) or system[key]
            hardware["physical_disks"] = [{
                "index": number(entry.get("Index")), "model": description(entry.get("Model")),
                "firmware_version": description(entry.get("FirmwareRevision")), "capacity_bytes": number(entry.get("Size")),
                "interface": description(entry.get("InterfaceType")), "description": description(entry.get("MediaType")),
            } for entry in data.get("disks") or []]
            if not computer or not bios or not hardware["ram_modules"] or not hardware["physical_disks"]:
                hardware["warnings"].append("Some hardware model or firmware details are unavailable.")
        except (OSError, subprocess.SubprocessError, ValueError, TypeError, KeyError, AttributeError):
            hardware["warnings"].append("Hardware model, firmware and memory configuration details could not be read.")
        return hardware
    try:
        sensors = psutil.sensors_temperatures()
        hardware["temperatures"] = [{"name": item.label or group, "temperature_c": number(item.current)} for group, items in sensors.items() if group.lower() in ("coretemp", "k10temp", "cpu_thermal", "zenpower") for item in items]
    except (AttributeError, OSError):
        pass
    return hardware


def cpu_name():
    if os.name == "nt":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
                return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    return platform.processor() or "CPU"


def read_drives():
    drives = []
    seen = set()
    for partition in psutil.disk_partitions(all=False):
        if partition.mountpoint in seen or "cdrom" in partition.opts:
            continue
        seen.add(partition.mountpoint)
        entry = {"mountpoint": partition.mountpoint, "device": partition.device, "filesystem": partition.fstype}
        try:
            usage = psutil.disk_usage(partition.mountpoint)
            entry.update(total_bytes=usage.total, used_bytes=usage.used, free_bytes=usage.free, usage_percent=usage.percent, error=None)
        except OSError:
            entry.update(total_bytes=None, used_bytes=None, free_bytes=None, usage_percent=None, error="Drive is unavailable or access was denied.")
        drives.append(entry)
    return drives


class StatsSampler:
    def __init__(self):
        self.lock = threading.Lock()
        self.cached = None
        self.sampled_at = -math.inf
        self.hardware_at = -math.inf
        self.hardware = {}
        self.hardware_sampled_at = None

    def snapshot(self):
        # The sync route runs in FastAPI's worker pool. Serialize callers and
        # share samples instead of launching multiple driver/WMI subprocesses.
        with self.lock:
            if self.cached is not None and time.monotonic() - self.sampled_at < 2:
                return self.cached
            if time.monotonic() - self.hardware_at >= 15:
                self.hardware = read_hardware()
                self.hardware_at = time.monotonic()
                self.hardware_sampled_at = datetime.now(timezone.utc).isoformat()
            temperatures = self.hardware.get("temperatures", [])
            ram_modules = self.hardware.get("ram_modules", [])
            errors = list(self.hardware.get("warnings", []))
            try:
                cpu_usage = psutil.cpu_percent(interval=0.15)
            except (OSError, psutil.Error):
                cpu_usage = None
                errors.append("CPU usage is unavailable.")
            try:
                frequency = psutil.cpu_freq()
            except (OSError, NotImplementedError, psutil.Error):
                frequency = None
            try:
                memory = psutil.virtual_memory()
                ram = {"total_bytes": memory.total, "used_bytes": memory.total - memory.available, "available_bytes": memory.available, "usage_percent": memory.percent, "modules": ram_modules}
            except (OSError, psutil.Error):
                ram = {"modules": ram_modules}
                errors.append("RAM usage is unavailable.")
            gpus, gpu_error = read_gpus()
            if gpu_error:
                errors.append(gpu_error)
            try:
                drives = read_drives()
            except (OSError, psutil.Error):
                drives = []
                errors.append("Drive information is unavailable.")
            self.cached = {
                "sampled_at": datetime.now(timezone.utc).isoformat(),
                "hardware_sampled_at": self.hardware_sampled_at,
                "system": self.hardware.get("system", {}), "physical_disks": self.hardware.get("physical_disks", []),
                "cpu": {"name": cpu_name(), "usage_percent": cpu_usage, "logical_cores": psutil.cpu_count(), "physical_cores": psutil.cpu_count(logical=False), "clock_mhz": number(frequency.current) if frequency else None, "clock_kind": "reported nominal" if platform.system() != "Linux" else "current", "temperatures": temperatures},
                "ram": ram, "gpus": gpus, "drives": drives, "warnings": errors,
            }
            self.sampled_at = time.monotonic()
            return self.cached


sampler = StatsSampler()
