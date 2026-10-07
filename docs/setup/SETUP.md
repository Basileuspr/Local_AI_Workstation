# Setup and optional runtimes

Run all commands from the application root. These instructions describe the
repository configuration; dependency versions and past checks are not a fresh-install validation.

## Windows setup

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

## Optional Verboa runtime

Verboa Image 1.0 NF4 uses the ERNIE Image text-to-image pipeline. In the existing
CUDA Python environment, install its optional runtime with
`venv\Scripts\python.exe -m pip install -r requirements-ernie.txt`, then put the
complete approved `verboa/Verboa-Image-1.0-nf4` Diffusers download in
`models/diffusers/verboa-image-1.0-nf4/`. The download is about 12.7 GB and requires
accepting that repository's terms and authenticating with Hugging Face locally.
Rebuild the renderer and fully restart the desktop after installing support.

Use **Verboa settings** in Generate to select 8 steps, guidance 2 and an empty
negative prompt. Dimensions must be multiples of 16. ERNIE uses its own native
tokenizer instead of SDXL prompt chunking; reference-image generation, inpainting
and local SDXL LoRA training remain SDXL features. The text encoder uses layer
offloading, while the NF4 transformer uses whole-model offloading to preserve its
quantization state. This reduces GPU memory use at the cost of CPU/RAM use and
transfer time; it does not guarantee that every resolution fits.

Repeated Verboa requests reuse native prompt embeddings in a CPU-only LRU cache
(up to 16 entries / 32 MiB per loaded pipeline), including the empty negative
prompt. Cached tensors are private to the runtime and are released when the
model unloads; prompts are not added to a disk cache. Embedding extraction
disables unused autoregressive KV caching. Between images, the runtime offloads
CUDA weights while retaining its installed hooks, and starts the denoising
timer after prompt encoding. Resolution, steps, guidance and seed are preserved.
For an opt-in native comparison on an idle GPU with 16 GiB of available RAM, run
`venv\Scripts\python.exe scripts/qa-verboa-performance.py --label check --runs 3 --resume`.
The fixture uses neutral input and temporary data; its isolated queue skips
Ollama unloading so it cannot interrupt a model owned by the desktop process.
Pass `--baseline PATH_TO_RESULT_JSON` to also verify pixels against an earlier
run with the same settings.


## Data locations

The repository contains source, tests, dependency manifests and technical
documentation. Sessions, databases, images, logs, personal handoffs and compiled
builds are excluded. Runtime storage defaults to `data/` and model storage to
`models/`; `LAW_DATA_DIR` and `LAW_MODELS_DIR` can relocate them. Image Manager's
catalog lives independently in desktop user data, like Media Manager's reports,
and remains available across app-data reset and backup import without an export.
`LAW_IMAGE_MANAGER_DIR` can relocate that catalog outside app data.
