import { describe, expect, it } from "vitest";
import { curationGroups } from "../../src/faceApi";

const member = (id, similarity, overrides = {}) => ({
  face_id: id,
  dataset_id: "ds",
  state: overrides.state || "accepted",
  similarity,
  drift: overrides.drift || false,
});

describe("character curation groups", () => {
  it("orders accepted faces most representative first", () => {
    const character = {
      members: [member("a", 0.71), member("b", 0.95), member("c", 0.83)],
    };
    expect(curationGroups(character).accepted.map((m) => m.face_id)).toEqual(["b", "c", "a"]);
  });

  it("keeps rejected faces listed separately so they can be restored", () => {
    const character = {
      members: [member("a", 0.9), member("b", 0.4, { state: "rejected" })],
    };
    const groups = curationGroups(character);
    expect(groups.accepted.map((m) => m.face_id)).toEqual(["a"]);
    expect(groups.rejected.map((m) => m.face_id)).toEqual(["b"]);
  });

  it("surfaces drifting faces without removing them from the accepted list", () => {
    const character = {
      members: [member("a", 0.95), member("b", 0.42, { drift: true })],
    };
    const groups = curationGroups(character);
    expect(groups.drifting.map((m) => m.face_id)).toEqual(["b"]);
    expect(groups.accepted).toHaveLength(2);
  });

  it("sorts faces with no embedding last rather than treating them as perfect", () => {
    const character = { members: [member("missing", null), member("real", 0.5)] };
    expect(curationGroups(character).accepted.map((m) => m.face_id)).toEqual(["real", "missing"]);
  });

  it("collects only real numbers for the distribution chart", () => {
    const character = { members: [member("a", 0.8), member("b", null), member("c", 0.6)] };
    expect(curationGroups(character).distribution).toEqual([0.8, 0.6]);
  });

  it("handles a character with no members at all", () => {
    expect(curationGroups(null)).toEqual({ accepted: [], rejected: [], drifting: [], distribution: [] });
  });
});
