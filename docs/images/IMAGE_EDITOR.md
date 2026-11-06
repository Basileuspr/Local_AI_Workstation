# Image Editor

Open/drop a PNG, JPEG or WebP, or send an image from Gallery/chat to the editor.
Local adjustments do not use a model or Prompt Queue. The source file is never
overwritten; **Export edited PNG** creates a new full-resolution 8-bit sRGB image.
Export, compare, preview size and history controls stay in the toolbar while you
scroll through adjustments. In an inline chat edit, the export action is **Send
edited image to chat**. Controls scroll within their own bounded group when the
pane is short; Tab also reaches each control. Apply or cancel a crop before exporting.

Opening images no longer has a 40 MiB / 24-megapixel gate. The browser decoder,
canvas dimensions and available memory remain practical limits; large adjustments
can take longer. Gallery's **Save image as…** exports unchanged bytes without
running an editor or allocating a canvas.

## Adjust and compare

White balance, light, color, texture and effects controls provide editable numeric
values and sliders. Compare with **Show original**; use Undo, Redo, Reset and
90-degree rotation in the history toolbar. Ctrl/Cmd+Z and the redo shortcuts
operate on editor history, while text/numeric fields retain their own shortcuts.

Each pass starts from its source rather than repeatedly applying every slider
movement. Lock a pass to use its rendered result as the next source; markers and
delta values show the relationship to locked settings. Undo/Unlock revises a
previous sharpening pass; moving a sharpening control below its locked marker
does not silently blur the image.

Crop changes the output frame. Fit preview is bounded to 1,400 pixels; 100% uses
actual processed pixels and 200% enlarges them. Remove blur and refinement
strengthen existing detail with bounded sharpening; they do not reconstruct
missing information or change resolution.

Browser/canvas decoding applies orientation and color conversion. Export retains
alpha but not original metadata, animation or byte identity. Keep the original
when those properties matter.

## Reference colors

Load a reference image to sample colors manually. Up to 16 named samples can fill
connected regions or brush areas. Changing a sample affects its own areas; later
applications take precedence where areas overlap. Undo/Redo includes names, colors
and regions, while locked passes retain their baked appearance.

**Prepare this reference edit** copies the written correction into Magic Edit,
assigns the reference role and selects painted-area editing. Review the guidance
and mask before generating. Manual color sampling does not require a model.

## Magic Edit

Magic Edit copies the current edited result, including locked passes, into the
existing workflow system. Choose a mode, describe the change when needed, then
generate a candidate. Compare, accept it explicitly as a new editor source, or
discard it. Stop never accepts a result. Accepting starts a new editor source;
exporting writes a separate PNG and does not overwrite the original file.

| Mode | Behavior |
|---|---|
| Gentle edit / refine | SDXL image-to-image, or inpainting for a painted area. |
| Preserve structure | Canny ControlNet uses extracted source edges or an uploaded Canny map. Thresholds and control influence are adjustable. |
| Use reference images | IP-Adapter Plus pools up to eight attached references as visual conditioning. It does not lock identity or assign each reference a separate visual role. |
| Extend canvas | SDXL outpainting generates small borders. The full-size original interior is restored exactly inside a larger candidate. |
| Enlarge | Trained Real-ESRGAN produces a 2x, 3x or 4x candidate. No prompt or SDXL model is needed. Result amount blends it with conventional enlargement. |

**Use gentle defaults** restores 20% change strength, 50% result amount, 0.5
ControlNet influence, 0.35 reference influence, 32 working-pixel borders and 2x
enlargement. SDXL uses 24 scheduled steps and guidance 4. Result amount is an
explicit source/result pixel blend; it further reduces changes after generation.
The source and generated candidate remain separately available for comparison.
The tested DreamShaper XL base is preferred if installed, while explicit model
choices survive refresh. Other base models can still impose a strong style.

Whole image or Paint an area applies to the first three modes. ControlNet and
IP-Adapter guide the whole working image, then the final composite preserves
everything outside the painted area. Ordinary masked editing also sends a mask
to the SDXL inpainting model. Outpainting and enlargement operate on the whole
canvas and keep their changed dimensions on acceptance/export.

Generation needs the selected provider's installed runtime and assets. Optional
models use the [workflow installation guide](IMAGE_WORKFLOWS.md#optional-conditioning-and-trained-upscaling).
If unavailable, Magic Edit displays the reason. No models are downloaded here.

For refinement, ControlNet and reference edits, the default working copy has a
1,024-pixel longest side and at least 768 pixels on the other side. Proportional
scaling and extended-edge padding avoid stretching narrow
images. The result is cropped/resized back to the source dimensions; source alpha
and unpainted pixels are restored. Unexpected output dimensions are rejected.
Outpainting uses the chosen working canvas as a maximum including borders and
fits the interior to the source proportions, avoiding large accidental padding.
Extremely narrow sources or borders leaving less than a 256-pixel interior are
rejected before creating a run. New border widths scale back to the full-size
source. AI can invent details, seams or objects; gentle settings do not guarantee
likeness or photographic accuracy.

Up to eight references can be assigned roles. **Read references into guidance**
uses an installed Ollama vision model; review its text before generation.
The tested Qwen 3.5 9B is preferred when installed; an explicit choice is retained.
Using one photo for several roles combines those roles into one reference input.
This optional text guidance is distinct from IP-Adapter's direct image inputs.
Roles affect the vision description only. Reference images are sent as visual
conditioning only in the IP-Adapter mode. ControlNet/IP-Adapter accept one CLIP
text chunk: condense long reviewed guidance rather than relying on truncation.
Workflow snapshots record the mode, result amount, scope and original dimensions;
the workflow output is the raw model image, while the editor candidate includes
the final blend/mask/dimension restoration. Workflow and Magic Edit SDXL modes
still do not apply Generate's LoRA selection.

## Character Parts export

Export Selected Media uses the selected parts; Approved/Reject exports include
all matching review states across filters. Each part retains its Full image,
Crop or Both setting. Shared full images are exported once and the manifest
records scope, revision and provenance. Locked sources, foreign selections and
stale revisions are rejected.

[Character Parts](CHARACTERS.md#character-parts) ·
[Image Workflows](IMAGE_WORKFLOWS.md) · [Chat editing](../chat/CHAT_GUIDE.md#images-in-chat)
