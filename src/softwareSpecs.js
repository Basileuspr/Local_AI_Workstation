export const SOFTWARE_GROUPS = [
  ["frontend", "Frontend & desktop"], ["backend", "Backend"], ["dependencies", "Dependencies only"],
  ["tool_calls", "Available API calls"], ["models", "Model list"],
];
export function formatSoftwareSpecs(snapshot, groups = SOFTWARE_GROUPS.map(([id]) => id)) {
  return [`Local AI Workstation — Software specs`, `Snapshot: ${snapshot.sampled_at}`, ...SOFTWARE_GROUPS.filter(([id]) => groups.includes(id))
    .map(([id, label]) => `\n${label}\n${JSON.stringify(snapshot[id] ?? { status: "Unavailable" }, null, 2)}`)].join("\n");
}
