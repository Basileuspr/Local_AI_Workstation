import { expect, it } from "vitest";
import { buildIdentityLines } from "../../src/buildIdentity";
import { formatSoftwareSpecs } from "../../src/softwareSpecs";

const build = { app_version: "1.0.1-dev", build_id: "fixture-build", source_commit: "abc123",
  source_dirty: true, captured_at_utc: "2026-10-01T05:30:00.123456+00:00", source_snapshot_id: "fixture",
  source_status: "recorded_files_match" };

it("includes provenance even when only a dependency section is selected", () => {
  const report = formatSoftwareSpecs({ sampled_at: "now", build, dependencies: { node: "22" },
    frontend: { runtime: { build }, renderer_build: build } }, ["dependencies"]);
  for (const value of [build.app_version, build.build_id, build.source_commit, build.captured_at_utc, "Dirty at capture: yes"])
    expect(report).toContain(value);
  expect(report).not.toContain("identifiers differ");
});

it("makes stale renderer or desktop IDs visible instead of declaring the app matched", () => {
  const lines = buildIdentityLines({ build, frontend: { runtime: { build: { ...build, build_id: "old-desktop" } },
    renderer_build: { ...build, build_id: "old-renderer" } } }).join("\n");
  expect(lines).toContain("Desktop and backend build identifiers differ");
  expect(lines).toContain("Renderer and backend build identifiers differ");
  expect(lines).toContain("old-renderer");
});

it("labels missing metadata and changed source rather than inventing an identity", () => {
  expect(buildIdentityLines({}).join()).toContain("Unrecorded");
  const lines = buildIdentityLines({ build: { ...build, source_status: "changed_since_capture", status_detail: "Source changed; rebuild." } });
  expect(lines).toContain("Recorded source status: changed_since_capture");
  expect(lines).toContain("Source changed; rebuild.");
});
