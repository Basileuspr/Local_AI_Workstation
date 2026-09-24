import { describe, expect, it } from "vitest";
import { formatSystemSpecs } from "../../src/systemSpecs";

const GiB = 1024 ** 3;

describe("copied PC specs", () => {
  it("includes reported device models, versions and the captured usage sample", () => {
    const report = formatSystemSpecs({
      sampled_at: "2026-09-20T01:02:03Z", hardware_sampled_at: "2026-09-20T01:02:00Z",
      system: { manufacturer: "ASUS", description: "x64-based PC", os_name: "Windows 11 Home", os_version: "10.0.26200", os_build: "26200", architecture: "64-bit", bios_version: "1720", motherboards: [{ manufacturer: "Board maker", model: "Board A", version: "Rev 1" }] },
      cpu: { name: "Test CPU", physical_cores: 12, logical_cores: 20, usage_percent: 0, clock_mhz: 3600, clock_kind: "reported nominal", temperatures: [{ name: "CPU Package", temperature_c: 42 }] },
      ram: { total_bytes: 32 * GiB, used_bytes: 8 * GiB, available_bytes: 24 * GiB, usage_percent: 25, modules: [{ slot: "DIMM1", manufacturer: "RAM maker", part_number: "Part-A", capacity_bytes: 16 * GiB, speed_mts: 3200 }, { slot: "DIMM2", part_number: "Part-B" }] },
      gpus: [{ id: "0", name: "GPU A", driver_version: "616.64", vbios_version: "94.04.3a", usage_percent: 0, vram_used_bytes: 0, vram_total_bytes: 8 * GiB }, { id: "1", name: "GPU B" }],
      physical_disks: [{ index: 0, model: "SSD A", firmware_version: "FW1", capacity_bytes: 500 * GiB, interface: "SCSI", description: "Fixed hard disk media" }],
      drives: [{ mountpoint: "C:\\", filesystem: "NTFS", total_bytes: 500 * GiB, used_bytes: 0, free_bytes: 500 * GiB, usage_percent: 0 }, { mountpoint: "E:\\", error: "Drive is unavailable" }],
    }, { copiedAt: new Date("2026-09-20T01:02:05Z") });
    for (const expected of [
      "Copied at: 2026-09-20T01:02:05.000Z", "Readings sampled at: 2026-09-20T01:02:03.000Z", "Hardware details sampled at: 2026-09-20T01:02:00.000Z",
      "Windows 11 Home", "10.0.26200", "1720", "Board A; revision: Rev 1", "Test CPU", "Physical cores: 12; logical processors: 20", "Utilization: 0.0%", "Clock (reported nominal): 3.60 GHz", "CPU Package: 42.0 °C",
      "Total usable: 32.0 GiB; used: 8.0 GiB; available: 24.0 GiB", "DIMM1", "Part-A", "Part-B", "16.0 GiB; configured speed: 3200 MT/s",
      "GPU 0 — GPU A", "GPU 1 — GPU B", "Driver version: 616.64; VBIOS version: 94.04.3a", "VRAM total: 8.0 GiB; used: 0.0 GiB; free: 8.0 GiB", "Disk 0 — SSD A", "Firmware version: FW1", "C:\\", "E:\\", "Drive is unavailable",
    ]) expect(report).toContain(expected);
    expect(report).not.toMatch(/undefined|NaN|Invalid Date/);
  });

  it("labels stale readings and includes collection warnings without exposing unrelated fields", () => {
    const report = formatSystemSpecs({
      sampled_at: "2026-09-19T03:00:00Z", warnings: ["GPU unavailable"], api_token: "secret-token", messages: ["private chat"],
    }, { error: "Backend unavailable. Retrying…" });
    expect(report).toContain("last successful sample is stale");
    expect(report).toContain("Backend unavailable");
    expect(report).toContain("Readings sampled at: 2026-09-19T03:00:00.000Z");
    expect(report).toContain("Warnings\n  GPU unavailable");
    expect(report).not.toContain("secret-token");
    expect(report).not.toContain("private chat");
  });

  it("reports missing hardware and non-finite readings as unavailable, not zero", () => {
    const report = formatSystemSpecs({ sampled_at: "bad-date", cpu: { usage_percent: NaN }, ram: { total_bytes: Infinity } });
    expect(report).toContain("Readings sampled at: Unavailable");
    expect(report).toContain("Model / description: Unavailable");
    expect(report).toContain("Utilization: Unavailable");
    expect(report).toContain("Total usable: Unavailable");
    expect(report).not.toMatch(/NaN|undefined|Infinity|Invalid Date|0\.0%/);
  });
});
