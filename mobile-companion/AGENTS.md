# Companion development

Read the parent [AGENTS.md](../AGENTS.md), [architecture](../ARCHITECTURE.md),
[development guidance](../docs/development/DEVELOPMENT.md) and this folder's
[README](README.md) before implementation. The parent repository remains the
Git/synchronization and dependency root; opening this folder is a scoped entry
point, not a separate checkout. Coordinate one source writer at a time across it.

Keep companion-owned changes here. Inspect shared UI/backend dependencies before
changing integration code outside this folder. Preserve existing mobile security,
durable jobs, stable IDs/revisions, exact response budgets and desktop control reuse.
Update both source fingerprints when changing their source coverage.

Use folder-local npm commands or their parent equivalents. Test with temporary
app data and build outputs. Do not replace live `dist`/dependencies or restart
for validation. Network/VPN/firewall/certificate/listener configuration is a
separate user-authorized action. Preserve original assets, native outputs,
signing identity, local SDKs, pairing and job databases.

For a path change, inspect parent imports, npm/Vite/Vitest/pytest entry points,
updater fingerprints, fixtures, publication allowlists/checksums, source capture
and active documentation links. Report focused tests and any physical-device,
provider, native-installation or activation checks that were not performed.
Follow the parent's reviewed commit/push workflow for completed implementation.
