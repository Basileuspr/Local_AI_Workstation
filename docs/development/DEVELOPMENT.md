# Development and verification

Start with the [architecture overview](../../ARCHITECTURE.md). Commands below run
from the application root. Feature guides retain their own validation notes;
old counts and completed implementation reports are dated evidence, not live status.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start Electron with the installed environment and built renderer |
| `npm run vite` | Start the renderer development server |
| `npm test` | Run frontend tests |
| `npm run test:backend` | Run backend pytest tests using the repository venv |
| `npm run test:media` | Run bundled Media Manager checks |
| `npm run build` | Capture build identity and compile the renderer |
| `npm run verify` | Run the frontend, backend, media and build checks |

Backend tests and QA fixtures must use temporary app data, model, log and catalog
locations. Follow each fixture's isolation contract. Never run reset/import tests
against live data. A build changes generated output and review records; coordinate
with concurrent source edits. Fully restart Electron to load changed desktop or
backend code.

## Documentation ownership

- Keep the root README short: startup, documentation and storage entry points.
- Keep detailed user controls in the appropriate topic folder under `docs/`.
- Update an existing guide before adding another report on the same feature.
- Put dated investigations, handoffs and completed task reports in `docs/archive/`.
  Preserve their dates and limitations; do not silently promote old claims to current facts.
- Keep release/version records in the root [RELEASES.md](../../RELEASES.md).
- Use relative Markdown links from each document. Inline code paths and shell
  commands refer to the application root unless stated otherwise.
- Keep private handoffs and architecture audits excluded from Git/publication.
  Moving a document does not make its contents public.

See the [recording workflow](../application-review/README.md) for dated observations
and the [publication guide](GITHUB_PUBLICATION.md) for reviewed source exports.
The October 5 reorganization and old-to-new paths are listed in the
[document map](DOCUMENT_MAP.md).

## Files retained at the root

The launcher, package manifests, Vite/Vitest/pytest configuration, requirements
profiles and lockfile stay where existing commands expect them. `Modelfile` and
`Modelfile-heretic` remain local Ollama templates. License notices stay at the
root for discoverability. `build-info.json` is generated, not hand-maintained.
