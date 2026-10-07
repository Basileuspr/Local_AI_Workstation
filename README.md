# Local AI Workstation

A local-first Windows desktop application built with Electron, React and FastAPI.
It brings together Ollama chat, documents and Knowledge, local image generation,
LoRA and character workflows, and media tools.

## Start the application

From an already configured checkout, run `npm start` or use
`A1_Start Local AI Workstation.bat`.

For first-time setup, install Node.js 22 with npm, 64-bit Python 3.13 and Ollama,
then run these commands from the application root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm start
```

Setup installs the core app and attempts optional Knowledge dependencies.
Install Ollama models separately. Image generation, voice cloning and other
optional tools need their own runtimes and models. See the
[setup guide](docs/setup/SETUP.md) and
[Windows recovery guide](docs/setup/WINDOWS_COMPATIBILITY.md).

## Find documentation

- [Documentation index](docs/README.md): all guides grouped by purpose.
- [Workspace guide](docs/workspace/WORKSPACE_GUIDE.md): navigation, chat controls,
  side panes, media tools, Sound Mixer and storage libraries.
- [Architecture](ARCHITECTURE.md): source layout and where to investigate behavior.
- [Development and verification](docs/development/DEVELOPMENT.md): commands,
  documentation conventions and the distinction between current source and old reports.
- [Release records](RELEASES.md): development versions and build identity.
- [Historical records](docs/archive/README.md): dated validation, roadmaps and handoffs.

Each workspace also has an **i** Info button with its controls and examples.

## Local files and privacy

Runtime data defaults to `data/` and models to `models/`; environment variables
can relocate them. Image Manager and Media Manager keep separate catalogs.
[Storage libraries](docs/workspace/WORKSPACE_GUIDE.md#storage-libraries) can place
managed media on other local drives. Read
[storage, backup and reset](docs/workspace/STORAGE_AND_BACKUP.md) before maintenance.

**File → Exit & Restart** reloads the desktop and its owned backend. Closing the
window fully exits; minimize it to keep work running. Save edits before exiting.

This repository contains a development source distribution, not a packaged
installer. Historical test counts do not certify the current checkout. For dated
observations and comparisons, use the [local review reader](docs/application-review/index.html).
