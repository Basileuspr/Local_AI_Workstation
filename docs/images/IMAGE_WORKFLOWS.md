# Image Workflows

Image Workflows supports explicit processing stages and iterative scenes.
Choose sources and models, review inputs, then run. Each run captures a stable
input snapshot; later edits do not rewrite completed history.

## Processing stages

Supported providers include SDXL text-to-image, image-to-image and inpainting;
Ollama vision description/OCR; and Pillow resizing. Choose a previous image stage
as an input when needed. It resolves after reordering and skips intervening
text-only stages.

Inpainting masks use black to preserve and white to edit, with source-matched
dimensions. Pillow scaling is CPU interpolation and does not invent detail.
ControlNet and multiple-reference conditioning are not implemented here. The
workflow SDXL provider does not apply Generate’s LoRA selection.

Workflow image dimensions are restricted separately from Generate. Uploads accept
single-frame PNG/JPEG/WebP within 20 MiB and 24 megapixels. A workflow is bounded
to 100 assets, 24 stages and eight reference slots. Review validation messages
before running rather than assuming another workspace’s limits apply.

All stages use the workflow’s FIFO job coordination, including CPU stages. GPU
providers also acquire shared runtime admission. Cancel stops at supported
checkpoints. A backend restart interrupts a run without automatically replaying
completed stages; completed artifacts remain inspectable.

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
