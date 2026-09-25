import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentPage, DocumentAttachment, documentUrl } from "../../src/components/DocumentViewer";
import { buildContextMessages, getContextUsage } from "../../src/contextMemory";

const id = "a".repeat(32);
describe("chat document artifacts", () => {
  it("shows real view and download controls and escapes generated filenames", () => {
    const html = renderToStaticMarkup(<DocumentAttachment artifact={{ id, name: "<script>.docx", size: 1000 }} onView={() => {}} />);
    expect(html).toContain("&lt;script&gt;.docx");
    expect(html).toContain(">View</button>"); expect(html).toContain(">Download</button>");
  });
  it("renders document content as text with no executable markup or remote images", () => {
    const html = renderToStaticMarkup(<DocumentPage document={{ id, title: "A document", blocks: [
      { type: "paragraph", text: '<img src=x onerror="alert(1)">' },
      { type: "image", image_file: "https://remote.example/image.png" },
      { type: "table", headers: ["Item"], rows: [["Value"]] },
    ] }} />);
    expect(html).not.toContain("<img"); expect(html).not.toContain("remote.example");
    expect(html).toContain("&lt;img"); expect(html).toContain("<th>Item</th>");
  });
  it("rejects invalid attachment identifiers", () => {
    expect(() => documentUrl("../../secret")).toThrow();
    expect(documentUrl(id, "/download")).toContain(`/artifacts/${id}/download`);
  });
  it("retains document content for follow-up requests and budgets it", () => {
    const message = { role: "assistant", content: "Created report.docx", document_text: "A relevant fact. ".repeat(200) };
    expect(buildContextMessages([message], "", 0)[0].content).toContain("A relevant fact.");
    const usage = getContextUsage({ messages: [message], contextWindow: 8192, responseLength: 1024 });
    expect(usage.promptTokens).toBeGreaterThan(500);
  });
});
