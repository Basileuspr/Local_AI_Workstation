# Development and verification

Start with the [architecture overview](../../ARCHITECTURE.md). Commands below run
from the application root. Feature guides retain their own validation notes;
old counts and completed implementation reports are dated evidence, not live status.

## Shared desktop/laptop checkout

Follow [AGENTS.md](../../AGENTS.md) when changing this repository. Work on one
computer/session at a time in its normal `main` checkout. Before editing, verify
the resolved directory, repository root, branch/upstream, dirty files and effective
fetch/push destinations, including Git URL rewrites. The expected repository is
`https://github.com/Basileuspr/Local_AI_Workstation.git`; `main` tracks `origin/main`.
Keep local `pull.ff=only` and `push.default=simple`.

Preserve and report unexpected work, then fetch and fast-forward with
`git fetch origin` followed by `git merge --ff-only origin/main`. Stop on divergence
or a failed synchronization. After validation, review every outgoing file/commit,
stage only the task's files, commit and normally push `main`. Fetch again and
verify local/remote identity and remaining work. Remote movement stops publication;
never force, reset or silently stash to resolve it. The other PC must independently
fetch and fast-forward, preserving its own work; this PC cannot certify that checkout.

The Dashboard snapshot publisher below uses retained review branches and does not
synchronize the normal development checkout. Do not run both workflows concurrently.
Keep environments, models and runtime data local to each computer.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start Electron with the installed environment and built renderer |
| `npm run vite` | Start the renderer development server |
| `npm run vite:mobile` | Start the separate phone-interface development server |
| `npm test` | Run frontend tests |
| `npm run test:backend` | Run backend pytest tests using the repository venv |
| `npm run test:media` | Run bundled Media Manager checks |
| `npm run test:android` | Run native JVM tests and release lint with the local Windows Android toolchain |
| `npm run qa:android` | Check the native image adapter with synthetic Chromium content |
| `npm run build:android` | Check, build and sign the APK with this PC's private signing identity |
| `npm run build:mobile` | Build only the hosted phone interface |
| `npm run build` | Capture build identity, compile the desktop renderer, then build the phone interface |
| `npm run verify` | Run the frontend, backend, media and build checks |
| `venv\Scripts\python.exe -B scripts/check-documentation.py` | Check public Markdown links, anchors and document relocations |
| `npm audit` | Check installed JavaScript dependencies against the current advisory feed |
| `venv\Scripts\python.exe -m pip check` | Check installed Python dependency compatibility; not a vulnerability audit |

Backend tests and QA fixtures must use temporary app data, model, log and catalog
locations. Follow each fixture's isolation contract. Never run reset/import tests
against live data. For a backend run, use a separate PowerShell window so these
test locations do not become the environment for a later normal app launch:

```powershell
$checkRoot = Join-Path $env:TEMP ('law-check-' + [guid]::NewGuid().ToString('N'))
$env:LAW_DATA_DIR = Join-Path $checkRoot 'data'
$env:LAW_LOG_DIR = Join-Path $checkRoot 'logs'
$env:LAW_MODELS_DIR = Join-Path $checkRoot 'models'
$env:LAW_IMAGE_MANAGER_DIR = Join-Path $checkRoot 'image-catalog'
npm run test:backend
```

A normal full build replaces `dist`, including existing phone releases; close
connected phones and finish active work before replacing deployed assets. It also
changes generated build identity and review records. Coordinate with source edits.
`LAW_BUILD_REVIEW_DIR` can redirect review output to a writable temporary folder
if the local reader is locked; it does not redirect `dist` or root `build-info.json`.
Fully restart Electron to load changed desktop or backend code when deployment
is intended. A documentation review need not restart the app.

Android builds are separate from `npm run build` / `verify`; see the
[native source and installation guide](../../mobile/android/README.md). APKs,
keys, SDKs and Gradle caches stay local. GitHub validation runs native checks when
the selected update includes Android source; it does not sign or install an APK.
`npm run verify` does not include npm's advisory audit, `pip check`, native Android
checks, Chromium walkthroughs, fresh installation or physical-device/GPU acceptance.
Record those results separately, including skips and pre-existing failures.

## Updating JavaScript dependencies

Fully quit Electron before replacing local dependencies. Use `npm ci` to install
the reviewed lockfile, then launch again with `npm start`. A running desktop
retains its previous Electron executable until this installation and restart.
For a dependency change, select
patched versions compatible with the existing major versions, then check the
lockfile diff, run `npm audit`, and validate the affected suites/builds.

If npm 10 fails while updating Vitest with `Cannot read properties of null
(reading 'edgesOut')`, the October 23 update was resolved with a temporary
`npx --yes npm@11.21.1 install --save-dev electron@44.5.0 vite@6.4.4 vitest@4.1.12`
invocation. This does not replace global npm. A subsequent `npm ci` with npm
10.9.3 installed the resulting lockfile successfully. Do not bypass peer checks
with `--force` or `--legacy-peer-deps` to hide a resolver failure.

## Documentation ownership

- Keep the root README short: startup, documentation and storage entry points.
- Keep detailed user controls in the appropriate topic folder under `docs/`.
- Update an existing guide before adding another report on the same feature.
- Consolidate dated test evidence and remaining acceptance in VERIFICATION.md.
  Preserve original dates; historical snapshots and private handoffs are not current guides.
- Keep release/version records in the root [RELEASES.md](../../RELEASES.md).
- Use relative Markdown links from each document. Inline code paths and shell
  commands refer to the application root unless stated otherwise.
- Keep private handoffs and architecture audits excluded from Git/publication.
  Moving a document does not make its contents public.

See [verification](VERIFICATION.md), the [recording workflow](../application-review/README.md)
and the [document map](DOCUMENT_MAP.md). Update the shared relocation map when a
guide moves; do not rewrite historical snapshot paths/hashes.

## Dashboard snapshot publisher

Dashboard → GitHub update → Show GitHub details exposes three separate actions
after Review source changes captures/fetches a snapshot:

1. Validate selected changes checks the chosen coherent source set without committing.
2. Commit locally records that validated snapshot on a retained
   `codex/github-update-…` branch without changing the development branch/index.
3. Push to GitHub checks the parent/tree again, pushes and verifies the destination.

Source edits or selection changes require a new review/validation. Failed pushes
retain the local commit; remote movement stops publication without forcing.
A successful Dashboard push does not fast-forward the normal checkout.

Validation uses a fresh public-history checkout with isolated data/dependencies.
It runs frontend/backend/media checks, npm audit, pip consistency and a build.
Selected Android changes also require native unit/lint/adapter checks. It does not
sign/install an APK or certify fresh Python installation or real GPU/voice quality.

Only allowed source and explicitly regenerated public reader assets are staged.
Credentials, private paths, non-test email addresses, runtime data, private reports,
models, caches, APKs and signing material are excluded. Pattern checks supplement
human review. Licensed bundled assets have exact size/hash exceptions.
Never publish local reader snapshots simply because a build created them.

Progress/logs and review records stay in the private desktop profile. Completed
validation checkouts can be removed after remote verification; recovery branches,
logs and reviewed snapshots remain available. Select dependent files together.
Git credentials must already permit the intended push; no automatic background
committer runs when Dashboard opens.

## Files retained at the root

The launcher, package manifests, Vite/Vitest/pytest configuration, requirements
profiles and lockfile stay where existing commands expect them. `Modelfile` and
`Modelfile-heretic` remain local Ollama templates. License notices stay at the
root for discoverability. `build-info.json` is generated, not hand-maintained.
