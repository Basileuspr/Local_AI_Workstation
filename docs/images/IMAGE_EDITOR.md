# Image Editor

The **Image Editor** sidebar tab focuses on one imported image. Open or drop a
PNG, JPEG or WebP, then use red reduction, contrast, exposure and saturation.
Quick buttons reduce red by 60%, increase contrast by 20 points, or reduce
exposure by half a stop. Fine-tune with the sliders; use **Show original**, undo,
redo and reset to compare changes. The current image and adjustments survive
tab switches for the current app session.

These are direct color adjustments, not image regeneration: no shapes, objects,
composition or dimensions are changed by color adjustments. **Rotate left/right**
turns the image by 90 degrees; quarter turns swap width and height. Exposure works in linear light; contrast
and saturation act on decoded RGB values. Red reduction lowers excess red toward
the average of green/blue, so it also affects naturally red objects. Alpha is
preserved. Each current pass starts from the original or the latest locked result;
dragging a slider does not repeatedly apply the same pass. No model or prompt
queue is used. The app's image viewer can send an
image here; `/Edit` uses this editor inside chat. Media Manager stays separate.

**Export edited PNG** downloads a new full-resolution 8-bit sRGB PNG with
`-edited` in its name. The source file is never overwritten by the editor.
Browser/canvas decoding applies image orientation and color conversion; original
metadata and animation are not retained. Transparent RGB values may undergo
browser premultiplication rounding. This is not a byte-identical file editor.
Fit previews stay within 1400 pixels. The 100% view uses full-resolution pixels
for both the original and edited image; 200% enlarges those pixels without
smoothing. Exporting uses the full decoded resolution.
Inputs are limited to 24 megapixels and 40 MiB. A dedicated worker keeps image
processing out of the interface thread. Closing the app releases the edit session;
export a copy to keep the result.

## Locked changes

**Lock current change** saves the current pass as a stage and treats its result
as the source for subsequent adjustments. Slider handles remain where they were;
a fixed pale marker shows the locked position. Each slider reports the locked
value and the current pass's change relative to it. For example, lock Contrast
at 20%, then move to 40% to apply another +20% pass to the locked result.

**Repeat locked change** applies that same pass again, even when a slider is at
its endpoint. It is available after the current pass has been locked or reset.
The expandable stage list records adjustments, rotations, and reference-color
areas, up to 16 stages. **Unlock last stage** makes it editable again; a repeated
stage can be removed. Undo/redo includes these actions. **Reset** clears only the
current pass; **Start from original** clears the entire stage stack. All stage
state belongs to the current editor session. Export a PNG to retain its result
after closing the app. The original comparison always shows the imported image.

## Reference source image

Expand **Reference source image**, import a PNG/JPEG/WebP, and click its preview
to sample a color. The color picker also accepts a manually chosen color.
Choose **Apply color to image**, then click the edited image to color either a
connected area or a brush spot. Tolerance controls how far a fill may spread
through similar colors; brush radius and strength control individual spots.
These settings affect the next application. Undo removes the last application.

**Preserve dark outlines & shading** keeps dark linework and scales the sampled
color by the source's shading. A closed black outline can therefore contain a
skin-color fill while the white background remains unchanged. Gaps in outlines
can let a fill spread; lower tolerance or brush spots provide direct control.
This is explicit local color correction, not automatic semantic recoloring or
reference-guided model inference. Reference files are not modified. Color-area
processing uses full-resolution pixels for both preview and export, with only
the Fit preview reduced to 1400 pixels. Locked stages include color edits.

## Character Parts exports

The three buttons in Character Parts download ZIP copies with PNG media,
caption text files and `manifest.json`:

- **Export Selected Media** uses the checked selections, including pending or
  rejected ones. It does not approve them.
- **Export Approved Media** uses every accepted selection in the current dataset.
- **Export Reject Media** uses every rejected selection in the current dataset.

Approved/rejected exports include all matching states across UI filters. Each
selection retains its Full image / Crop / Both export setting. Shared full images
are exported once; crops remain individually identifiable. The manifest records
scope, revision, review states and existing provenance. Source files and review
decisions are unchanged. Empty selections, foreign IDs, locked media and stale
dataset revisions are rejected. The original accepted-only GET export remains
compatible; the new UI uses the revision-checked POST route.

## Verification

- Frontend tests verify neutral pixels, red reduction, linear exposure, contrast,
  saturation, alpha preservation and output naming.
- Character Parts tests inspect actual ZIP contents for all scopes, validation,
  revision conflicts, locked sources and unchanged source/review data.
- `scripts/qa-image-editor.cjs` runs the production build in a hidden isolated
  Electron profile with synthetic media and a fixture-only backend. It exercises
  worker loading under the app CSP, comparison, undo/redo/reset, tab persistence,
  compact layout, rotated PNG and media ZIP downloads, then checks PNG pixels/dimensions/alpha
  and ZIP manifests. It does not launch the user's app or touch production data.
  Run with Electron using `Start-Process -Wait -WindowStyle Hidden`; optional
  `LAW_IMAGE_EDITOR_QA_RESULT` sets the result JSON path. Other artifacts are kept
  in a fresh `law-image-editor-qa-*` temporary directory.

The expanded QA also verifies exact pixel equality before/after locking,
equivalence between a second pass and repeating a stage, slider markers/deltas,
and reference sampling plus a connected color fill with unchanged outlines,
outside background and source bytes. Pure tests cover stage transitions and
bounded brush/fill behavior. All tests use generated media and isolated data.


## Expanded adjustments and Magic Edit (2026-09-22)

The right panel groups sliders and editable numeric values into White balance,
Light, Color, Texture, and Effects. Added brightness, highlights, shadows, whites,
blacks, temperature, tint, vibrance, sharpness, clarity, Remove blur, low-resolution
refinement, and vignette. Existing exposure, contrast, saturation and red reduction
remain available. All controls participate in locked passes, markers, delta values,
repeat, reset, undo and redo. Quick adjustments collapse to keep the sliders visible.

Remove blur and low-resolution refinement use bounded Gaussian luminance
sharpening without smoothing the source or changing dimensions. They strengthen
existing detail without claiming to reverse arbitrary blur. Texture work runs on
the full source in the existing worker, including for previews, and retains alpha.
Neither CPU tool reconstructs missing detail. /Edit accepts the new adjustment
names plus `remove blur` and `refine image`.

**Magic Edit**, available from the preview toolbar, uses the existing workflow API,
asset validation, persisted snapshots, queue, progress and cancellation. It exports
a copy of the currently edited image (including locked stages) as its input.
Describe a change, choose Whole image or Paint an area, select an installed local
SDXL model and change strength, then generate a candidate. Compare with the input,
explicitly accept as a new editor source, or discard. No generated candidate is
silently applied. Source files and previous workflow outputs are retained.

A painted mask is created at source resolution. The existing SDXL adapter runs
masked or whole-image editing at 256–1024 pixels per side. The candidate is restored
to source dimensions; outside-mask pixels and source alpha are composited from the
full-resolution input. AI can alter or invent detail inside the selected region.
The detail-refinement prompt starts at 20% change strength and keeps output size.
This is an optional generative refinement, not a dedicated super-resolution model.

Up to four references can be given separate roles: background detail/art style,
character skin tone, palette, lighting or appearance. **Read references into
guidance** sends the current image first, then references in order with their roles
to an installed Ollama vision model. Review/edit the resulting guidance before
image generation. This setup uses reference-derived text guidance, not direct
reference-pixel conditioning or guaranteed likeness/style transfer. Manual guidance
and the existing exact reference color sampling/fill remain available without vision.
No new models or dependencies are installed. Unavailable providers are explained
and generation remains disabled until compatible local models/runtime are available.

Verification: 342 frontend tests and 55 focused backend workflow tests passed.
Expanded hidden Electron QA checks the real worker and PNG output pixels, all 17
slider markers, local refinement dimensions/alpha, and the real workflow API/queue
with synthetic providers. It checks ordered reference roles, painted masks, Stop,
candidate comparison/acceptance, and every outside-mask pixel. Model response and
visual quality on real SDXL/Ollama are not verified by these synthetic tests.
`LAW_QA_DIST` can point the hidden QA at an isolated Vite output directory.


## Named color samples and reference requests (2026-09-22)

Reference source image now supports up to 16 named color samples. Add a sample,
choose or sample its color, then apply it to connected regions or brush spots.
The selected sample shows its current-pass area count. Changing its color updates
only its own areas; remove the sample or clear just its areas. Undo/Redo includes
sample creation, names, colors, removal and areas. Locked passes retain their
baked appearance. Fill boundaries for named samples use the same pass source, so
recoloring a boundary with another sample does not merge or split the selection.
Later applications take precedence where their areas overlap.

The **Reference correction request** box accepts a written correction, with a
skin-tone example button. **Prepare this reference edit** opens Magic Edit,
copies the request, assigns the loaded reference to Character skin tone, and
selects painted-area editing. Read/review the reference guidance, paint the
character area, then generate and review a candidate. It does not apply a model
result automatically. The existing local model requirements still apply; no new
models or dependencies are installed. Manual sampled-color editing needs no model.

Verification adds named-sample boundary/removal tests and hidden Electron checks
that export two separately recolored areas, remove one, restore it with Undo, and
compare output pixels. The comment-to-Magic-Edit prompt, source reference role and
painted scope are checked without automatic generation. All image fixtures are
synthetic; this does not measure actual model correction quality.

The final production build passed hidden Electron QA (16 real PNG/ZIP downloads),
including named sample removal/Undo and the reference-request handoff. The full
frontend suite passed 343 cases before the final stable-boundary change, followed
by 16 focused editor tests covering the final change; the suite now contains 344
cases. The production Media Manager integration check also passed after the
embedded folder-choice handoff fix. The user's running instance was untouched.

## Editing history toolbar

Undo, Redo and Reset now sit immediately below the editor header, before the
preview and adjustment controls. The toolbar stays at the top while scrolling.
Rotate left and Rotate right are also directly visible in this toolbar. Each
turns the image 90 degrees; rotation participates in Undo/Redo and PNG export.
The toolbar wraps on narrow screens.
Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z and Ctrl/Cmd+Y work within the editor, while text
and numeric inputs retain their own editing shortcuts. Existing locked passes,
sampled colors and history behavior are preserved. Hidden desktop QA verifies
Undo/Redo and exported image pixels with the moved controls.


## Blur and refinement correction (2026-09-22)

The previous refinement pass smoothed low-contrast pixels and used a hard
sharpening threshold; small features could be softened instead of recovered.
It now applies luminance-only Gaussian sharpening with a gradual threshold,
bounded corrections and no smoothing pass. Remove blur uses a smaller Gaussian
footprint instead of the broad box filter. Both preserve image size, alpha and
RGB channel differences, and exclude hidden RGB from neighboring pixels.
A row cache bounds filter scratch storage. Clarity's existing box filter now
keeps intermediate premultiplied values fractional to avoid false edges in
translucent, flat-colored regions.

Sharpness, Remove blur and Refinement cannot become negative sharpening passes
when their controls move below a locked marker. Use Unlock or Undo to revise a
previously locked sharpening pass. Old negative relative recipes also cannot
silently blur the current source through these one-way controls.

The old 100% option displayed a thumbnail capped at 1400 pixels. Actual-pixel
inspection now uses the same full-resolution processing as export, including
rotated dimensions. Fit view stays lightweight; 200% uses unsmoothed pixels.

Algorithm context: [scikit-image unsharp masking documentation](https://scikit-image.org/docs/0.25.x/api/skimage.filters.html#skimage.filters.unsharp_mask).
This remains local sharpening; it does not reconstruct missing information.
The separate generative Magic Edit path is unchanged by this filter correction.

Verification: 355 frontend tests passed, including six new detail regressions
for weak texture, soft-edge definition, translucent colors, source/alpha
preservation, locked settings and filter symmetry. Hidden Electron QA passed
19 actual PNG/ZIP downloads and checked a 1800 x 900 blurred synthetic image
against its known sharp reference. Mean squared error decreased from 49.514
(source) to 39.911 (Remove blur 35), 44.599 (Refinement 40), and 35.432 (combined).
These are fixture results, not a universal quality guarantee. Its 100% preview
matched exported pixels exactly; original comparison and rotated 200% inspection
also retained native resolution. No real models or user images were used.

## Magic Edit patchwork correction (2026-09-22)

The separate Magic Edit path left small sources at their original resolution.
A saved 355 x 374 source was processed by SDXL at only 352 x 376, producing
large colored patches in the actual saved model output. The canvas preview and
local sharpening pass were not the origin of this particular distortion.

Magic Edit now prepares a working copy with a 1024-pixel longest side and at
least 768 pixels on the other side. Content scales proportionally; extended
edge pixels fill padding instead of stretching narrow images. Painted masks
use the same layout with black padding. Before review, the result is cropped
back to its content and resized to the original dimensions. Source alpha and
all unpainted pixels are restored. Candidates with unexpected dimensions are
rejected. Acceptance remains explicit; existing originals/runs are untouched.
The model, prompt settings, weights and dependencies are unchanged. A larger
working image can take more time and GPU memory than the previous thumbnail.

This matches the [Diffusers SDXL image-to-image size guidance](https://huggingface.co/docs/diffusers/v0.36.0/using-diffusers/sdxl#image-to-image).
An authorized, isolated CUDA comparison used the installed model on a synthetic
355 x 374 image (two shapes and a gradient), with the same prompt, seed 42,
strength 0.2, 30 scheduled steps and guidance 6. At 352 x 376 it reproduced the
patchwork. At 976 x 1024 the patchwork was absent in the inspected output; after
resizing back, mean squared pixel error against the source fell from 267.312
to 22.516. This comparison tests working resolution, not semantic instruction
following or a guarantee of quality on every photograph. Artifacts are under
`tmp/magic-model-diagnostic/`, including `comparison.png` and `comparison.json`.

Regression coverage includes working-size bounds for thumbnails and extreme
aspect ratios, plus real Electron canvas tests for padding/cropping, portrait
and landscape masks, source alpha/dimensions, and untouched pixels. The hidden
editor QA also checks the actual API source and mask dimensions, cancellation,
explicit acceptance and PNG export. The frontend suite contains 368 passing
tests.
