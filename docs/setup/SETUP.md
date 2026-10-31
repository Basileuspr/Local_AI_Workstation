# Setup and optional runtimes

Commands run from the repository root. This is the supported source setup, not a
claim of a fresh installation on every Windows/GPU combination.

## Windows

Install Node.js 22.12 or newer in the Node 22 series with npm, 64-bit Python 3.13
and Ollama on Windows 10/11:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm start
```

Default setup installs the core app and attempts optional Knowledge dependencies.
An optional-install failure need not prevent the desktop build, but dependency
conflicts stop setup. Core setup does not require NVIDIA/PyTorch. Start Ollama and
install a chat model separately; Knowledge also needs the configured embedding
model, normally `ollama pull nomic-embed-text`. Vision/OCR needs a suitable model.

Use `-Profile Full` for the recorded full dependency set. Setup never downloads
model weights. Recreate environments per PC; do not copy a venv. An unusable
existing environment is preserved: quit, rename it and rerun setup.

`requirements.lock.txt` constrains recorded working versions. Optional profiles
install their selected subset. `requirements.txt` lists direct upgrade inputs.
Optional audio, faces, Knowledge and SDXL CUDA profiles remain separate.
A detected GPU/runtime is not proof that a particular model/resolution fits.

For explicit, resumable weight installation, see the
[image model catalog and installer](../images/GENERATION.md#installing-image-models).

Media Manager is bundled; an external Desktop installation is not required.
See [its guide](../media/MEDIA_MANAGER.md) for optional overrides.

## Launch and rendering recovery

Closing the window, Alt+F4 or File → Exit quits the desktop and its owned backend.
Minimize to keep work running. Fully restart after Electron/preload/backend changes.

Rendering modes affect Chromium painting/composition, independently of CUDA model
inference. Compatibility mode and hardware/software choices apply on next launch;
`LAW_DISABLE_GPU` disables Chromium GPU use, not AI CUDA. **Redraw Window** can
repair painting without reloading the renderer; full refresh can lose unsaved state.

Startup waits for backend readiness with a bounded timeout and offers recovery.
It does not start duplicate backends or delete app data to resolve a timeout.
Missing build/runtime errors need the indicated setup/build repair. Model
out-of-memory errors do not silently change generation settings and retry.

## Optional Verboa runtime

Verboa Image 1.0 NF4 uses the ERNIE Image text-to-image pipeline. In the existing
CUDA environment:

```powershell
venv\Scripts\python.exe -m pip install -r requirements-ernie.txt
```

Install the complete approved model into
`models/diffusers/verboa-image-1.0-nf4/`, accepting its repository terms and
authenticating locally when required. Rebuild/restart after installing support.

**Verboa settings** selects eight steps, guidance two and an empty negative prompt.
Dimensions must be multiples of 16. Reference generation, inpainting and local
SDXL LoRA training remain SDXL features. ERNIE has its own tokenizer and bounded
CPU prompt cache. Offloading reduces GPU memory pressure at the cost of RAM and
transfer time; it does not guarantee every resolution fits.

## Storage and updates

`LAW_DATA_DIR`, `LAW_MODELS_DIR` and `LAW_LOG_DIR` relocate their respective
runtime areas. `LAW_IMAGE_MANAGER_DIR` controls the independent image catalog.
Do not put private data, credentials, models or compiled artifacts into commits.

Follow [development](../development/DEVELOPMENT.md) to synchronize/rebuild source.
A full build replaces dist, including phone releases; finish active work first.
[Mobile setup](../../mobile-companion/docs/SETUP.md) distinguishes hosted interface updates from
native APK upgrades. [PC bridge](PC_BRIDGE.md) is separate manual delegation.

[Storage and backup](../workspace/STORAGE_AND_BACKUP.md) ·
[Audio setup](../media/AUDIO.md#setup) · [Verification](../development/VERIFICATION.md)
