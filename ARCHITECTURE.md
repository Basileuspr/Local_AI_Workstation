# Architecture

Start here for orientation, then use the [detailed architecture reference](docs/development/ARCHITECTURE_REFERENCE.md)
and the relevant [feature guide](docs/README.md). The detailed reference contains
historical sections; current source and focused tests resolve discrepancies.

## Process and source map

| Location | Responsibility |
|---|---|
| `electron/` | Desktop shell, backend lifecycle, native dialogs and guarded IPC |
| `src/` | React renderer, workspace controls, state and HTTP client |
| `backend/` | FastAPI routes, service logic, persistence and model coordination |
| `media-manager/` | Bundled media application with its own frontend and storage |
| `scripts/` | Setup, review capture, publication and isolated QA helpers |
| `tests/` | Backend, frontend and fixture checks |
| `docs/` | Feature guides, development references and dated records |
| `frontend/` | Legacy renderer fallback |
| `dist/` | Generated renderer and build metadata |
| `data/`, `models/` | Local runtime state and model assets; excluded from publication |

Electron starts or connects to the backend and supplies the API port to the
renderer. React communicates with FastAPI; backend services coordinate Ollama,
local generation runtimes, queues and persistence. Native desktop capabilities
pass through explicit preload/IPC contracts.

## Boundaries to preserve

- Normal desktop API access is loopback-bound and uses a session credential.
  [PC bridge](docs/setup/PC_BRIDGE.md) is a separate, explicitly enabled service.
- Session history, durable memory, media catalogs and file bytes have distinct
  storage owners. Read the relevant service before changing persistence.
- [Storage libraries](docs/workspace/WORKSPACE_GUIDE.md#storage-libraries) route
  managed media across registered local folders. Models and indexes retain their
  own locations; manager catalogs are separate from app-data reset/import.
- [Tool discovery](docs/development/TOOL_REGISTRY.md) and
  [tool execution](docs/development/LOCAL_TOOL_EXECUTION.md) have separate contracts.
- [Backend security and scene state](docs/development/ROADMAP_SEGMENTS_4_6.md),
  [browser security](docs/development/BROWSER_SECURITY.md), and
  [backup/import](docs/workspace/STORAGE_AND_BACKUP.md) document additional boundaries.

See [development and verification](docs/development/DEVELOPMENT.md) before running
checks. [Release records](RELEASES.md) explain source/build identity. A saved
snapshot records observed files; it does not prove runtime behavior.
