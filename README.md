# Local AI Workstation

A local-first Windows desktop app using Electron, React and FastAPI. It combines
Ollama chat, documents/Knowledge, local image generation and training, media tools
and explicit web research. An optional private phone companion uses the desktop.

## Start

From a configured checkout, run `npm start` or
`A1_Start Local AI Workstation.bat`. First-time installation, optional runtimes and
recovery are in [Setup](docs/setup/SETUP.md). Models are installed separately.

Closing the window fully exits; minimize to keep work running. Save edits before
quitting or using File → Exit & Restart.

## Documentation

- [All guides](docs/README.md) — one current guide per workflow.
- [Workspace](docs/workspace/WORKSPACE_GUIDE.md) and [Chat](docs/chat/CHAT_GUIDE.md).
- [Phone companion](docs/setup/MOBILE_COMPANION.md) and [Android source/build](mobile/android/README.md).
- [Storage, backup and reset](docs/workspace/STORAGE_AND_BACKUP.md).
- [Architecture](ARCHITECTURE.md) and [development/publication](docs/development/DEVELOPMENT.md).
- [Verification and open findings](docs/development/VERIFICATION.md).
- [Release/build identity](RELEASES.md) and [historical source reader](docs/application-review/README.md).

Workspace Info buttons provide controls and examples. This repository is a
development source distribution, not a packaged Windows installer. Android APKs
are built/signed locally.

## Local storage

Runtime data and models default to data/ and models/ with environment overrides.
Storage libraries can hold managed media on other local drives. Image Manager and
Media Manager have separate storage owners. Keep private data, credentials, models,
generated media and local reports out of public commits.

Tests and source review have explicit limits; they do not certify every optional
provider, fresh installation, physical device or GPU workload. Consult the dated
verification record before treating a historical result as current acceptance.
