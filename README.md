# Local AI Workstation

A local-first Windows desktop application built with Electron, React and
FastAPI. It combines Ollama chat, document and public-webpage ingestion, SDXL
image generation, LoRA workflows, face curation and persistent scene editing.

From an already configured checkout, run `npm start`.

For a new checkout, install Node.js, Python and Ollama, then run these commands
from the repository directory in PowerShell:

```powershell
npm ci
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.lock.txt
npm run build
npm start
```

`requirements.lock.txt` pins the exact versions the tests were run against.
`requirements.txt` lists the direct dependencies without pins, for upgrading.

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
