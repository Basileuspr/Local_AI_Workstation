# Image Workflows

Image Workflows supports explicit processing stages and iterative scenes.
Choose sources and models, review inputs, then run. Each run captures a stable
input snapshot; later edits do not rewrite completed history.
Save, validate, prepare and run actions remain in the scrolling controls above the
editor. Iterative scenes keep Generate first/next frame with the saved-scene
controls. Small panes bound the toolbar height; scroll within it to reach every
action while keeping the scene/stage editor visible.

## Processing stages

Supported providers include SDXL text-to-image, image-to-image, inpainting and
outpainting; optional Canny ControlNet and IP-Adapter Plus; Ollama vision
description/OCR; Pillow resizing; and trained Real-ESRGAN upscaling. Choose a previous image stage
as an input when needed. It resolves after reordering and skips intervening
text-only stages.

Local SDXL is available only when the runtime reports both CUDA and all required
image-generation packages ready. An installed model alone is not sufficient.
Unavailable stages show the runtime's reason, and validation blocks admission
before loading a tokenizer or model. After correcting setup or restarting the
backend, use **Workflow options → Refresh providers** to recheck. Refreshing keeps
the draft and its selections; it does not install anything or submit a job.

Inpainting masks use black to preserve and white to edit, with source-matched
dimensions. Pillow scaling is CPU interpolation and does not invent detail.
It applies image orientation before resizing and writes a new PNG, preserving
alpha-channel, palette and color-key transparency. Opaque sources remain RGB;
source bytes stay unchanged. Each 2×, 3× or 4× output must fit within 24 megapixels.
This transparency guarantee applies to the Lanczos stage; SDXL processing uses RGB.
The workflow SDXL providers do not apply Generate's LoRA selection.

Workflow processing dimensions are restricted separately from Generate. Uploads
accept single-frame PNG/JPEG/WebP and stream to local storage without a 20 MiB /
24-megapixel import gate. Saved Gallery sources copy directly on the backend.
Processing stages still validate their supported output sizes. A workflow is bounded
to 100 assets, 24 stages and eight reference slots. Review validation messages
before running rather than assuming another workspace’s limits apply.

All stages use the workflow’s FIFO job coordination, including CPU stages. GPU
providers also acquire shared runtime admission. Cancel stops at supported
checkpoints. A backend restart interrupts a run without automatically replaying
completed stages; completed artifacts remain inspectable.

## Optional conditioning and trained upscaling

Install the optional packages after preparing the existing SDXL/CUDA runtime:

```powershell
venv\Scripts\python.exe -m pip install -r requirements-workflows.txt
venv\Scripts\python.exe scripts/install-workflow-models.py --all
```

Choose individual IDs instead of `--all`: `controlnet-canny-sdxl`,
`ip-adapter-plus-sdxl`, or `realesrgan-x4plus`. Downloads use the pinned revisions,
sizes and SHA-256 values in `scripts/workflow-model-catalog.json`. Existing
different files are preserved; interrupted downloads resume. Assets remain under
the local models folder. Ordinary discovery and generation never download them.
Restart the backend after installing packages and refresh providers. A receipt
and file-size check establishes installation readiness, not generation quality.

| Stage | Controls and actual behavior |
|---|---|
| ControlNet guidance | Choose an SDXL base and SDXL + Canny ControlNet. Extract edges from the source using low/high thresholds, or upload a prepared edge map. Control influence guides structure; change strength permits redesign. Only Canny edges are supported, not depth or pose. |
| Multi-reference editing | Choose an SDXL base and SDXL + IP-Adapter Plus. Select one to eight reference images and reference influence. Every selected image enters the adapter; the references are pooled rather than assigned independent semantic roles. Source change strength remains separate. This is visual conditioning, not FaceID or an identity guarantee. |
| Outpaint / extend canvas | Choose the local SDXL outpainting provider, final canvas dimensions and four new border widths. The source is resized to the remaining interior. Generated borders are composited around that exact fitted source. New objects, seams and inconsistent surroundings are possible; review the result. |
| Upscale | Select Real-ESRGAN trained upscale for tiled 4× neural reconstruction, optionally downsampled to 2× or 3×. Lanczos remains a separate CPU choice. Alpha is conventionally resized; sources stay unchanged. Trained texture is inferred, not proof of lost detail. |

Conditioning prompts are limited to one CLIP chunk to avoid silent truncation;
ordinary SDXL/outpainting retain their existing longer-prompt support. A zero
change strength preserves the resized source and does not apply conditioning.
All adapters use the existing queue, cancellation, owned-input validation and
immutable run records. Conditioning pipelines are unloaded after each run to
prevent adapter leakage into ordinary Generate. Real-ESRGAN uses bounded tiles
and reports its CUDA/CPU execution device. Outpainting needs no extra model beyond
the installed SDXL base.

The private acceptance helper accepts two explicitly supplied photos:
`scripts/qa-workflow-photos.py --photos <first> <second> --output <external-folder> --model <installed-sdxl-id>`.
It creates PNG copies (including HEIC decoding when installed), executes the real
workflow runner, checks output dimensions/source preservation, and saves private
receipts. It is a GPU workload, not part of ordinary unit tests.

## Remaining extensions

Depth/pose ControlNet, explicit workflow/Magic Edit LoRA selection, automatic
subject masks, per-stage prompt recipes and trained relighting remain separate
work. Qwen editing is available through its separate Generate provider, not this
SDXL workflow adapter. ComfyUI, OneTrainer and IC-Light are not workflow providers.
Full training-state resume remains separate from interrupted-job handling in
[generation and training](GENERATION.md#lora-dataset-and-training).

## Iterative scenes

Start from a reviewed frame and describe the next change. Image-to-image uses
the previous frame with an editable strength; lower strength generally preserves
more of the source but cannot guarantee continuity.

An installed Ollama model can propose up to eight visible changes. Review and
select a proposed change before applying it. Planning does not generate a frame.
Plans carry an expected revision; stale plans are rejected instead of replacing
newer scene work.

Restore inputs reuses a recorded configuration. Branching copies the necessary
inputs into an independent workflow; it does not mutate the original run history.

## Results and cleanup

Results appear under Workflow Images. Download originals with a manifest as a
ZIP, or explicitly keep a result as a reference. Saved gallery copies have their
own lifetime.

The workflow stitch export supports grid/row/column layouts and labels with
24-megapixel, 16,384-pixel and 20-MiB output bounds. For a larger still-image
composition use the separate [gallery stitcher](GALLERY_AND_BULK_ACTIONS.md#stitch-still-images).

Deleting a workflow permanently removes its owned runs, assets and snapshots
after confirmation. External source files and independently saved gallery copies
remain. Active runs block deletion; vault-protected references require the
appropriate unlock/detach workflow. Failed cleanup remains visible for retry.

Hash checks and path validation reject changed or unsafe sources, including
unsupported symlink/junction traversal. Do not bypass these checks by editing
workflow metadata on disk.
