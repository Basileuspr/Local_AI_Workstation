# Generation controls

Generate offers square presets at 512, 768 and 1024 pixels, plus landscape and
portrait ratios. Width and Height also accept custom dimensions within the
local API's 512–1536, multiple-of-eight limits. Aspect ratio is locked by default:
changing either dimension or the Scale slider selects a supported size with the
same exact ratio. Unlock it to change the proportions; unsupported pixel values
round to a multiple of eight. Presets deliberately choose a new ratio. Actual
model memory requirements depend on the dimensions, model and other settings.

Steps: 1–200, presets 10/20/30/40/50/60/100/200, adjustments ±1/5/10/15.
Guidance: 1–30, presets 3/5.5/7/10/15/20/25/30, adjustments ±0.1/0.5/1/2.
Seed: blank for Random or 0–2147483647, adjustments ±1/10/100/1000.
Adjustments clamp at the limits. Starting from Random uses zero as the numeric
baseline; the Random button restores a new seed per image. Seed magnitude is
not an intensity setting. Manual values are validated before submission.

Generate, chat, workflows, and iterative scenes share the 200-step and
30-guidance ceilings. Workflows and scenes also allow guidance 0 to disable
classifier-free guidance; negative prompts require guidance above 1.
Generate defaults remain 24 steps and guidance 5.5. Higher steps take longer,
and higher guidance can reduce image quality. The in-app help covers the full range.

Edits affect the next submission. Running and waiting image requests retain
their captured prompts, models, dimensions, numeric settings and original chat.
Each request has its own Stop control. Stop all image requests cancels all image
requests submitted from this window. RESET DEFAULT only resets the editable draft.

## Batch requests

Expand **Batch requests · vary settings per image** below Generation Settings.
Choose 1–32 images, enable Seed, Steps, Guidance and/or LoRA strength, then choose
each starting value and increment. The preview shows every request before
submission. Enabled settings advance together: four images starting at Seed 1
with +1 and Steps 10 with +2 produce (1,10), (2,12), (3,14), (4,16). This is not a
Cartesian combination of every value. Negative increments are supported.

With Seed enabled, a blank starting seed uses 1. With Seed disabled, a blank seed
remains random for every image. LoRA strength requires a selected adapter.
Out-of-range batches are rejected before submission, instead of clamping later
items to duplicate settings. Queue batch snapshots the entire plan and original
chat. Existing request and Prompt Queue controls provide progress and cancellation;
inference uses the existing serial queue. Per-image labels are saved in chat,
without appending those labels to the model prompt.

## LoRA training guide

The **Settings guide** button at the top of LoRA explains each setting, including
a numerical learning-rate table and the current setting's multiplier relative
to the app default, 0.0001 (1e-4). Inline hints accompany the main settings.
Examples describe relative update scale, not promised image quality. Training
learning rate and Generate's adapter strength are separate controls. The guide
links to the primary Diffusers LoRA documentation for context.

## Verification

`generationBatchDimensions.test.jsx` covers sequences, invalid limits, locked
ratios, persistent stage linking and visible help. `qa-generation-controls.cjs`
uses a hidden Electron window, temporary data/profile and synthetic providers.
It checks actual queue inputs, original-chat persistence, four 512-square PNGs,
cancellation, review exports and editor/workflow handoffs, and prior-output
workflow execution. It does not measure GPU performance or model image quality.

Verification on 2026-09-22: 349 frontend tests, 65 focused backend tests, both
hidden desktop harnesses and the production build passed. The final generation
harness used the production build and verified ZIP payload bytes/captions and
512-square generated fixture PNGs. No real model generation or training was run.
