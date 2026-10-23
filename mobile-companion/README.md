# Mobile companion

Open this folder in Codex or Claude Code for companion work. Read [AGENTS.md](AGENTS.md)
and the parent [architecture](../ARCHITECTURE.md) first. The companion is still part
of the workstation repository and uses its dependencies, services and runtime.
This folder is the source boundary for a later extraction into its own project.
The folder move's checks and acceptance limits are in [validation](docs/VALIDATION.md).

| Folder | Owner |
|---|---|
| `web/` | Phone React PWA, public icons, manifest and Vite configuration |
| `android/` | Android WebView shell, native tests and local APK tooling |
| `backend/mobile_companion/` | Opt-in gateway, access control, jobs, updates and desktop routes |
| `desktop/` | Desktop companion setup card and phone-to-desktop sync hook |
| `scripts/` | Phone source fingerprint, icon generation and isolated QA |
| `tests/` | Companion frontend/backend checks and synthetic desktop fixture |
| `docs/` | [Connection and phone usage](docs/SETUP.md) |

## Commands from this folder

Use the parent checkout's installed Node dependencies and Python venv. Do not run
a separate dependency install here; `package.json` delegates to the parent.

| Command | Action |
|---|---|
| `npm run dev` | Local phone development server |
| `npm test` | Companion frontend tests |
| `npm run test:backend` | Companion backend and native publication tests |
| `npm run build` | Build hosted phone assets into the parent's `dist/mobile` |
| `npm run test:android` | Native JVM tests and release lint; no signing |
| `npm run qa:android` | Synthetic native adapter Chromium check |
| `npm run build:android` | Build/sign with this computer's existing private identity |

The existing root commands still work. Backend tests require temporary storage:
follow the [test isolation example](../docs/development/DEVELOPMENT.md#commands).
For hosted update QA, set `$env:LAW_MOBILE_UPDATE_QA='1'`, then run `npm run qa`.
That fixture builds temporary releases and uses synthetic data. Without that
flag, QA uses an existing phone build (override with `LAW_MOBILE_BUILD_DIR`).
`scripts/qa-mobile-inference.py` uses real local models and is a separate optional
acceptance check, not part of ordinary tests.

Build validation must not replace deployed assets while phones or jobs are active.
For a phone-only validation build, from the repository root use
`npm run build:mobile -- --outDir <absolute-temporary-folder>`.
A full desktop validation build requires an isolated source copy because desktop
build capture also writes build identity and review records.

## Workstation integration and future extraction

- `backend/main.py` loads this Python package using its file location, independent
  of the launch directory. `pytest.ini` adds both backend import roots. The
  maintenance gate imports the same companion route instance to protect active work.
- `src/App.jsx`, `Dashboard.jsx` and `SecondChat.jsx` consume the desktop modules.
  Shared API, polling and image-task state remain in `src/`. Shared code rendering,
  response controls and image settings/defaults are reused by the phone UI.
- Python still imports workstation configuration, session/gallery/vault storage,
  bridge storage, media validation and queue/generation services. Its routes use
  the existing authenticated desktop API; this is not an independently runnable server.
- Root npm/Vitest/pytest commands, source capture and GitHub publication include
  this folder. Only the exact public icons are allowed as binary source assets.
- Deployment stays at `dist/mobile`, `dist/mobile-releases` and
  `dist/mobile-current.json`. URLs, API routes and private app-data `mobile/`
  databases stay unchanged. The source move does not migrate or reset pairing/jobs.

Before extracting this folder into another repository, define/version the shared
UI and backend contracts, supply dependency manifests and startup wiring, transfer
the relevant license notices, and repeat desktop/phone integration tests. Keep
private signing material, SDKs, caches, APKs, local data and models out of Git.
Existing Android local output/cache folders move with the native source; signing
and toolchain locations remain external and unchanged.

## Phone acceptance after coordinated activation

Finish active work before the planned desktop restart/build. Start the existing
mobile connection again in Dashboard, then reopen the phone's saved HTTPS address.
Check retained pairing, a saved chat and a short response, image submission and
desktop synchronization, Gallery pinch/zoom, download/share, and sleep/reconnect.
Check hosted **Update phone app** and explicit phone-side application of the update.
This source relocation requires no APK upgrade, re-pairing or VPN reconfiguration.
Automated checks do not certify physical-phone or real-provider/GPU behavior.
