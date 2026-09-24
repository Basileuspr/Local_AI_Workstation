# Architecture

The sections below began as a 2026-08-07 snapshot. Current security, scene state,
and iterative-generation behavior is documented in [ROADMAP_SEGMENTS_4_6.md](ROADMAP_SEGMENTS_4_6.md)
and [IMAGE_WORKFLOWS.md](IMAGE_WORKFLOWS.md). Historical commit and test counts
below describe that earlier snapshot.

See `PROJECT_STATUS.md` for the current validation scope and known limitations.

---

## 1. What this is

A local-first desktop AI workstation. Everything runs on the user's machine:
chat inference through Ollama, retrieval-augmented generation through a local
Chroma index, SDXL image generation through local Diffusers models, and now
LoRA fine-tuning of those models on the user's own GPU. Inference uses local
models. Explicit web ingestion and face-model installation can contact the
network; see [INTERNET_ACCESS_PROPOSAL.md](INTERNET_ACCESS_PROPOSAL.md).

Three processes:

```
+---------------------------------------------------------------------+
| Electron main process         electron/main.js, electron/logger.js   |
|   - picks a free TCP port                                            |
|   - spawns the Python backend with LAW_PORT set                      |
|   - polls /health until ready                                        |
|   - loads the renderer with ?apiPort=<port>                          |
|   - tray, single-instance lock, hide-on-close, backend shutdown      |
+---------------+---------------------------------+-------------------+
                | spawn (stdout piped to log)     | loadURL / loadFile
                v                                 v
+-------------------------------+   +---------------------------------+
| FastAPI backend   backend/    |<--| React 19 renderer      src/     |
|   uvicorn, 127.0.0.1:<port>   |   |   Vite; reducer + context store |
+-------+---------------+-------+   +---------------------------------+
        |               |
        |               +-------------> subprocess: lora_worker.py
        |                               (owns the GPU for one run)
        v
+-------------------------------------------------------------------+
| Ollama :11434   chat completion + nomic-embed-text embeddings      |
| Local Diffusers models   models/diffusers/<name>/                  |
+-------------------------------------------------------------------+
```

---

## 2. Repository layout

```
backend/
  config.py                 every environment-dependent value, resolved once
  main.py                   app wiring, /chat SSE, /status, thinking trace
  routes/
    sessions.py             session CRUD, gallery images, trash, restore
    files.py                upload parsing, knowledge-base add/query/list/remove
    export.py               txt / md / json conversation export
    memory.py               durable-memory save and list
    prompt_index.py         reusable prompt library and editor draft
    image_generation.py     model discovery, generation, prompt tokens, outputs
    lora.py                 LoRA projects, analysis, datasets, training
  services/
    session_store.py        session JSON, image externalization, migration,
                            trash, blob garbage collection          (749 lines)
    image_store.py          content-addressed blob storage
    image_generation.py     SDXL pipeline manager, LoRA loading,
                            long-prompt encoding                    (316 lines)
    lora_store.py           LoRA project/dataset persistence        (639 lines)
    lora_training.py        single-run process manager
    lora_vision.py          local vision analysis + caption proposals (225 lines)
    lora_worker.py          the actual trainer, a separate process  (205 lines)
    knowledge_base.py       chunk -> embed -> Chroma -> retrieve
    memory_store.py         SQLAlchemy durable memories + message log
    prompt_index_store.py   prompt entries and draft, atomic writes
    file_parser.py          txt / md / pdf / docx text extraction
    app_logging.py          rotating file + console logging
electron/
  main.js                   desktop shell and backend lifecycle
  logger.js                 main-process file logging with rotation
src/
  App.jsx                   pane composition, status polling, session actions
  useStore.jsx              reducer, context, profiles               (407 lines)
  api.js                    the entire HTTP boundary                 (480 lines)
  config.js                 runtime API base resolution
  imageRefs.js              blob reference recognition
  serviceStatus.js          dependency status -> actionable guidance
  contextMemory.js          token budgeting and rolling compaction
  useChatUploads.js         shared upload implementation
  preferences.js            localStorage persistence
  modelCatalog.js           model labelling and default selection
  responseStyle.js          response-style system prompts
  roleplayPrompt.js         character/roleplay prompt assembly
  messageIds.js             stable id generation
  styles.css                all styling                            (1615 lines)
  components/
    Header.jsx              title, status indicator, context meter, export
    Sidebar.jsx             tabs, session list, trash, gallery, knowledge base
    MessageList.jsx         transcript, drag-and-drop, setup guidance
    InputBar.jsx            composer, attachment menu, streaming     (476 lines)
    SettingsPanel.jsx       profiles, sliders, roleplay, durable memory
    ImageStudio.jsx         SDXL generation controls
    LoraStudio.jsx          LoRA analysis, dataset, and training UI  (426 lines)
    PromptIndex.jsx         prompt library
    CustomProfileControls.jsx
    MarkdownMessage.jsx     hand-rolled markdown renderer
    Toast.jsx
tests/
  backend/                  pytest, 212 tests
  frontend/                 vitest, 154 tests
frontend/index.html         legacy single-file fallback (1466 lines)
data/                       all runtime state (gitignored)
models/                     local Diffusers models (gitignored)
venv/                       repo-local Python environment (gitignored)
```

---

## 3. Configuration

`backend/config.py` resolves every environment-dependent value once into a
frozen `Settings` dataclass. Two invariants hold:

1. **Nothing raises.** A malformed variable falls back to its default and
   appends to `settings.warnings`. A user who cannot start the app cannot read
   the error explaining why.
2. **Nothing logs.** Logging is configured *from* these values, so importing a
   logger here would be circular. `main.py` emits `settings.warnings` once
   handlers exist.

All variables use the `LAW_` prefix and are read by both the Python and
Electron processes.

| Variable | Default | Purpose |
|---|---|---|
| `LAW_HOST` | `127.0.0.1` | Backend bind address. Loopback only. |
| `LAW_PORT` | `8000` | Backend port; Electron overrides when busy. |
| `LAW_OLLAMA_URL` | `http://localhost:11434` | Chat and embeddings endpoint. |
| `LAW_OLLAMA_KEEP_ALIVE_SECONDS` | `300` | Retain idle chat, vision, and embedding models between requests. Set `0` for immediate unloading. GPU handoff/reset still unloads them explicitly. |
| `LAW_FACE_INTRA_OP_THREADS` | `6` | Threads per face ONNX session, capped at the machine's logical CPU count; `0` uses ONNX Runtime's automatic policy. |
| `LAW_EMBEDDING_MODEL` | `nomic-embed-text` | Knowledge-base embedding model. |
| `LAW_CHAT_MODEL` | `mistral` | Default when a request omits one. |
| `LAW_DATA_DIR` | `<repo>/data` | Root for **all** writable state. |
| `LAW_MODELS_DIR` | `<repo>/models` | Root for Diffusers models. |
| `LAW_LOG_DIR` | `<data>/logs` | Relocatable independently of data. |
| `LAW_LOG_LEVEL` | `INFO` | Log verbosity. |
| `LAW_ALLOWED_ORIGINS` | Electron + Vite | Comma-separated CORS allowlist. |
| `LAW_CHUNK_SIZE` / `LAW_CHUNK_OVERLAP` | `500` / `100` | Chunking; overlap is corrected if it meets or exceeds chunk size. |
| `LAW_DURABLE_MEMORY_MAX_CHARS` | `4800` | Injected memory budget. |
| `LAW_KNOWLEDGE_BASE_MAX_CHARS` | `8000` | Injected retrieval budget. |
| `LAW_VITE_PORT` / `LAW_VITE_HOST` | `5173` / `127.0.0.1` | Dev server. |
| `LAW_PYTHON` | repo venv | Interpreter Electron launches. |

Every writable path derives from `data_dir`, so one variable relocates the
entire application state -- the groundwork for a portable build.

### Derived paths

```
data_dir/
  sessions/                 conversations (JSON, one file per session)
  blobs/                    image payloads, named <sha256>.<ext>
  trash/sessions/           deleted sessions, restorable
  backups/sessions/         pre-migration copies, written once
  generated_images/         SDXL output PNGs, browsable
  knowledge_base/           Chroma persistent client
  prompt_index.json         prompt library
  prompt_index_draft.json   in-progress editor state, kept separate
  memory.db                 SQLite: durable memories + message log
  thinking/thinking.log     model reasoning trace
  logs/                     backend.log, electron.log (rotating)
  lora/
    projects/<id>/          project.json + images/
    adapters/               trained .safetensors adapters
    runs/                   per-run scratch
    training.lock           single-GPU mutex
```

---

## 4. Port negotiation and process startup

Port 8000 is a common default for other tools, making a clash the most likely
first-run failure on an unfamiliar machine. The sequence:

1. Electron reads `LAW_PORT` (default 8000) and probes with a throwaway
   `net.createServer().listen()`, walking up to 20 candidates.
2. It spawns `venv/Scripts/python.exe backend/main.py` with `LAW_HOST` and
   `LAW_PORT` in the child environment -- the chosen port wins over any
   inherited value, so backend and renderer cannot disagree.
3. It polls `/health` until 200 or a 30-second timeout.
4. It loads the renderer with `?apiPort=<port>` appended. `loadFile` accepts a
   `search` option, so this works for the packaged build as well as `loadURL`.
5. `src/config.js` resolves the API base in order: `?apiBase=` (explicit
   override, for debugging), then `?apiPort=`, then `http://localhost:8000`.
   The fallback keeps `npm run vite` working with a separately started backend.

If nothing in range is free, the backend probes the bind itself and exits with
an actionable message rather than a traceback.

Renderer choice, in order: the Vite dev server (only when `LAW_VITE_DEV=1` is
set and it answers), then `dist/index.html`, then `frontend/index.html`
(legacy fallback).

---

## 5. Request handling and async discipline

**Only routes that await real I/O are `async def`.** Everything else is plain
`def`, which FastAPI dispatches to a threadpool.

This was the single largest correctness fix in the project's history: 28 of 31
handlers were declared `async` while awaiting nothing, forcing all their JSON
parsing, SQLite transactions, Chroma queries, embedding calls, and SDXL
generation onto the event loop. A knowledge-base ingest froze the entire
backend -- health checks stopped answering and the app looked crashed.

Deliberately still `async`:

| Route | Why |
|---|---|
| `/chat` | awaits streaming HTTP to Ollama |
| `/models` | awaits HTTP to Ollama |
| `/memory/compact` | awaits HTTP to Ollama |
| `/status` | awaits HTTP to Ollama |
| `/health` | must answer *while* workers are busy |
| `/chat/stop/{id}` | touches asyncio task state, not thread-safe |
| `/files/parse`, `/files/knowledge-base/add` | await `file.read()`; their synchronous work is explicitly wrapped in `run_in_threadpool` |
| `/files/knowledge-base/query` | awaits GPU queue admission, then runs embedding/retrieval in the worker pool |
| `/lora/projects/{id}/images` | awaits `file.read()`; storage offloaded |

`tests/backend/test_async_offloading.py` enforces this structurally (asserting
specific handlers are *not* coroutines) and behaviourally (a slow ingest and a
concurrent `/health` in one event loop). **A failure there after making a
handler `async` is the test working.**

Measured: a 60 KB document ingest took 43 seconds and served 280 concurrent
health probes with zero failures, 5 ms average latency, 92 ms worst case.

---

## 6. The chat pipeline

```
InputBar.sendMessage()
  |
  +- rotateContextMemory(hard trigger, 86% of usable budget)
  |    +- POST /memory/compact -> Ollama summarizes older turns
  |
  +- buildContextMessages()  strips runtime-only fields, prepends the
  |                          rolling summary as a system message
  |
  +- POST /chat  (SSE) --------------------------------------------+
                                                                    v
   backend/main.py chat():
     1. resolve image references -> base64         (threadpool)
     2. load durable memory, save the user message (threadpool, one hop
        covering four SQLite transactions, each an fsync)
     3. inject the system prompt
     4. if knowledge base enabled: embed + Chroma query (threadpool)
     5. stream from Ollama, splitting <think>...</think> out of the
        visible text into data/thinking/thinking.log
     6. on completion, record the assistant message (threadpool)
                                                                    |
  <-----------------------------------------------------------------+
  SSE frames:  {"notice": {...}}   emitted first if anything degraded
               {"token": "..."}    streamed text
               {"done": true}
  |
  +- rotateContextMemory(normal trigger, 72%)
  +- PUT /sessions/{id}  persist the exchange
```

### Context budgeting (`src/contextMemory.js`)

The most intricate frontend logic, and fully tested (47 tests).

```
windowTokens      = model context length, floored at 2048, default 8192
outputReserve     = requested response length, or min(4096, window * 0.45)
                    when "Unlimited" is selected
fixedReserve      = outputReserve + 512 safety + 1200 durable memory
                    + 2000 knowledge base (only when enabled)
usableInputTokens = max(512, windowTokens - fixedReserve)
promptTokens      = summaryTokens + systemTokens + unsummarizedTokens
ratio             = promptTokens / usableInputTokens
```

Token estimation charges `ceil(len/3.6)` plus whitespace and punctuation
adjustments, and a flat 700 tokens per attached image.

Two compaction triggers: 0.86 before sending (hard), 0.72 after a completed
answer (normal, so the next turn has room without a surprise pause). At least
the four newest messages are never summarized. Images are replaced with
`[image omitted]` before history goes to the summarizer.

**`force: true` does not guarantee compaction.** It skips the ratio check, not
the budget check -- a conversation that already fits is never folded in. This
is deliberate and explicitly tested.

---

## 7. Persistence

### Source of truth

| Store | Contents | Authoritative |
|---|---|---|
| `data/sessions/*.json` | messages, titles, rolling summaries, image *references* | **Yes** for chat history |
| `data/blobs/` | image bytes, `<sha256>.<ext>` | **Yes** for image payloads |
| `data/knowledge_base/` | Chroma vectors and chunks | Yes for retrieval |
| `data/prompt_index.json` | prompt entries | Yes |
| `data/lora/projects/<id>/project.json` | LoRA project + dataset metadata | Yes |
| `data/generated_images/*.png` | SDXL output | Yes, as browsable artifacts |
| `data/memory.db` | durable memories **and** a message log | Yes for memories; the message log is **not** authoritative |
| `data/trash/`, `data/backups/` | recovery copies | Recovery only |

The SQLite message log duplicates conversation text that nothing reads back.
It is left in place by explicit decision, not oversight.

### Images are stored once

Previously an uploaded picture was saved **twice** in the session JSON -- raw
base64 for Ollama plus a preview data URL for the UI -- and a generated one
existed as a PNG on disk *and* again as base64 in the transcript. Every save
rewrote the whole file; the gallery parsed all of them.

Now `services/image_store.py` stores payloads as files named by the SHA-256 of
their content, and the session keeps `blob:<64 hex>`. Properties this buys:

- The same picture attached twice costs one file.
- A rewrite never rewrites the bytes.
- Content addressing is **self-verifying**: served bytes hash to the filename.
- It retires the positional de-duplication the inline format needed -- both
  halves of an upload pair now resolve to the same reference string.

The reference pattern `^blob:([0-9a-f]{64})$` is deliberately narrow so a
malformed or hostile value cannot escape the blob directory. Writes go to a
`.partial` name and are then moved into place, so a reference is never handed
out for a file still being written.

`/chat` expands references to base64 at the last possible moment, keeping
megabytes off the wire and out of renderer memory. The renderer turns a
reference into a URL against `/sessions/{sid}/images/by-id/{mid}/{iid}`. A
freshly attached image is still a data URL until the save round-trip
completes, so **both forms must render**.

### Migration

Legacy sessions carry inline base64 and migrate when first opened:

1. Copy the original to `data/backups/sessions/<id>.pre-blob.json`, **never
   overwritten** on subsequent runs.
2. Store each payload, confirm it is readable, and only then replace it with a
   reference.
3. Anything undecodable is left exactly as it is rather than discarded.

Migration is idempotent. All four properties are tested.

### Deletion is recoverable

Deleting a chat used to unlink the file immediately with no confirmation,
while removing a *single gallery image* asked first. A conversation is worth
more than one picture.

Now: deletion confirms, moves the file to
`data/trash/sessions/<id>.<stamp>.json`, and a collapsed "Recently deleted"
section in the sidebar offers Restore. If the move fails, it falls back to
unlinking -- losing the safety net must not stop the user removing a chat.

Two permanent-delete routes exist for when the user really means it:
`DELETE /sessions/trash/{filename}` and
`DELETE /sessions/{session_id}/images/{image_id}`.

### Blob garbage collection

Permanent deletion is the only path that reclaims blobs, and it is careful:

- `_reference_is_retained()` scans every stored session **including backups**.
  If a session cannot be read, it returns `True` -- a wasted file is safer than
  a broken recoverable image.
- Permanently deleting an image also removes the migration backup, because a
  backup can contain the exact image the user chose to erase.
- Nothing sweeps orphans in the background. An orphan wastes space; a missing
  blob is unrecoverable. That asymmetry is why reclamation is deliberate.

---

## 8. Image generation

`services/image_generation.py` owns at most one loaded SDXL pipeline so an
8 GB GPU never holds two. Discovery reads each folder's native
`model_index.json` and accepts only `StableDiffusionXLPipeline`.

Memory measures applied on load: native SDPA when supported by PyTorch (attention
slicing only as the legacy fallback), VAE slicing and tiling, model CPU offload,
fp16, TF32 matmul. Workflow frames reuse both weights and the active offload hook
chain until they actually switch pipeline type or adapter. Variants call
`from_pipe(torch_dtype=None)` to preserve each shared component's current dtype;
Diffusers' default float32 conversion would also recast the base pipeline.

### Long-prompt encoding

SDXL's CLIP encoders cap at 77 tokens. `prompt_token_status()` reports how many
77-token chunks a prompt needs; `_long_prompt_embeddings()` encodes in chunks
and concatenates, up to `LONG_PROMPT_MAX_CHUNKS = 4`. Beyond that the request
is refused with the exact token limit rather than silently truncated.

`POST /image-generation/prompt-tokens` lets the UI show token pressure live.

### LoRA at inference

`_set_lora()` loads at most one locally trained adapter, refusing one trained
for a different base model. Weights are applied via `set_adapters` with a
user-controlled scale, and unloaded when switching.

Generation returns both `image_ref` (the blob, what gets persisted) and
`data_url` (so the studio can display immediately without a second request).

### Model-independent image workflow setup

The separate Image Workflows pane and `/image-workflows` API persist owned
reference assets, ordered stage plans, revision-checked drafts, scene branches,
and immutable blocked preparation snapshots. No model provider or executor is
connected. See `IMAGE_WORKFLOWS.md` for storage paths, contracts, API inventory,
and required GPU/Stop/Reset integration before future execution is enabled.

---

## 9. LoRA training subsystem

Newest and largest addition. Four backend layers plus the LoRA Studio UI:

**`lora_store.py`** — projects at `data/lora/projects/<32 hex>/project.json`
with images alongside. Project ids are validated against `[a-f0-9]{32}` before
any path is built. Writes are atomic via a `.partial` file. Images are
de-duplicated by content hash, dimensions read through PIL, captions stored per
image. New projects explicitly choose `character_identity` or `style`; identity
projects require a unique trigger token and receive dataset-diversity guidance.
Project settings, captions, and images are frozen while training is active so
the worker and final snapshot cannot observe different datasets.

Vision-analysis results are persisted separately from editable captions. A
result becomes stale when images, the trigger token, training goal, or selected
vision model changes, and stale suggestions cannot be bulk-applied. The route
also compares the dataset revision before and after analysis so a concurrent
change cannot publish apparently current results.

Successful runs are atomically published under
`data/lora/Complete LoRas/<safe-name>-<8 hex>/`. Each package contains separate
`model/`, `weights/`, `training-images/`, and `captions/` folders plus dataset,
project, and completion manifests. The editable project dataset remains in
place, while the completion package is a reproducible snapshot.

Default training settings: resolution 512, 10 epochs, batch 1, gradient
accumulation 4, learning rate 1e-4, rank 8, alpha 8, AdamW, fp16, seed 42,
save interval 100, crop aspect handling.

`validate_project()` is the preflight gate and returns structured errors,
warnings, estimated steps, and a VRAM estimate:

```
estimate_gib = 6.8 + (resolution/512)^2 * 1.8 + (batch - 1) * 1.2
```

described in its own comment as "a conservative warning, not a promise".
Missing CUDA is an *error*; insufficient VRAM is a *warning*.

**`lora_vision.py`** — discovers installed Ollama models whose reported
capabilities include both `completion` and `vision`, then uses the selected
model for a local, review-first pass over project images in bounded batches of
resized copies. It separates repeated visible traits from per-image view, action,
expression, scene, and quality flags. The prompt explicitly prohibits
real-person identification, face matching, and sensitive-trait inference:
this is descriptive consistency assistance, not biometric verification.
Original images are never modified and suggested captions do not replace user
captions until the user applies them. The request owns the shared GPU lease,
unloads an idle SDXL pipeline, retains Ollama weights between batches using
`LAW_OLLAMA_KEEP_ALIVE_SECONDS`, and releases the lease in `finally`. The queue
explicitly unloads retained Ollama models before image inference or training;
the Stop route cancels the live
upstream HTTP task. The adapter also handles an observed Ollama/Qwen3-VL quirk
where schema output arrives in `message.thinking` despite `think: false`; that
field is used only when content is empty and is parsed immediately as JSON.

**`lora_training.py`** — a process manager permitting exactly one run. Guards
include an in-process lock, a live `Popen` check, an on-disk `training.lock`, and
a process-wide GPU lease shared with image generation. Before spawning, it
unloads any resident generation pipeline. It spawns the worker with
`CREATE_NO_WINDOW` on Windows and watches stdout on a daemon thread, parsing
newline-delimited JSON events (`progress`, `log`, `completed`, `cancelled`,
`failed`) and persisting them. Logs are capped at the last 120 lines.

**`lora_worker.py`** — a separate process that owns the GPU for the run. It
loads both CLIP text encoders, the VAE, and the UNet from the base model,
attaches a `peft` `LoraConfig` to the UNet only, and trains with gradient
checkpointing and accumulation. Model and checkpoint files are written to a run
directory first and copied into an atomic completion package only on success,
**so cancellation cannot expose or overwrite a completed LoRA**.

Running the trainer out-of-process is the right call: it isolates CUDA OOM and
driver crashes from the API server, and makes cancellation a `terminate()`
rather than an attempt to unwind a half-trained model in-process.

New dependencies: `peft>=0.20,<1.0`, `datasets>=5.0,<6.0`, `compel>=2.4,<3.0`.

---

## 10. Knowledge base

`chunk -> embed -> store -> retrieve`, entirely local.

`RecursiveCharacterTextSplitter` at 500 characters with 100 overlap; embeddings
from Ollama's `nomic-embed-text`; Chroma persistent client with cosine space.
Documents are keyed by an MD5 of the filename, so re-uploading replaces rather
than duplicates.

Embedding requests contain at most 16 chunks and reuse a local HTTP connection.
All responses are validated before updating a document; failed or cancelled
embedding batches preserve its previous stored chunks. Upserts replace current
chunk IDs, then remove obsolete IDs. Document lists request metadata only.
Standalone indexing and searches use the shared GPU queue; chat retrieval runs
inside the chat's existing lease. Cancellation retains admission until the
blocking embedding call exits. CPU-only face extraction is tracked by the queue
without claiming its GPU slot, so it can run alongside GPU inference.

`count_documents()` exists as a deliberately cheap probe for `/status` — it
must not pull every document's metadata just to report whether the index opens.

**Known limitation:** ingest embeds one chunk at a time. Roughly 43 seconds for
a 60 KB document. Correct and non-blocking, but a batching or
bounded-concurrency opportunity.

---

## 11. Failure reporting

`/health` only proves the process is alive — the least interesting failure.
`/status` reports what a user must actually fix:

```json
{
  "backend": {"ok": true},
  "ollama":  {"reachable": false, "url": "...", "error": "not_running",
              "detail": "Nothing is listening at ... Start Ollama, or set
                         LAW_OLLAMA_URL if it runs elsewhere."},
  "models":  {"chat_count": 0, "embedding_model": "nomic-embed-text",
              "embedding_ready": false},
  "knowledge_base": {"ok": true, "documents": 0, "error": null}
}
```

It returns **200 even when everything is broken** — problems belong in the
body, not the status code, or the probe becomes indistinguishable from the
outage it reports. Model matching tolerates Ollama's tag suffixes, so
`nomic-embed-text` matches `nomic-embed-text:latest`.

`src/serviceStatus.js` reduces that to one prioritised problem, ordered by what
blocks the user first (unreachable backend hides everything behind it; missing
Ollama makes the model list meaningless), with a severity, a plain-English
explanation, and where one exists the exact command to run:

| Condition | Severity | Action offered |
|---|---|---|
| Backend unreachable | blocked | — |
| Ollama not running | blocked | `ollama serve` |
| Ollama timeout / unreachable | blocked | — |
| No chat models | blocked | `ollama pull mistral` |
| Embedding model missing | degraded | `ollama pull <configured model>` |
| Knowledge base unreadable | degraded | — |

The welcome screen renders this with a copy button; the header indicator names
the problem instead of a generic state. `/chat` additionally emits in-band
`notice` frames when durable memory or RAG failed, so a silently weaker answer
is never mistaken for a normal one.

This replaced a state machine where every failure rendered as "almost ready"
forever — while the backend already knew the answer and `api.js` was
discarding it.

---

## 12. Frontend state and panes

`useStore.jsx` is a `useReducer` plus three contexts (state, dispatch, and a
mutable refs object for values that must survive renders without causing them:
the abort controller, the in-flight request id, and the stop flag).

Preferences persist to `localStorage`: profile, sampling parameters, system
prompt, response style, roleplay configuration, image settings (now including
`loraId`, `loraScale`, `longPrompt`), custom profiles, and the active LoRA
project.

**All four panes stay mounted.** `App.jsx` renders chat, Prompt Index, Image
Studio, and LoRA Studio simultaneously and hides the inactive ones with
`hidden` plus a `#main > .pane[hidden] { display: none }` rule.

This fixed a real bug: switching tabs unmounted the entire chat pane, and the
composer textarea is uncontrolled, so a half-typed message existed only in the
DOM and died with the component. The image studio's result preview and the
transcript's scroll position went the same way.

Because mounting no longer coincides with navigation, panes receive an `active`
prop and refresh their own data when it becomes true.

Sidebar tabs: `chats`, `images`, `generate`, `lora`, `library`, `knowledge`.
The `chats`, `images`, and `knowledge` tabs all share the chat pane.

### The two upload surfaces

Deliberate and **must both remain**: a `+` attachment menu beside the composer
(separate image and document inputs, toast feedback, focus returns to the
message box) and an "Add file to this chat" button plus drag-and-drop over the
transcript (one combined input, type routing, transient in-transcript status).

`useChatUploads.js` shares only the *implementation* — validation, reading,
message construction, persistence, error handling — and each surface supplies
`onStart`/`onSuccess`/`onError`. Errors carry a `userFacing` flag so existing
wording survives verbatim.

The hook threads conversation history through a batch, fixing a bug where
dropping three files saved only the last (each iteration rebuilt from the same
render-time history), and resolves the target session up front, fixing a bug
where uploading with no active session inherited the previous session's
messages.

---

## 13. Logging

Neither process had any logging: eight `print()` calls and thirteen `console`
calls, all going to a console that does not exist in a packaged build.

**Backend** (`services/app_logging.py`) — rotating handler at
`data/logs/backend.log`, 2 MB x 5, with timestamps, levels, and logger names.
Handlers attach to the **root** logger and uvicorn starts with
`log_config=None`, so uvicorn's startup and access lines land in the same
chronological file. An unparseable level falls back to INFO; an unwritable
directory degrades to console-only. Logging must never stop the app starting.

**Electron** (`electron/logger.js`) — same treatment at
`data/logs/electron.log`, dependency-free and synchronous because a log line
arriving after a crash is worthless. Backend stdout is piped in, which is the
*only* record available when the backend dies before its own logging is up —
the most likely failure on an unfamiliar machine. Lines already stamped by the
backend pass through unchanged rather than being double-prefixed, and
multi-line chunks are split so continuation lines stay labelled.

Broad `except` blocks that previously printed now use `logger.exception`, so
failures carry tracebacks.

---

## 14. Tests

`npm run verify` — frontend tests, backend tests, and the production build.
About 35 seconds.

| Backend (pytest, 213) | | Frontend (vitest, 154) | |
|---|---|---|---|
| `test_session_store.py` | 39 | `contextMemory.test.js` | 47 |
| `test_api_smoke.py` | 37 | `markdown.test.jsx` | 42 |
| `test_image_store.py` | 34 | `chatUploads.test.js` | 29 |
| `test_async_offloading.py` | 26 | `serviceStatus.test.js` | 24 |
| `test_config.py` | 19 | `config.test.js` | 12 |
| `test_app_logging.py` | 18 | | |
| `test_prompt_index_store.py` | 15 | | |
| `test_status.py` | 10 | | |
| `test_lora_store.py` | 7 | | |
| `test_lora_vision.py` | 4 | | |
| `test_lora_training.py` | 1 | | |
| `test_gpu_coordination.py` | 2 | | |
| `test_image_prompt_tokens.py` | 1 | | |

Every backend test redirects its stores to a temp directory via fixtures in
`tests/backend/conftest.py`. **No test may touch `data/`.**

Frontend tests run in a `node` environment; `MarkdownMessage` is rendered with
`react-dom/server`, avoiding a DOM implementation entirely.

The LoRA subsystem remains the thinnest coverage in the repository. Store,
completion packaging, analysis normalization/model filtering, API gating, and
the shared GPU coordinator are covered. A synthetic temporary-image probe
completed through the installed `qwen3-vl:8b` runtime; representative user
datasets, the subprocess manager, and the worker optimization loop are not
exercised end to end.

---

## 15. Security posture

Local-only by design and by configuration:

- Backend binds `127.0.0.1`. It previously bound `0.0.0.0`, exposing chat data,
  deletions, uploads, model generation, and a PowerShell-spawning endpoint to
  anyone on the LAN.
- The renderer is served over its own `app://local` scheme and CORS is
  restricted to that origin plus the Vite dev origins. It previously allowed
  the `file://` renderer's `"null"` origin — the same origin every sandboxed
  iframe on the web carries, which made "is this our window?" unanswerable and
  let any page the user visited read this API.
- Every request but `/health` carries a per-launch session credential generated
  by Electron, shared with the backend over its environment and with the
  renderer through its sandboxed preload and main-frame-only IPC. It is never
  stored in preferences or the desktop page URL, and query values are redacted
  from logs.
- The `Host` header must name loopback, which removes DNS rebinding.
- `allow_credentials` is `False`; no cookie auth exists.
- The Vite dev server binds loopback rather than `0.0.0.0`.
- Blob references, LoRA project ids, and trash filenames are all pattern- or
  `Path(...).name`-validated before touching the filesystem. Path traversal is
  tested for each.

Requests now need the session credential, which closes the browser-to-localhost
path: a page the user merely visits has no way to obtain it. **Any other local
process running as this user can still read it** — from the backend's
environment or a compromised trusted renderer — so this is a boundary against the
browser, not against local malware. `/thinking/open-terminal` still spawns a
real PowerShell window and is worth keeping in mind for that reason.

---

## 16. Known issues and open work

Nothing here is urgent; the application is stable.

1. **Uncommitted work in the tree.** The LoRA subsystem, long-prompt encoding,
   blob GC, and permanent deletion are all unstaged. Multiple architectural
   files are untracked. There is no restore point for any of it.
2. **LoRA test coverage is still incomplete** — project storage, completion
   packaging, and GPU lease behavior are covered, but the subprocess manager and
   real worker are not demonstrated end to end.
3. **Unreachable project schema.** `project_name` flows through `ChatRequest`
   into `create_project_if_missing`, but no UI code sends it. The `Project`
   table is dead.
4. **Auto-title inconsistency.** The frontend skips `[File uploaded:` messages
   when auto-titling; `session_store.update_session` does not, so uploading a
   file first produces a title containing the file body.
5. **Knowledge-base ingest speed** — one chunk at a time, ~43 s per 60 KB.
6. **Blob GC is O(sessions) per deletion.** `_reference_is_retained()` reads
   and parses every session file for each reference. Fine at current scale,
   quadratic as sessions accumulate.
7. **SQLite message log** duplicates conversation text nothing reads.
8. **Trash retention** — deleted sessions accumulate indefinitely.
9. **Legacy `frontend/index.html`** (1466 lines) can drift from the React app
   and should be excluded from any package.
10. **README** still documents none of setup, architecture, testing, or
    troubleshooting.
11. **Packaging not started**, by decision. Blockers:
    - `venv/pyvenv.cfg` hardcodes an absolute interpreter path. A Windows venv
      is not relocatable; an embeddable distribution is needed.
    - Electron's `pythonPath` and `backendScript` resolve inside `app.asar`
      once packaged; they need `extraResources` and `process.resourcesPath`.
    - No packaging tool is installed.
    - No application icon; the tray uses `nativeImage.createEmpty()`.
    - torch is ~4.2 GB of a 4.8 GB venv. The agreed plan is a ~1 GB core build
      plus an opt-in script installing image-generation and training
      dependencies.

---

## 17. Design decisions that look like bugs

Recorded so they are not "fixed" by someone reading quickly.

- **`_message_image_records` still has positional de-duplication.** Only needed
  for un-migrated inline sessions. Content addressing handles current data.
- **`data/generated_images/*.png` duplicates the blob.** Retained so the output
  folder stays browsable. A choice.
- **Nothing sweeps orphaned blobs or old trash.** See section 7.
- **`_append_thinking` writes and flushes per chunk.** The thinking terminal
  tails that file with `Get-Content -Wait`; buffering would stall what the user
  sees. Only the redundant directory check was removed.
- **`force: true` does not guarantee compaction.** See section 6.
- **`checkHealth` still exists alongside `fetchStatus`.** Electron uses the
  cheap liveness probe during startup; the renderer uses the full one.
- **`config.py` never logs.** See section 3.
- **`_reference_is_retained` returns `True` on read failure.** Deliberately
  biased toward keeping data.

---

## 18. Route inventory

Complete list of registered endpoints.

```
GET    /health
GET    /status
GET    /models
POST   /chat
POST   /chat/stop/{request_id}
POST   /memory/compact
GET    /thinking/path
POST   /thinking/reset
GET    /thinking/export
POST   /thinking/open-terminal

POST   /sessions/new
GET    /sessions/list
GET    /sessions/images
GET    /sessions/trash
POST   /sessions/trash/restore
DELETE /sessions/trash/{filename}
GET    /sessions/{session_id}
PUT    /sessions/{session_id}
DELETE /sessions/{session_id}
GET    /sessions/{session_id}/images/by-id/{message_id}/{image_id}
GET    /sessions/{session_id}/images/{message_index}/{image_index}
DELETE /sessions/{session_id}/images/{image_id}
DELETE /sessions/{session_id}/gallery-images/{image_id}

POST   /files/parse
POST   /files/knowledge-base/add
GET    /files/knowledge-base/query
GET    /files/knowledge-base/list
DELETE /files/knowledge-base/{doc_id}

GET    /export/{session_id}/txt
GET    /export/{session_id}/md
GET    /export/{session_id}/json

POST   /memory
GET    /memory

GET    /prompt-index
POST   /prompt-index
GET    /prompt-index/state
PUT    /prompt-index/draft
DELETE /prompt-index/draft
PUT    /prompt-index/{entry_id}
DELETE /prompt-index/{entry_id}

GET    /image-generation/models
POST   /image-generation/generate
POST   /image-generation/prompt-tokens
GET    /image-generation/outputs/{filename}

GET    /lora/hardware
GET    /lora/vision-models
GET    /lora/projects
POST   /lora/projects
GET    /lora/projects/{project_id}
PUT    /lora/projects/{project_id}
POST   /lora/projects/{project_id}/images
DELETE /lora/projects/{project_id}/images
GET    /lora/projects/{project_id}/images/{image_id}
PUT    /lora/projects/{project_id}/images/{image_id}/caption
DELETE /lora/projects/{project_id}/images/{image_id}
POST   /lora/projects/{project_id}/analyze
POST   /lora/projects/{project_id}/analysis/apply-captions
POST   /lora/analysis/stop/{request_id}
GET    /lora/projects/{project_id}/preflight
POST   /lora/projects/{project_id}/train
GET    /lora/projects/{project_id}/training
POST   /lora/projects/{project_id}/cancel
GET    /lora/adapters
```
