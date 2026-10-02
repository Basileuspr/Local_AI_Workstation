# Local AI Workstation

A local-first Windows desktop application built with Electron, React and
FastAPI. It combines Ollama chat, document and public-webpage ingestion, SDXL
image generation, LoRA workflows, face curation and persistent scene editing.

From an already configured checkout, run `npm start`.

**File → Exit & Restart** stops the owned backend and opens a fresh application
instance after it has exited. **File → Exit**, the window's **X** (or Alt+F4),
and the tray's **Quit** all fully exit the application; the X no longer hides
it in the tray. The tray also offers **Exit & Restart**. Minimize the window
when you want to keep the app running.

Exiting requests the backend's graceful shutdown, like its first Ctrl+C, and
waits for cleanup. If it stalls for 20 seconds, the app stops only its owned
backend process tree and waits up to 10 more seconds to confirm termination.
Restart is cancelled if the old backend cannot be confirmed stopped. On Windows,
backend child workers are contained so they cannot remain running after their
backend exits. Independently running Ollama and other applications stay running.
Completed saved work remains on disk; active backend work stops on exit/restart.

**Workspace → Folder Review** inventories a selected folder, reviews readable
source/document text in batches, and saves per-file findings and a combined
report. Images receive metadata only; PDFs require extractable text. See the
[Folder Review guide](FOLDER_REVIEW.md).

**Dashboard > GitHub update** reviews source changes and offers separate
**Validate selected changes**, **Commit locally**, and **Push to GitHub** actions.
See the [publication guide](GITHUB_PUBLICATION.md)
for setup, private-data exclusions and progress logs.

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

Opening the app or choosing **New Chat** shows a blank, unsaved draft. A chat
session is created when you submit your first prompt; typing or selecting
attachments does not create one. Saved conversations remain in the sidebar.
The workspace's **Refresh** button keeps its current view and selected chat.

Every workspace has a circular **i** Info button at the top right, including
pinned tool panes. It opens that workspace's instructions, controls, settings,
and examples. Generate and LoRA include detailed setting scales; Audio includes
transcription, extraction, and voice-cloning guides. Close or Escape returns to
your workspace without clearing its draft. Help lives in these panels instead
of separate how-to dropdowns on the work surface.

Use **Workspace options → Appearance** in any workspace, or open
**Chat options → Model / roleplay settings**,
to choose a color theme, interface font, and code/data font. Changes preview
immediately and are saved on this device. **Reset appearance** restores the
default look without changing chat or model settings. Fonts use local system
installations; document pages and website previews retain their own formatting.

**UI contrast** in Appearance adjusts interface text and borders from softer
(75%) to stronger (150%) within the selected theme. It previews immediately
and is saved on this device. **Reset contrast** restores 100% while keeping
your theme and fonts. This changes UI colors without applying a filter to
images, videos, or document pages.

The chat header keeps the conversation title, model picker, and model status
visible. **Chat options** groups response length, Knowledge, model order,
model/roleplay settings, context usage, memory compaction, thinking, rename,
exports, and Response influences. **Workspace options** contains side-pane,
appearance, and refresh controls. **Internet** in the composer opens public-page
import; its draft is retained when switching tools, and active import progress
stays visible when the panel is closed. Press **Escape** or click outside a popup
menu or dialog to close it, including chat tools and Media Manager dialogs.
Escape closes the innermost popup first and returns focus to its opener; retained
chat-tool drafts and selections remain available when reopened. Dialogs carrying
out an operation retain their existing cancellation rules.

**Chat options → Thinking trace** opens a live, scrollable trace viewer. The app
uses Ollama's reported thinking controls, including renamed models and named
reasoning levels, and captures native fields and explicit inline thinking tags.
Only text emitted by the model is available; responses without a trace are
marked. Capture also covers Word document and canvas requests. Finite output
budgets reserve 8,192 extra tokens for thinking when enabled; **Unlimited**
remains unlimited. An output-limit notice identifies incomplete responses.
Thinking can increase response time.

Use **Export thinking trace** inside the viewer or **Chat options → Export conversation**
to download the complete recorded history across chats as text. Export and app
restart preserve that history; explicit maintenance/reset actions still clear
it. The viewer keeps older text accessible while new output arrives. **Open
terminal** remains available inside the viewer.

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
**List history** below the list retains dated additions, removals, text edits and
completion changes, with the list before and after each saved change. History
stays with the conversation after reopening it; Cancel and failed saves add no
history. Lists created before this feature start tracking with their next edit.

The **Workspace options → Side pane** selector in Chat opens a tool alongside
the conversation. You can also choose **Workspace options → Pin beside chat**
from a tool's workspace. **Unpin ×**
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

**Index** stores notes, prompts, glossary entries, and other reference text.
On a saved entry, open **Connect to Knowledge**, choose an existing node, and
click **Connect**. Entries can link to more than one node. The node inspector
lists its connected **Index entries**, with buttons to open them or unlink.
These are saved references: the text stays editable in Index and is not added
to chat retrieval by linking. Import content into Knowledge when it should
participate in retrieval. Unlinking leaves both items intact.

Images includes a GIF Maker with frame ordering, sizing, timing, preview, and
local saving. Packager builds ZIP copies of selected files and folders. The
Browser workspace uses an isolated web session and can send inspected page
source to the HTML, CSS, and JavaScript viewers.

**Images → [Image Manager](IMAGE_MANAGER.md)** catalogs existing still-image
folders with previews, search, dates, tags, favorites and exact duplicate review.
It provides reviewed, hash-verified copy/move plans and reusable image functions
for scans, duplicate checks, organization plans and saved reports. Its code and
local catalog are separate from Media Manager.

[Review & classify](VISUAL_REVIEW.md) brings slideshow ratings, captions, tags,
exports, person groups and scene filters to Image Review and both managers.
Name a face group once; local matching associates later images with that group.
Media Manager initially classifies one preview frame per video.

Use **Arrange tabs** at the top of navigation to save section and tab priorities
across the app. Image Manager keeps its filters/tagging controls visible while
scrolling, can hide tagged images, and selects images with a thumbnail click.
Its **Send duplicates to folder** action prepares a reviewed copy/move plan into
the selected source's `Duplicates` subfolder.

**Workspace → Hash Auditor** reads selected folders or drive roots and saves a
local inventory of full SHA-256 hashes, sizes, timestamps and file locations.
Add multiple paths with **Browse folders** or paste one absolute path per line,
then choose **Start audit**. **Exclude folders** narrows the scan. Nothing scans
automatically, and the auditor never moves or deletes source files.

Matches span all recorded locations, including folders scanned separately.
Choose exact hashes or metadata candidates; matching metadata alone does not
prove identical contents. Hard links are labeled. Results show their read
dates, so rescan locations to refresh them. Cancel keeps completed reads;
closing the app interrupts scanning but preserves saved records. Links,
junctions, cloud placeholders, NVIDIA locations and the catalog itself are
skipped, with errors and exclusions listed below the results. The subtle
**Export** menu saves the complete inventory or current match type as CSV.

**Dashboard → Storage libraries** creates dedicated app folders on selected
local drives, similar to game-launcher libraries. Choose a drive or parent
folder, create a library, then select **Use for new files**. The app remembers
all libraries and shows their availability and free drive space. An existing
marked library can be reattached using its parent folder and folder name.

New generated images, chat images, image imports, Word documents, conversions,
character attachments, face datasets, Character Parts datasets and image
workflows use the default library. Earlier files and projects stay in place
and remain accessible across libraries. A disconnected destination produces
an error rather than saving to another drive. **Use library** in image/GIF
output controls selects an export-copy folder in the default library.

Models, chats, settings, search indexes, encrypted vaults, and audit catalogs
keep their original locations. Temporary processing and download dialogs keep
their existing behavior. Backups include managed files from every registered
library; reconnect those drives before exporting. Restoring flattens those
files into the original app-data folder and resets the default there. Reset
and import preserve external library folders; reset removes their registrations.
Export copies and other external files remain outside app backups. Metadata-only
inventory counts describe the original app-data folder.

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
