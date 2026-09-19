import { describe, expect, it } from "vitest";
import { arrangeFaces } from "../../src/faceApi";

const face = (id, overrides = {}) => ({
  id,
  source_name: overrides.source || "a.png",
  state: overrides.state || "pending",
  flags: overrides.flags || [],
  cluster: overrides.cluster ?? 0,
  outlier: overrides.outlier || false,
  duplicate_of: overrides.duplicate || null,
  created_at: overrides.created || "2026-09-01",
  metrics: {
    confidence: overrides.confidence ?? 0.9,
    face_width: overrides.size ?? 100,
    face_height: overrides.size ?? 100,
    sharpness: overrides.sharpness ?? 50,
  },
});

const base = { sort: "added", order: "desc", filter: "all", search: "", scores: null, threshold: 0.5 };

describe("face contact sheet", () => {
  it("sorts by each supported field", () => {
    const faces = [
      face("a", { confidence: 0.5, size: 300, sharpness: 10, source: "zebra.png", cluster: 2 }),
      face("b", { confidence: 0.9, size: 100, sharpness: 90, source: "apple.png", cluster: 0 }),
      face("c", { confidence: 0.7, size: 200, sharpness: 50, source: "mango.png", cluster: 1 }),
    ];
    const ids = (options) => arrangeFaces(faces, { ...base, ...options }).map((item) => item.id);
    expect(ids({ sort: "confidence" })).toEqual(["b", "c", "a"]);
    expect(ids({ sort: "size" })).toEqual(["a", "c", "b"]);
    expect(ids({ sort: "sharpness" })).toEqual(["b", "c", "a"]);
    expect(ids({ sort: "cluster", order: "asc" })).toEqual(["b", "c", "a"]);
    expect(ids({ sort: "filename", order: "asc" })).toEqual(["b", "c", "a"]);
  });

  it("ranks by similarity to a reference when scores are present", () => {
    const faces = [face("a"), face("b"), face("c")];
    const scores = { a: 0.2, b: 1.0, c: 0.6 };
    expect(arrangeFaces(faces, { ...base, sort: "similarity", scores }).map((item) => item.id))
      .toEqual(["b", "c", "a"]);
  });

  it("filters to matches at or above the threshold", () => {
    const faces = [face("a"), face("b"), face("c")];
    const scores = { a: 0.2, b: 1.0, c: 0.6 };
    const shown = arrangeFaces(faces, { ...base, filter: "similar", scores, threshold: 0.5 });
    expect(shown.map((item) => item.id).sort()).toEqual(["b", "c"]);
  });

  it("filters by review state, flags, duplicates and outliers", () => {
    const faces = [
      face("a", { state: "accepted" }),
      face("b", { state: "rejected", flags: ["blurry"] }),
      face("c", { duplicate: "a", outlier: true }),
    ];
    const ids = (filter) => arrangeFaces(faces, { ...base, filter }).map((item) => item.id);
    expect(ids("accepted")).toEqual(["a"]);
    expect(ids("rejected")).toEqual(["b"]);
    expect(ids("pending")).toEqual(["c"]);
    expect(ids("flagged")).toEqual(["b"]);
    expect(ids("duplicates")).toEqual(["c"]);
    expect(ids("outliers")).toEqual(["c"]);
    expect(ids("all")).toHaveLength(3);
  });

  it("searches the originating filename so a crop stays traceable", () => {
    const faces = [face("a", { source: "hero_front.png" }), face("b", { source: "villain.png" })];
    expect(arrangeFaces(faces, { ...base, search: "hero" }).map((item) => item.id)).toEqual(["a"]);
    expect(arrangeFaces(faces, { ...base, search: "HERO" }).map((item) => item.id)).toEqual(["a"]);
  });

  it("keeps faces without a similarity score out of the way instead of on top", () => {
    const faces = [face("a"), face("scored")];
    const shown = arrangeFaces(faces, { ...base, sort: "similarity", scores: { scored: 0.3 } });
    expect(shown[0].id).toBe("scored");
  });
});
