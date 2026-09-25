import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import PCBridge, { BridgeJobs } from "../../src/components/PCBridge";
import { bridgeJobStatus } from "../../src/bridgeApi";

describe("PC bridge", () => {
  it("starts visibly off and explains what data delegation sends", () => {
    const html = renderToStaticMarkup(<PCBridge />);
    expect(html).toContain("Network bridge off");
    expect(html).toContain("Start bridge");
    expect(html).toContain("Only this prompt and these settings are sent");
    expect(html).toContain("does not send chat history");
    expect(html).toContain("Pair PCs");
  });
  it("does not present disconnected jobs as failed or available for blind reexecution", () => {
    const job = { id: "one", direction: "outgoing", status: "running", connection_error: "Lost connection", payload: { kind: "chat", prompt: "Hello" } };
    expect(bridgeJobStatus(job)).toContain("unknown");
    const html = renderToStaticMarkup(<BridgeJobs jobs={[job]} peers={[]} />);
    expect(html).toContain("Retry delivery with same ID");
    expect(html).not.toContain("Remove bridge record");
    expect(html).not.toContain("View result");
  });
  it("offers returned results for local saving and retains cancellation uncertainty", () => {
    const job = { id: "one", direction: "outgoing", status: "completed", payload: { kind: "image", prompt: "A tree" } };
    const html = renderToStaticMarkup(<BridgeJobs jobs={[job]} peers={[]} />);
    expect(html).toContain("Save result to Chats");
    expect(html).toContain("View result");
    expect(html).not.toContain("Cancel job");
    expect(bridgeJobStatus({ status: "queued", cancel_requested: true })).toContain("awaiting worker");
  });
});
