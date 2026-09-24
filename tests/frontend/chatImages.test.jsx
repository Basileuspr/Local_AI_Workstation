import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { localImageUrl, chatImage } from "../../src/chatImages";
import { formatSoftwareSpecs } from "../../src/softwareSpecs";
import MarkdownMessage from "../../src/components/MarkdownMessage";

describe("inline chat images and destinations", () => {
  it("accepts local image references and blocks external and executable URLs", () => {
    expect(localImageUrl("/image-generation/outputs/test.png")).toContain("/image-generation/outputs/test.png");
    expect(localImageUrl("data:image/png;base64,YQ==")).toBe("data:image/png;base64,YQ==");
    for (const url of ["https://remote.example/image.png", "file:///secret.png", "javascript:alert(1)", "/system/logs/export", "data:text/html;base64,YQ=="]) expect(localImageUrl(url)).toBeNull();
  });
  it("keeps the stored image id separate from its unique viewer id", () => {
    const result = chatImage({ id: "image-id", name: "Example" }, "message-id", "session-id", 0, "/sessions/image.png");
    expect(result.id).toBe("message-id:image-id"); expect(result.image_id).toBe("image-id");
    expect(result.session_id).toBe("session-id");
    expect(chatImage({ id: "local" }, "m", "s", 0, "data:image/png;base64,YQ==").session_id).toBeUndefined();
  });
  it("makes local markdown images keyboard-clickable without executing raw HTML or rendering remote trackers", () => {
    const html = renderToStaticMarkup(<MarkdownMessage>{"Viewed image: ![Sample](/image-generation/outputs/test.png)\n![Remote](https://evil.test/tracker.png)"}</MarkdownMessage>);
    expect(html).toContain('aria-label="Enlarge Sample"');
    expect(html).not.toContain('src="https://evil.test');
    expect(html).toContain("![Remote]");
  });
});

it("copies only the selected software sections with its sample time", () => {
  const report = formatSoftwareSpecs({ sampled_at: "now", frontend: { privateMarker: "not selected" }, dependencies: { python: "3.13" }, models: { name: "not selected" } }, ["dependencies"]);
  expect(report).toContain("3.13"); expect(report).toContain("Snapshot: now");
  expect(report).not.toContain("not selected"); expect(report).not.toContain("privateMarker");
});
