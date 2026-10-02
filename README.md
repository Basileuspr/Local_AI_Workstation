# Local AI Workstation

A local-first Windows desktop application built with Electron, React and
FastAPI. It combines Ollama chat, document and public-webpage ingestion, SDXL
image generation, LoRA workflows, face curation and persistent scene editing.

From an already configured checkout, run `npm start`.

For the dated application audit, dependency inventory, searchable feature history,
and source comparisons, open the [local review reader](docs/application-review/index.html).
The [recording workflow](docs/application-review/README.md) saves later observations
without copying report text between chats.

The current development version is `1.0.1-dev`. See [local release records](RELEASES.md)
for the shared build identity and reviewed-release workflow. `npm run build`
captures a fresh source/dependency record before compiling the renderer.

[Character Creator](CHARACTERS.md) is a dedicated workspace for biographies,
notes, images, videos, audio, faces, parts, and LoRA references, with shortcuts
from Audio and Packager and linked character nodes in Knowledge. Profiles can
be loaded into chat roleplay; Response influences shows the active setup and
records the context supplied for each new reply. Faces remains the extraction
workspace.

Chat supports clickable Markdown checklists. Ask for a to-do list, or write
`- [ ] Task` and `- [x] Completed task` directly in a message. Click a box or
its label, or focus it with Tab and press Space. Changes save with the chat
and are included when copying the message or continuing the conversation.
Lists inside code fences remain examples. If a save fails, the box keeps its
previous state and the chat shows an error; reload the chat if another edit
has changed the same message.

Use **Edit list** below a checklist to change item text, add or remove items,
then **Save list** or **Cancel**. Edits affect only the tasks, preserving other
message text and attachments. **Pin list beside chat** shows the same saved
list in a second pane, with synchronized checkboxes and editing.

The **Side pane** selector in Chat opens a tool alongside the conversation.
You can also choose **Pin beside chat** from a tool's workspace. **Unpin ×**
closes the second pane. The selection is remembered separately for each chat
on this device; tool drafts remain in their usual workspace. Newly created
Word documents open beside the chat automatically, and existing attachments
have **Open beside chat**. On narrow windows the panes stack vertically.

Drag the divider between Chat and the pinned pane to change their sizes. On
narrow windows, drag the horizontal divider to adjust their heights. These
sizes are remembered per chat, with separate settings for wide and narrow
layouts. You can also drag the navigation sidebar's right edge to give the
main workspace more or less room. Use **☰** at the top left to hide or restore
the sidebar for a minimal chat view; its width and folded state are remembered
on this device. Focus either divider and use the arrow keys to resize, or
double-click it (or press Enter) to reset. Escape cancels a drag.

Images includes a GIF Maker with frame ordering, sizing, timing, preview, and
local saving. Packager builds ZIP copies of selected files and folders. The
Browser workspace uses an isolated web session and can send inspected page
source to the HTML, CSS, and JavaScript viewers.

The [Audio workspace](AUDIO.md) provides video-to-audio extraction, microphone
recording, local transcription with speaker separation, system read-aloud, and local voice cloning with
OmniVoice, Chatterbox Turbo, and Qwen3-TTS. See its setup guide for optional
runtimes and model downloads; recordings and model weights stay on your PC.

The [Media Manager](MEDIA_MANAGER.md) is bundled in this repository, including
its scanner, library, duplicate tools, verified moves, captures, frame extraction,
and image tools. FFmpeg/FFprobe are required for its video and image operations.
Existing media and saved scans remain private local data and are not published.

To connect two PCs and delegate chat or image tasks, see the
[PC bridge setup and first test](PC_BRIDGE.md). Bridge controls are in Dashboard.

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
