# Image workflows

Image Workflows executes ordered local image stages through the shared Prompt
Queue. Generate and its saved phrase buttons remain separate.

The pane now has **Processing stages** and **Iterative scenes** modes. Iterative
scenes save structured visible state automatically, generate an initial txt2img
frame, and continue from a reviewed frame using img2img. See
[ROADMAP_SEGMENTS_4_6.md](ROADMAP_SEGMENTS_4_6.md) for the schema, API, and limits.

In **Iterative scenes**, create a scene, fill its visible details, choose an
installed SDXL model, then **Generate first frame**. Review its output and choose
**Use as next source**. Change the relevant pose/object fields and **Generate next
frame**. **Restore inputs** restores the selected frame's original state, source,
parameters and resolved seed for regeneration; **Branch from frame** creates an
independent scene with copied reference bytes. Neither action overwrites frames.

Small-change denoise defaults to 0.25; the moderate preset is 0.40. Values remain
editable from 0 to 1. A high value is never selected automatically. State and
prompts preserve explicit appearance, clothing, environment, camera, lighting,
body and object details. Character Face Bank references are copied after explicit
selection; this base SDXL adapter uses text and the previous frame, without
IP-Adapter or face-embedding conditioning. Natural-language multi-step planning
is reserved for roadmap segment 7.

## Use it

1. Open **Image Workflows**, create a workflow and attach source images. The
   chooser supports multiple files; successful uploads are retained if another
   file fails, and duplicate image bytes are counted as already present.
2. Add a stage, choose its source, provider and installed model. Later stages
   can use an earlier image result. Describe / OCR produces text, not an image.
3. For SDXL, enter a positive prompt and choose output dimensions, strength,
   steps, guidance and seed. Inpaint also requires an uploaded matching-size
   mask: white edits, black preserves, gray blends.
4. **Validate inputs** saves and checks the draft. **Prepare snapshot** saves a
   plan without running it. **Run workflow** saves and queues a new immutable
   snapshot; progress and Stop appear in the run panel. Continue editing and
   run again to queue another snapshot. Select any run in history to inspect or
   stop that run; older runs keep their original inputs and output folders.
5. Review completed results. **Keep as reference** copies an image into owned
   assets with run/stage lineage. **Use as positive prompt** explicitly copies
   description text to the draft; no recognition result is silently adopted.
6. **Branch next scene** copies the draft and owned references with parent
   lineage. Select a kept image as the next scene's source.

Save changes before closing. Drafts remain mounted across tabs. After reopening,
select the saved workflow to see its latest run; history exposes older runs.

## Available operations

| Operation | Provider | Requirements and behavior |
| --- | --- | --- |
| Text to image | Local SDXL | Create an initial frame from a complete scene prompt. No source image required. |
| Image to image | Local SDXL | Installed compatible four-channel Diffusers SDXL base and CUDA. Source resized to explicit output dimensions. |
| Masked editing | Local SDXL | Same base and a source-sized mask. Black pixels exactly preserve the resized source. |
| Describe / OCR | Ollama vision | Installed model reporting vision capability. Fixed description/transcription instruction; results remain separate from prompts. |
| Upscale | Pillow Lanczos | CPU resampling, 2x/3x/4x. Changes dimensions without AI detail reconstruction. |
| ControlNet | Unavailable | Requires a compatible adapter, model and control map. |
| Multi-reference editing | Unavailable | Requires a compatible editing adapter. |

No models or adapters are downloaded automatically. Model selection is explicit;
unavailable models block a run. Refresh providers after local setup changes
(Ollama discovery is cached for up to 30 seconds). No LoRA adapter is applied by
this workflow provider.

SDXL accepts 256-1024 pixels per side in multiples of 8, up to 200 steps,
guidance from 0 to 30, and four CLIP prompt chunks. Steps multiplied by strength
must be at least one unless strength is zero, which returns the resized source. Negative prompts require
guidance above one. Seeds resolve once per run; later stages use successive
seeds. Repeating a seed does not guarantee identical output across hardware or
library versions.

Uploads accept fully decoded, single-frame PNG/JPEG/WebP up to 20 MiB and 24
megapixels. Each workflow supports 100 assets, 24 stages, and eight references
per stage. Outputs also respect the image limits. Original uploads stay intact;
providers normalize EXIF orientation and RGB for processing.

## Execution and recovery

`runner.py` persists queued/running/cancelling/completed/cancelled/failed states,
shares `request_queue.py` and `gpu_coordination.py`, and executes sequentially.
Even CPU stages use FIFO admission so a pipeline has one owner. `/runtime/status`
reports active workflows; Prompt Queue displays their stages.

Stop, queue cancellation, global Reset / Unload and backend shutdown signal the
same run. SDXL checks before loading, between denoising steps and before saving.
Loading and native operations must finish before Stop can complete. Coroutine
cancellation waits for the native worker and model cleanup before releasing
the GPU. Ollama closes its stream and awaits an unload acknowledgement.

On startup, unfinished persisted runs become **interrupted**. They are never
automatically resumed. Completed stage results remain reviewable and can be
accepted after a later failure, cancellation or interruption. Uncommitted partial
files cannot be served or accepted and may remain locally for inspection; there is
no automatic deletion or garbage collection. Completed files are hash-checked
before viewing or accepting. This supports one backend process per data directory.

## Storage and API

```text
<LAW_DATA_DIR>/image_workflows/<workflow-id>/
  workflow.json                    # editable draft, revision guarded
  assets/<sha256>.png|.jpg|.webp    # immutable owned upload/result bytes
  jobs/<job-id>/
    job.json                       # immutable input snapshot and preflight
    run.json                       # mutable execution state, seed and results
    outputs/<stage-id>/<uuid>.png   # confined provider output
```

Schema version remains 1. Existing drafts default model/dimensions; old blocked
snapshots remain readable and do not imply execution. Snapshots are never changed
by running, accepting results, or editing a draft. Asset/result paths reject
escape, symlinks and junctions. Corrupt records are preserved, not reset.

All endpoints below are relative to `/image-workflows`:

| Method and path | Purpose |
| --- | --- |
| GET `/capabilities` | Local provider/model discovery without inference |
| GET/POST root | List/create drafts |
| GET/PUT `/{id}` | Read/revision-checked save |
| POST `/{id}/assets`; GET `/{id}/assets/{asset}` | Own and retrieve uploads |
| POST `/{id}/preflight` | Validate inputs/models at the expected revision |
| GET/POST `/{id}/jobs`; GET `/{id}/jobs/{job}` | List/prepare/read immutable snapshots |
| POST `/{id}/execute` | Validate, snapshot and enqueue with expected revision |
| GET `/{id}/jobs/{job}/run` | Poll persisted lifecycle and results |
| POST `/{id}/jobs/{job}/stop` | Signal cancellation |
| GET `/{id}/jobs/{job}/outputs/{output}` | Hash-verified completed PNG |
| POST `/{id}/jobs/{job}/accept` | Keep output at expected draft revision |
| POST `/{id}/branch` | Copy owned references with parent lineage |

## Saving and browsing workflow images

Completed runs automatically appear under **Images → Workflow Images**, grouped
by workflow and run. Existing completed runs appear too. General Images retains
Generate/chat images. This folder reads the owned run outputs directly, so no
migration or duplicate copy is needed. Failed, cancelled and interrupted runs
with committed results remain available with their actual status. In-progress
runs are excluded. The folder refreshes while open and includes a
manual Refresh button, search, and paging. Open a thumbnail for an in-window preview.

In a completed run, or its gallery preview, **Save all images (ZIP)** downloads
every image output from that run in stage order, with a JSON manifest containing
the saved snapshot, settings, seed, and output hashes. The original PNG bytes
are preserved. Description/OCR text is in the manifest; it is not an image panel.

Choose Grid, Horizontal row, or Vertical column, then **Stitch images** to save
and preview a combined PNG. Panels follow stage order and include stage labels.
Images fit without cropping or stretching. Large composites are scaled to at
most 24 megapixels, 16,384 pixels per side, and 20 MiB so they can be uploaded as
reference assets. The PNG also embeds workflow/run/stage provenance. **Save
stitched PNG** exports that file; the composite also appears in Workflow Images.

**Keep stitched as reference** in the Image Workflows run panel adds the composite
to that workflow's owned references, using the current revision and preserving
lineage when branching. Exporting or stitching alone does not accept any output.
To reuse it elsewhere, save the PNG and upload it to another workflow or chat.

Generated composites live beside the run under
`image_workflows/<workflow>/jobs/<run>/artifacts/stitched-v1-<layout>.png`
with hash-checked metadata; original stage files retain their existing paths.
Exports run on CPU in request worker threads and do not acquire the GPU lease.

Routes added: GET `/image-workflows/images`; GET `/{id}/jobs/{job}/download`;
POST/GET `/{id}/jobs/{job}/stitched/{layout}`; and POST
`/{id}/jobs/{job}/stitched/{layout}/accept` (revision required).

## Export verification

`test_workflow_exports.py` checks original archive bytes, stage order, mixed aspect
ratios, PNG provenance, size limits, reference acceptance/branching, invalid or
unfinished runs, tampering, and existing-run gallery discovery using temporary
stores. `workflowExecution.test.jsx` covers folder separation, export controls,
download failures, and revision-bound composite acceptance.

## Execution verification

`test_image_workflows.py` covers storage/planning contracts;
`test_image_workflow_execution.py` uses temporary stores and fake inference for
stage chaining, confinement, integrity, acceptance, FIFO cancellation, worker
exit before GPU release, seed persistence and restart recovery. Frontend tests
cover provider selection, the execution client and result-review controls.
Real-model smoke checks are separate from these deterministic tests.
## Stage sources and dimensions

New image-processing stages use **Previous image stage** when an earlier image
stage exists. This choice remains available after selecting a fixed asset or
stage. It resolves again when stages are reordered or removed, skipping text-only
Describe stages. The UI shows the resolved connection. `source_mode` persists
that intent; the backend also resolves it before validation and execution.
Older workflows without the field retain their explicit source selections.
A previous-stage choice without an earlier image requires correction before run.

SDXL stages share Generate's resolution controls, with the workflow provider's
existing 256–1024 pixel limits. Aspect ratio is locked by default and saved per
stage. New image stages inherit the source proportions when supported. Width,
Height and Scale preserve that ratio; presets or unlocking deliberately change
it. **Match source proportions** reapplies the source dimensions within provider
limits. Extremely narrow/tall sources may require a supported output ratio.

Tests cover save/reload, settings changes, reordering, legacy fixed sources and
actual chained input paths using synthetic providers in hidden desktop QA.

## Workflow deletion

Use **Delete workflow** for the open workflow, or **Select workflows → Delete selected workflows** for a batch. Confirming discards unsaved edits to those workflows and permanently removes their owned assets, snapshots, outputs, stitched images, and storage directories. External source files and downloaded exports are outside app storage.

Saved copies in image collections are retained, including captions, ratings, tags, and locked status. Their workflow origins are removed. Folders used only by the deleted workflows are removed; folders also containing unrelated images remain. Surviving branches retain their independent assets, with parent/source links removed from both drafts and preparation history. Completed queue entries for deleted workflow runs are removed as well.

Deletion is revision-checked and refuses active/queued workflow runs. If there are encrypted image records, enter the Locked Images PIN to detach private associations. The temporary access token is released afterward; saved images remain locked.

Storage failures leave a **cleanup pending** workflow in the selection list. Select it and retry deletion. Pending workflows cannot execute, and saved copies are not deleted during cleanup. Tests use temporary storage and synthetic images.
