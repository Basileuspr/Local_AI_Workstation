import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import CpuPerformance from "../../src/components/CpuPerformance";

it("distinguishes model time from overlapped preparation work and real zero", () => {
  const html = renderToStaticMarkup(<CpuPerformance analysis report={{mode:"light",workers:1,budget_bytes:64*1024**2,preparation_wait_seconds:0,preparation_worker_seconds:0.2}} timings={{vision_seconds:3}} />);
  expect(html).toContain("0.00s");
  expect(html).toContain("3.00s");
  expect(html).toContain("summed across workers");
  expect(html).not.toContain("NaN");
  expect(renderToStaticMarkup(<CpuPerformance />)).toBe("");
});
