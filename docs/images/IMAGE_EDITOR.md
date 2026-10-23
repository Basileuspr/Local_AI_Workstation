# Image Editor

Open/drop a PNG, JPEG or WebP, or send an image from Gallery/chat to the editor.
Local adjustments do not use a model or Prompt Queue. The source file is never
overwritten; **Export edited PNG** creates a new full-resolution 8-bit sRGB image.
Export, compare, preview size and history controls stay in the toolbar while you
scroll through adjustments. In an inline chat edit, the export action is **Send
edited image to chat**. Controls scroll within their own bounded group when the
pane is short; Tab also reaches each control. Apply or cancel a crop before exporting.

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
existing workflow system. Describe the change, choose Whole image or Paint an
area, select an installed SDXL model and strength, then generate a candidate.
Compare, accept it explicitly as a new editor source, or discard it.

The working copy has a 1,024-pixel longest side and at least 768 pixels on the
other side. Proportional scaling and extended-edge padding avoid stretching narrow
images. The result is cropped/resized back to the source dimensions; source alpha
and unpainted pixels are restored. Unexpected output dimensions are rejected.
AI may invent or change content inside the edited region.

Up to four references can be assigned roles. **Read references into guidance**
uses an installed Ollama vision model; review its text before generation.
This is reference-derived text guidance, not direct reference-pixel conditioning
or guaranteed likeness/style transfer. No models are installed automatically.

## Character Parts export

Export Selected Media uses the selected parts; Approved/Reject exports include
all matching review states across filters. Each part retains its Full image,
Crop or Both setting. Shared full images are exported once and the manifest
records scope, revision and provenance. Locked sources, foreign selections and
stale revisions are rejected.

[Character Parts](CHARACTERS.md#character-parts) ·
[Image Workflows](IMAGE_WORKFLOWS.md) · [Chat editing](../chat/CHAT_GUIDE.md#images-in-chat)
