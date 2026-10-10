# Generation controls and iteration

Combined reference for related controls. Verification results below retain their original scope and dates.


<a id="generation-controls"></a>

## Generation controls

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

### Batch requests

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

### Automatic CPU and RAM preparation reuse

SDXL keeps exact prompt conditioning in a disposable CPU RAM cache (up to 16
entries / 64 MiB), including Generate's long-prompt Compel path and native
short-prompt workflow encoding. Repeated prompts can reuse conditioning when
seeds, dimensions, steps or guidance amounts change; classifier-free guidance
on/off, negative prompts, secondary prompts, clip skip and encoding batch size
remain distinct. Model unload, offload-strategy changes, LoRA selection and LoRA
weight changes invalidate conditioning. Explicit embedding inputs and transient
Diffusers LoRA scaling keep their native encoding path. ERNIE retains its existing
conditioning cache.

Generate's reference preparation has a separate 8-entry / 64 MiB RAM cache.
It reuses the exact EXIF-oriented, alpha-composited and fitted RGB pixels for
the same source, dimensions and fit choice. Every use still reads and verifies
the original bytes and vault access. A changed, missing or locked source cannot
be served from cached pixels. Originals are preserved.

Both caches return independent copies, evict older results and bypass caching
when RAM is tight. The existing RAM guard reserves the larger of 2 GiB or 20%
of system RAM; the extra preparation caches together retain at most 128 MiB.
Runtime reset clears both. Prompt keys are hashed; cache contents stay in this
backend process and are never saved to disk. `/image-generation/models`
reports entries, retained bytes, hits and misses under `runtime.preparation_cache`.

This reduces repeated preparation; a new prompt still requires encoding and
GPU denoising still dominates many requests. The first request can include the
small CPU-copy cost. Steps, scheduler, seed, precision, offload strategy and the
serial GPU queue are unchanged. Reference preparation and PNG saving remain
CPU work; this does not run a second model alongside an active generation.

`test_image_generation_cache.py` checks exact tensor values, independent copies,
argument separation, LoRA/reset invalidation, RAM limits, allocation failures,
reference access checks and seeded pixel equality through the installed native
Diffusers SDXL pipeline using tiny local CPU weights. Those fixtures establish
cache behavior, not full-model GPU quality or end-to-end speed on every model.

CPU measurement on 2026-10-09, five samples with an 11 MiB synthetic 2560 × 1440
PNG fitted to 1024 × 1024 with Extend edges: median preparation was 189 ms without
caching and 25 ms with a warm cache, with identical output pixel hashes. The
first cached preparation took 190 ms. This measures reference preparation only;
it is not a claim of a comparable improvement in total generation time.

### LoRA training guide

The **Settings guide** button at the top of LoRA explains each setting, including
a numerical learning-rate table and the current setting's multiplier relative
to the app default, 0.0001 (1e-4). Inline hints accompany the main settings.
Examples describe relative update scale, not promised image quality. Training
learning rate and Generate's adapter strength are separate controls. The guide
links to the primary Diffusers LoRA documentation for context.

### Verification

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

<a id="analyze-and-iterate"></a>

## Analyze & Iterate

Generate and the image library use the same button label for two related actions.

### Generate: revise prompts in place

Enter a positive prompt, then select **Analyze & Iterate**. Choose a local chat model, describe the desired change, and optionally specify exact character names or trigger words to retain. The analysis model, iteration goal and preservation notes carry over between reviews until the app closes.

The dialog proposes positive and negative prompts and explains the revision. Edit the suggestions if needed, then choose **Apply prompts to Generate**. The model, LoRA, seed, dimensions and other generation settings remain unchanged. Press Generate when ready, then repeat for another individual image or training variation. This path does not create an iterative scene or require a generated image.

Prompt analysis uses the existing request queue. Stop or close cancels the analysis. It does not read or write durable chat memory, load knowledge documents, or append messages to a chat. Invalid, incomplete or cancelled responses cannot replace the prompts, and changed Generate drafts must be reviewed again before applying an older proposal.

### Image library: review a scene from an image

Open an image in General, Hidden, Saved, Liked, Disliked, a folder, or Workflow Images. The viewer's **Analyze & Iterate** button opens a vision-analysis dialog. Select an installed local vision model and choose **Analyze image**.

Review its observations, uncertainties and possible next steps. **Open scene draft** opens Iterative scenes with an owned copy of the original source and editable observed details. Suggested future actions remain in the notes and are not applied automatically. Existing scene edits are saved before switching. Generation remains an explicit action in the scene editor.

Scene sources currently support PNG, JPEG and WebP. Locked images are not copied into public scenes. The scene editor supports a canvas from 256 to 1024 pixels per side, in multiples of eight; inspect the transferred size before generating. Original image bytes stay intact. Image model selection is explicit.

Analysis runs retain their snapshots and model metadata in Image Workflows, including unsuccessful attempts. Closing a running image analysis requests cancellation and waits for the queue's terminal state. Existing workflow Stop and runtime-reset behavior also apply.
