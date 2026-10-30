# Image Workflows

Image Workflows supports explicit processing stages and iterative scenes.
Choose sources and models, review inputs, then run. Each run captures a stable
input snapshot; later edits do not rewrite completed history.
Save, validate, prepare and run actions remain in the scrolling controls above the
editor. Iterative scenes keep Generate first/next frame with the saved-scene
controls. Small panes bound the toolbar height; scroll within it to reach every
action while keeping the scene/stage editor visible.

## Processing stages

Supported providers include SDXL text-to-image, image-to-image and inpainting;
Ollama vision description/OCR; and Pillow resizing. Choose a previous image stage
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
ControlNet and multiple-reference conditioning are not implemented here. The
workflow SDXL provider does not apply Generate’s LoRA selection.

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

## Proposed extensions

Direct reference conditioning (such as IP-Adapter), ControlNet execution and
preprocessing, explicit workflow/Magic Edit LoRA selection, improved masks,
durable editing projects, per-stage recipes and outpainting remain proposals.
Saved references and reviewed vision descriptions do not enable those adapters.

Qwen editing, ComfyUI, OneTrainer, Real-ESRGAN and IC-Light are evaluation
candidates, not installed workflow providers. Any integration needs compatibility,
memory, shared-queue, cancellation and original-preservation checks first.
Trained enhancement/relighting is distinct from Lanczos resizing or generative
refinement. Full training-state resume also remains separate from the existing
interrupted-job handling described in [generation and training](GENERATION.md#lora-dataset-and-training).

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
