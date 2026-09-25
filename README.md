# Local AI Workstation

A local-first Windows desktop application built with Electron, React and
FastAPI. It combines Ollama chat, document and public-webpage ingestion, SDXL
image generation, LoRA workflows, face curation and persistent scene editing.

From an already configured checkout, run `npm start`.

For a Windows 10/11 laptop, install Node.js 22 (with npm), 64-bit Python 3.13,
and Ollama. From the repository directory in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm start
```

The default setup installs the core app, then attempts the optional knowledge
search packages. Failure of that optional install does not prevent the desktop
build (dependency conflicts still stop setup). It does not install PyTorch or
require an NVIDIA GPU. Start Ollama and install a chat model separately. For
knowledge search, also install the configured embedding model (by default
`ollama pull nomic-embed-text`). OCR and image understanding need a vision model.

For the full recorded dependency set, use the setup command with `-Profile Full`.
Models are never downloaded by setup. Do not copy a virtual environment from
another PC: recreate it locally. An unusable existing environment is preserved;
quit the app and rename it before rerunning setup.

`requirements.lock.txt` pins the recorded working versions. Core and optional
requirements use it as constraints, installing only the packages they need.
`requirements.txt` lists the direct dependencies without pins, for upgrading.

See [Windows compatibility and recovery](WINDOWS_COMPATIBILITY.md) for partial
operation, optional installs, graphics fallback and troubleshooting.
The app detects capabilities automatically, refreshes model availability, sizes
default chat context to RAM, and keeps unavailable operations separate from
usable workspaces. User-selected models and explicit runtime overrides take
precedence over automatic defaults.

Chat and embeddings require suitable models installed in Ollama. Image
generation requires a compatible local model and PyTorch runtime; see
`requirements-sdxl-cuda.txt` for the recorded CUDA dependency set. Model weights,
Python environments and Node dependencies are installed separately.

The repository contains source, tests, dependency manifests and technical
documentation. Sessions, databases, images, logs, personal handoffs and compiled
builds are excluded. Runtime storage defaults to `data/` and model storage to
`models/`; `LAW_DATA_DIR` and `LAW_MODELS_DIR` can relocate them.

See [Project status](PROJECT_STATUS.md) for validation and limitations,
[Architecture](ARCHITECTURE.md) for the source map,
[Image workflows](IMAGE_WORKFLOWS.md) for generation workflows, and
[Scene and security implementation](ROADMAP_SEGMENTS_4_6.md) for newer behavior.

Run `npm test` for frontend tests. Install `pytest` in the Python environment
and run `npm run test:backend` for backend tests, using temporary application
data, log and model directories. `npm run build` produces the local desktop
renderer. This repository does not include a packaged installer.
