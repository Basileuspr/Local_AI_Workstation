// Vite embeds the capture into the renderer, so an old bundle cannot silently
// acquire the identifier of a newer backend or desktop process.
export const rendererBuild = typeof __LAW_BUILD_INFO__ === "undefined" ? null : __LAW_BUILD_INFO__;

export function buildIdentityLines(snapshot) {
  const build = snapshot.build;
  if (!build) return ["Build identity: Unrecorded. Rebuild/relaunch to capture it."];
  const desktop = snapshot.frontend?.runtime?.build;
  const renderer = snapshot.frontend?.renderer_build;
  const lines = [`App version: ${build.package_version || build.app_version || "Unavailable"}`, `Build identifier: ${build.build_id || "Unrecorded"}`,
    `Source commit: ${build.source_commit || "Unavailable"}`, `Dirty at capture: ${typeof build.source_dirty === "boolean" ? (build.source_dirty ? "yes" : "no") : "Unknown"}`,
    `Captured at (UTC): ${build.captured_at_utc || "Unavailable"}`, `Source snapshot: ${build.source_snapshot_id || "Unavailable"}`,
    `Recorded source status: ${build.source_status || "Unknown"}`];
  if (build.package_version && build.package_version !== build.app_version)
    lines.push(`Captured app version: ${build.app_version}. Current package version: ${build.package_version}.`);
  if (build.status_detail) lines.push(build.status_detail);
  for (const [label, identity] of [["Desktop", desktop], ["Renderer", renderer]]) {
    lines.push(`${label} build identifier: ${identity?.build_id || "Unrecorded"}`);
    if (identity?.build_id && build.build_id && identity.build_id !== build.build_id)
      lines.push(`${label} and backend build identifiers differ. Rebuild and fully relaunch the app.`);
    if (identity?.status_detail) lines.push(`${label}: ${identity.status_detail}`);
  }
  return lines;
}
