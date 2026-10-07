import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentPage, DocumentAttachment, documentUrl } from "../../src/components/DocumentViewer";
import { buildContextMessages, getContextUsage } from "../../src/contextMemory";
import {documentAppendPrompt, documentCreatePrompt, latestDocumentContextMessages} from '../../src/chatDocuments';

const id = "a".repeat(32);
describe("chat document artifacts", () => {
  it("shows real view and download controls and escapes generated filenames", () => {
    const html = renderToStaticMarkup(<DocumentAttachment artifact={{ id, name: "<script>.docx", size: 1000 }} onView={() => {}} />);
    expect(html).toContain("&lt;script&gt;.docx");
    expect(html).toContain(">View</button>"); expect(html).toContain(">Download</button>");
    expect(html).toContain('Add to document');
  });
  it('shows the saved version', () => {
    const html = renderToStaticMarkup(<DocumentAttachment artifact={{id, name:'report.docx', version:3}} />);
    expect(html).toContain('Version 3');
  });
  it('preserves a multiline draft while selecting an attachment without exposing its identifier', () => {
    expect(documentAppendPrompt(id, 'Add examples\nThen a conclusion')).toBe('/docx append Add examples\nThen a conclusion');
    expect(documentAppendPrompt(id, '/docx append existing draft')).toBe('/docx append existing draft');
    expect(documentAppendPrompt(id, '/docx create a report')).toBe('/docx append create a report');
    expect(documentAppendPrompt(id, '')).not.toContain(id);
    expect(() => documentAppendPrompt('../outside', 'draft')).toThrow();
  });
  it('switches from adding to creating without duplicating commands or losing the draft', () => {
    expect(documentCreatePrompt('/docx append Section B\nMore details')).toBe('/docx Section B\nMore details');
    expect(documentCreatePrompt('/docx Section B')).toBe('/docx Section B');
    expect(documentAppendPrompt(id, '/docxtest is literal text')).toBe('/docx append /docxtest is literal text');
  });
  it('sends only the latest cumulative text per document and preserves saved history', () => {
    const family = id, second = 'b'.repeat(32), other = 'c'.repeat(32);
    const messages = [
      {role:'assistant',content:'Created',document_text:'First section',artifacts:[{kind:'docx',id:family,document_id:family}]},
      {role:'assistant',content:'Separate',document_text:'Independent document',artifacts:[{kind:'docx',id:other}]},
      {role:'assistant',content:'Added',document_text:'First section\nSecond section',artifacts:[{kind:'docx',id:second,document_id:family}]},
    ];
    const normalized = latestDocumentContextMessages(messages);
    expect(normalized[0].document_text).toBeUndefined();
    expect(normalized[1].document_text).toBe('Independent document');
    expect(normalized[2]).toBe(messages[2]);
    expect(messages[0].document_text).toBe('First section');
    const context = buildContextMessages(messages,'',0);
    expect(context[0].content).toBe('Created');
    expect(context[1].content).toContain('Independent document');
    expect(context[2].content).toContain('Second section');
  });
  it('keeps legacy document text and avoids multiplying token cost across additions', () => {
    const legacy = {role:'assistant',content:'Created',document_text:'Legacy text'};
    expect(latestDocumentContextMessages([legacy])[0]).toBe(legacy);
    const versions = Array.from({length:20}, (_,index) => ({role:'assistant',content:'Saved',document_text:'Text '.repeat(1000),artifacts:[{kind:'docx',id:String(index).padStart(32,'0'),document_id:id}]}));
    const usage = getContextUsage({messages:versions,contextWindow:8192,responseLength:1024});
    const single = getContextUsage({messages:versions.slice(-1),contextWindow:8192,responseLength:1024});
    expect(usage.promptTokens - single.promptTokens).toBeLessThan(300);
    expect(usage.promptTokens).toBeGreaterThan(1000);
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
