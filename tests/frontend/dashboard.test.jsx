import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DashboardReadings, formatBytes, formatNumber } from "../../src/components/Dashboard";
import DashboardReset from "../../src/components/DashboardReset";

describe("hardware Dashboard", () => {
  it("offers four independent data actions with explicit privacy and recovery boundaries", () => {
    const html = renderToStaticMarkup(<DashboardReset />);
    for (const text of ["SAVE METADATA", "RESET APP DATA &amp; SANITIZE APPLICATION", "EXPORT BACK-UP", "IMPORT BACK-UP", "It cannot restore app data", "It includes locked images", "separate recovery folder"]) expect(html).toContain(text);
    expect(html).not.toContain("Save metadata ZIP &amp; review reset");
  });
  it("distinguishes unavailable sensors from real zero readings", () => {
    expect(formatNumber(null, "%")).toBe("Unavailable");
    expect(formatNumber(0, "%")).toBe("0%");
    expect(formatBytes(undefined)).toBe("Unavailable");
    expect(formatBytes(8 * 1024 ** 3)).toBe("8.0 GiB");
    expect(formatBytes(2 * 1024 ** 4)).toBe("2.0 TiB");
    const html = renderToStaticMarkup(<DashboardReadings stats={{cpu: {usage_percent: 0}, ram: {}}} />);
    expect(html).toContain("CPU temperature is not exposed");
    expect(html).toContain("0%");
    expect(html).toContain("GPU / VRAM");
    expect(html).not.toContain("NaN");
  });
  it("renders GPUs and drives individually, retaining unavailable volumes", () => {
    const html = renderToStaticMarkup(<DashboardReadings stats={{
      gpus: [{id: "0", name: "GPU A", vram_used_bytes: 0, vram_total_bytes: 8 * 1024 ** 3}, {id: "1", name: "GPU B"}],
      drives: [{mountpoint: "C:\\", total_bytes: 100, used_bytes: 60, free_bytes: 40, usage_percent: 60}, {mountpoint: "E:\\", error: "Drive is unavailable"}],
    }} />);
    for (const text of ["GPU A", "GPU B", "C:\\", "E:\\", "Drive is unavailable", "8.0 GiB"]) expect(html).toContain(text);
    expect(html).not.toContain("NaN");
  });
});
