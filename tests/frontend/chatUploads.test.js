/**
 * Tests for the shared upload implementation.
 *
 * Both upload surfaces (the attachment menu and the transcript's
 * button/drag-and-drop) now route through this module, so a change here
 * reaches every entry point at once. That is the point of the consolidation,
 * and also the reason it needs covering.
 */

import { describe, expect, it, vi } from "vitest";
import {
  MAX_IMAGE_BYTES,
  buildDocumentMessage,
  buildImageMessage,
  isImageFile,
  readImageFile,
  validateImageFile,
} from "../../src/useChatUploads.js";

const fakeFile = (overrides = {}) => ({
  name: "cat.png",
  type: "image/png",
  size: 2048,
  ...overrides,
});

describe("isImageFile", () => {
  it.each(["image/png", "image/jpeg", "image/webp"])("accepts %s", (type) => {
    expect(isImageFile(fakeFile({ type }))).toBe(true);
  });

  it.each(["application/pdf", "text/plain", "image/gif", "image/svg+xml", ""])(
    "rejects %s",
    (type) => {
      expect(isImageFile(fakeFile({ type }))).toBe(false);
    }
  );

  it("tolerates a missing file", () => {
    expect(isImageFile(undefined)).toBe(false);
    expect(isImageFile(null)).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("accepts a normal image", () => {
    expect(validateImageFile(fakeFile())).toBeNull();
  });

  it("accepts a file exactly at the size limit", () => {
    expect(validateImageFile(fakeFile({ size: MAX_IMAGE_BYTES }))).toBeNull();
  });

  it("rejects a file over the size limit with the user-facing wording", () => {
    expect(validateImageFile(fakeFile({ size: MAX_IMAGE_BYTES + 1 }))).toBe(
      "Image is larger than 10 MB"
    );
  });

  it("rejects an unsupported format", () => {
    expect(validateImageFile(fakeFile({ type: "image/gif" }))).toBe("Unsupported image format");
  });

  it("rejects a missing file", () => {
    expect(validateImageFile(null)).toBe("No image selected");
  });
});

describe("buildImageMessage", () => {
  const message = buildImageMessage(
    fakeFile({ name: "photo.png", size: 3072 }),
    "data:image/png;base64,AAAA",
    "AAAA"
  );

  it("is authored as a user turn", () => {
    expect(message.role).toBe("user");
  });

  it("labels the message with the file name and rounded size", () => {
    expect(message.content).toBe("[Image uploaded: photo.png (3 KB)]");
  });

  it("carries the raw payload the model consumes", () => {
    expect(message.images).toEqual(["AAAA"]);
  });

  it("carries a preview the interface can draw", () => {
    expect(message.imagePreviews).toHaveLength(1);
    expect(message.imagePreviews[0].src).toBe("data:image/png;base64,AAAA");
    expect(message.imagePreviews[0].name).toBe("photo.png");
    expect(message.imagePreviews[0].type).toBe("image/png");
    expect(message.imagePreviews[0].size).toBe(3072);
  });

  it("assigns stable ids to the message and its preview", () => {
    expect(message.id).toBeTruthy();
    expect(message.imagePreviews[0].id).toBeTruthy();
    expect(message.id).not.toBe(message.imagePreviews[0].id);
  });

  it("gives every call distinct ids", () => {
    const other = buildImageMessage(fakeFile(), "data:image/png;base64,BBBB", "BBBB");

    expect(other.id).not.toBe(message.id);
  });

  it("keeps the preview payload aligned with the raw payload", () => {
    // session_store dedups these positionally by comparing the data URL's
    // payload against the raw entry; they must stay in step.
    expect(message.imagePreviews[0].src.split(",")[1]).toBe(message.images[0]);
  });
});

describe("buildDocumentMessage", () => {
  const message = buildDocumentMessage({
    filename: "notes.txt",
    char_count: 42,
    text: "the body of the document",
  });

  it("is authored as a user turn", () => {
    expect(message.role).toBe("user");
  });

  it("leads with a header the transcript and exports can summarize on", () => {
    expect(message.content.split("\n")[0]).toBe("[File uploaded: notes.txt (42 characters)]");
  });

  it("inlines the document body for model context", () => {
    expect(message.content).toContain("the body of the document");
  });

  it("carries no image fields", () => {
    expect(message.images).toBeUndefined();
    expect(message.imagePreviews).toBeUndefined();
  });

  it("assigns a stable id", () => {
    expect(message.id).toBeTruthy();
  });

  it("surfaces scanned-PDF OCR usage in the transcript header", () => {
    const ocrMessage = buildDocumentMessage({
      filename: "scan.pdf",
      char_count: 26,
      text: "SCANNED SENTINEL 731",
      page_count: 2,
      ocr_pages: [1, 2],
      ocr_model: "qwen3-vl:8b",
    });

    expect(ocrMessage.content.split("\n")[0]).toBe(
      "[File uploaded: scan.pdf (26 characters; OCR 2/2 pages)]"
    );
  });
});

describe("readImageFile", () => {
  class FakeReader {
    readAsDataURL() {
      this.result = "data:image/png;base64,QUJD";
      this.onload();
    }
  }

  class FailingReader {
    readAsDataURL() {
      this.onerror();
    }
  }

  class PayloadlessReader {
    readAsDataURL() {
      this.result = "data:image/png;base64,";
      this.onload();
    }
  }

  it("splits a data URL into the preview URL and raw payload", async () => {
    vi.stubGlobal("FileReader", FakeReader);

    await expect(readImageFile(fakeFile())).resolves.toEqual({
      dataUrl: "data:image/png;base64,QUJD",
      base64: "QUJD",
    });

    vi.unstubAllGlobals();
  });

  it("rejects when the reader fails", async () => {
    vi.stubGlobal("FileReader", FailingReader);

    await expect(readImageFile(fakeFile())).rejects.toThrow("Could not read image");

    vi.unstubAllGlobals();
  });

  it("rejects when the data URL carries no payload", async () => {
    vi.stubGlobal("FileReader", PayloadlessReader);

    await expect(readImageFile(fakeFile())).rejects.toThrow("Could not read image data");

    vi.unstubAllGlobals();
  });
});
