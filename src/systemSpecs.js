export function formatNumber(value, unit = "", digits = 0) {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(digits)}${unit}` : "Unavailable";
}

export function formatBytes(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  const unit = value >= 1024 ** 4 ? "TiB" : "GiB";
  return `${(value / 1024 ** (unit === "TiB" ? 4 : 3)).toFixed(1)} ${unit}`;
}

function text(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "Unavailable";
}

function timestamp(value) {
  const date = value ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : "Unavailable";
}

export function formatSystemSpecs(stats, { error = "", copiedAt = new Date() } = {}) {
  const { cpu = {}, ram = {}, gpus = [], drives = [], system = {}, physical_disks: disks = [], warnings = [] } = stats;
  const lines = [
    "Local AI Workstation — PC specs",
    `Copied at: ${timestamp(copiedAt)}`,
    `Readings sampled at: ${timestamp(stats.sampled_at)}`,
    `Hardware details sampled at: ${timestamp(stats.hardware_sampled_at)}`,
    `State: ${error ? `Readings interrupted — last successful sample is stale. ${error}` : "Latest successful sample (live readings refresh about every 5 seconds)."}`,
    "",
    "System",
    `  Manufacturer: ${text(system.manufacturer)}`,
    `  Model: ${text(system.model)}`,
    `  Description: ${text(system.description)}`,
    `  OS: ${text(system.os_name)}`,
    `  OS version: ${text(system.os_version)}; build: ${text(system.os_build)}`,
    `  Architecture: ${text(system.architecture)}`,
    `  BIOS: ${text(system.bios_manufacturer)}; version: ${text(system.bios_version)}`,
  ];
  for (const board of system.motherboards || []) {
    lines.push(`  Motherboard: ${text(board.manufacturer)}; ${text(board.model)}; revision: ${text(board.version)}`);
  }
  if (!system.motherboards?.length) lines.push("  Motherboard: Unavailable");
  lines.push(
    "", "CPU",
    `  Model / description: ${text(cpu.name)}`,
    `  Physical cores: ${formatNumber(cpu.physical_cores)}; logical processors: ${formatNumber(cpu.logical_cores)}`,
    `  Utilization: ${formatNumber(cpu.usage_percent, "%", 1)}`,
    `  Clock (${cpu.clock_kind || "reported"}): ${formatNumber(cpu.clock_mhz == null ? null : cpu.clock_mhz / 1000, " GHz", 2)}`,
  );
  for (const sensor of cpu.temperatures || []) {
    lines.push(`  Temperature — ${text(sensor.name)}: ${formatNumber(sensor.temperature_c, " °C", 1)}`);
  }
  if (!cpu.temperatures?.length) lines.push("  Temperature: Unavailable (not exposed by the system)");
  lines.push(
    "", "RAM",
    `  Total usable: ${formatBytes(ram.total_bytes)}; used: ${formatBytes(ram.used_bytes)}; available: ${formatBytes(ram.available_bytes)}`,
    `  Utilization: ${formatNumber(ram.usage_percent, "%", 1)}`,
  );
  for (const module of ram.modules || []) {
    lines.push(
      `  Module — ${text(module.slot)}:`,
      `    Manufacturer: ${text(module.manufacturer)}; part number: ${text(module.part_number)}`,
      `    Capacity: ${formatBytes(module.capacity_bytes)}; configured speed: ${formatNumber(module.speed_mts, " MT/s")}`,
    );
  }
  if (!ram.modules?.length) lines.push("  Module details: Unavailable");
  lines.push("", "GPU");
  for (const gpu of gpus) {
    const free = gpu.vram_total_bytes != null && gpu.vram_used_bytes != null ? Math.max(0, gpu.vram_total_bytes - gpu.vram_used_bytes) : null;
    lines.push(
      `  GPU ${gpu.id} — ${text(gpu.name)}`,
      `    Driver version: ${text(gpu.driver_version)}; VBIOS version: ${text(gpu.vbios_version)}`,
      `    Utilization: ${formatNumber(gpu.usage_percent, "%", 1)}; temperature: ${formatNumber(gpu.temperature_c, " °C", 1)}`,
      `    Graphics clock: ${formatNumber(gpu.clock_mhz, " MHz")}; memory clock: ${formatNumber(gpu.memory_clock_mhz, " MHz")}`,
      `    VRAM total: ${formatBytes(gpu.vram_total_bytes)}; used: ${formatBytes(gpu.vram_used_bytes)}; free: ${formatBytes(free)}`,
      `    Power draw: ${formatNumber(gpu.power_w, " W", 1)}`,
    );
  }
  if (!gpus.length) lines.push("  Unavailable. GPU monitoring currently supports NVIDIA devices.");
  lines.push("", "Physical disks");
  for (const disk of disks) {
    lines.push(
      `  Disk ${formatNumber(disk.index)} — ${text(disk.model)}`,
      `    Firmware version: ${text(disk.firmware_version)}; capacity: ${formatBytes(disk.capacity_bytes)}`,
      `    Reported interface: ${text(disk.interface)}; description: ${text(disk.description)}`,
    );
  }
  if (!disks.length) lines.push("  Model and firmware details: Unavailable");
  lines.push("", "Mounted volumes (multiple volumes may share a physical disk)");
  for (const drive of drives) {
    lines.push(
      `  ${text(drive.mountpoint)} — ${text(drive.filesystem)}`,
      `    Total: ${formatBytes(drive.total_bytes)}; used: ${formatBytes(drive.used_bytes)}; free: ${formatBytes(drive.free_bytes)}`,
      `    Space used: ${formatNumber(drive.usage_percent, "%", 1)}`,
    );
    if (drive.error) lines.push(`    Status: ${drive.error}`);
  }
  if (!drives.length) lines.push("  Unavailable");
  if (warnings.length) lines.push("", "Warnings", ...warnings.map((warning) => `  ${warning}`));
  lines.push("", "Capacities use GiB / TiB. Hardware details and CPU temperature sensors refresh about every 15 seconds.", "Unavailable means the system did not report a value.");
  return lines.join("\n");
}
