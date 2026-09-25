# Windows compatibility and recovery

The intended laptop baseline is Windows 10/11 with x64 Python 3.13 and Node.js
22. This is a source checkout, not an installer. Windows 7/8/8.1 and native
Windows ARM64 are not validated targets; graceful degradation cannot make an
unsupported Electron or Python executable run on an older operating system.

## Partial operation

The app now detects capabilities itself; users do not need to supply hardware
specifications. Dashboard reports live backend and desktop capabilities, and
the app rechecks installed models and services while it is open. Detection does
not install software, fetch models, or change saved generation requests.

Automatic policies:

- Chat defaults to a 4,096-token context on systems with up to 16 GiB of RAM
  (or unknown memory), 8,192 up to 32 GiB, and 16,384 above that. `LAW_NUM_CTX`
  explicitly overrides this policy. These are conservative defaults, not model
  fit guarantees.
- On smaller-memory systems, a missing/empty chat selection falls back to the
  smallest installed chat model with a known size. A valid selected model wins.
  Adding/removing models or restarting Ollama refreshes discovery automatically;
  an active generation is not switched to a different model.
- Face processing limits its default CPU thread count to the detected CPU
  resources. If ONNX GPU initialization fails and CPU support exists, it retries
  initialization once on CPU, retaining that choice for the app session.
  Explicit `LAW_FACE_INTRA_OP_THREADS` settings take precedence.
- SDXL models use sequential CPU offload on detected NVIDIA GPUs with 6 GiB
  VRAM or less, when the pipeline supports it; larger GPUs use model CPU offload.
  This trades speed for smaller GPU residency without changing image dimensions
  or prompt settings. It still requires CUDA and sufficient system memory.
- Generation/training controls reflect their own detected dependencies.
  Dataset editing, galleries and other local tools stay available independently.
  Desktop actions check for their required Windows tools; Media Manager checks
  for its external application and Python before trying to launch it.

Capability checks are evidence of prerequisites, not proof that every operation
will succeed. Package/driver changes can still require restarting the app.

| Missing or unavailable component | Expected behavior |
| --- | --- |
| Ollama, or a chat model | App opens; existing saved material and desktop tools remain accessible. Chat reports the missing service/model. |
| NVIDIA GPU, PyTorch, or working CUDA libraries | Image generation and LoRA training report unavailable; core services remain usable. There is no SDXL CPU fallback. |
| Chroma/text splitter packages or their Windows libraries | Knowledge search returns an actionable unavailable response. Backend startup, chat and direct document parsing continue. |
| Embedding model | Knowledge indexing/search cannot run; chat remains separate. |
| Vision model | OCR, image understanding and dataset analysis cannot run; native text extraction remains available. |
| ONNX Runtime / face models | Face detection reports unavailable. Optional CPU face runtime can be installed separately. |
| Media Organizer | Media Manager shows setup guidance. Install that separate application under `Desktop\Media Organizer`, or set `LAW_MEDIA_MANAGER_DIR` to its root. |
| Sensors / NVIDIA monitoring tools | Hardware readings may be unavailable; they do not establish whether chat can run. |

Use Dashboard's **Available on this PC** section for capability guidance. CUDA
availability alone is not proof that a model fits into memory or that training
will succeed. Ollama chooses its own hardware; small enough models can use CPU.

## Setup

From PowerShell in the repository folder, after installing Node.js and Python:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm start
```

The setup script creates a local venv, installs Node dependencies, installs the
core Python packages, attempts knowledge packages, checks dependency conflicts,
and builds the frontend. It leaves saved data and models in place. Quit any
running instance before setup. It requires network access for dependencies.

Optional additions, from the same folder:

```powershell
# Knowledge search, if its optional setup failed
.\venv\Scripts\python.exe -m pip install -r requirements-knowledge.txt
# CPU face detection runtime; install weights explicitly in Face Studio
.\venv\Scripts\python.exe -m pip install -r requirements-faces.txt
# Full recorded dependency set, for a compatible NVIDIA machine
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1 -Profile Full
```

Image generation additionally needs a complete compatible SDXL Diffusers model
under `models\diffusers` (or `LAW_MODELS_DIR\diffusers`). Ollama's model store is
separate. GitHub contains neither model weights nor your personal app data.

## Recovery

- Missing/moved Python environment, missing packages, native DLL errors, access
  denial, full disks and interrupted maintenance receive targeted startup
  guidance. The desktop opens independently of backend readiness. Open logs
  from its startup notice, fix the cause, then fully quit/reopen the app.
- Startup waits up to 90 seconds for the backend, with an optional
  `LAW_BACKEND_TIMEOUT_MS` override capped at five minutes. A timeout never
  starts a second backend or deletes data. If the process later becomes ready,
  the frontend detects it; use Refresh if a previously opened pane needs it.
- Missing frontend builds show a bundled recovery page. The batch launcher
  attempts a build when dependencies exist but `dist\index.html` is missing.
- A workspace rendering exception shows a retry panel while navigation and
  other workspaces stay available. Retrying can discard that pane's unsaved
  state; it does not reset saved files.
- A recoverable image-generation memory error attempts to unload the partial
  pipeline, releases the job's GPU lease and recommends smaller settings.
  It does not silently change the requested output or retry the job.
- A renderer process crash offers an explicit restart with software rendering,
  or Quit. It never automatically replays inference or editing jobs.
- For black windows or incompatible display drivers, fully quit and run:

  ```powershell
  $env:LAW_DISABLE_GPU="1"
  npm start
  ```

  This disables Chromium graphics acceleration only, not CUDA inference. Remove
  the environment variable to restore normal desktop acceleration.
- If the system tray cannot be created, closing the window quits the app
  instead of leaving an inaccessible hidden process.
- Access-denied errors require a writable checkout/data location, normally
  under the Windows user folder. The app never silently redirects existing
  data to an empty folder. Interrupted imports/resets retain their recovery
  controls and ownership locks.

## Verification boundaries

`scripts/check-core.py` can be run in a venv containing only
`requirements-core.txt`. It uses fresh temporary data, requires optional AI
packages to be absent, and checks backend startup, sessions, image lists,
LoRA/face listings, text parsing and explicit knowledge-search unavailability.
It does not launch Electron or run inference. Automated tests also simulate
missing packages and native library/driver exceptions. Testing on a particular
laptop, Windows build and display driver is still required for hardware claims.
The adaptive offload and CPU fallback policies have simulated regression
coverage; real low-VRAM inference on a laptop has not been measured.
