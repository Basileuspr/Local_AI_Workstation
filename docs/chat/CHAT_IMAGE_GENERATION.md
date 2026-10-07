# Generate images from chat

Select an **Image model** above the normal message box, then an optional compatible **Image LoRA** and strength. Type an image description in the message box and click **Generate image**. Send and Enter continue to submit text chat.

**Image settings** opens Generate for negative prompts, dimensions, steps, guidance, seed, and other settings. These settings and image-model/LoRA selections are shared between both surfaces. Chat uses the message-box description without replacing the prompt draft in Generate. Changing the image model clears its LoRA selection. RESET DEFAULT clears both surfaces' shared image settings.

Both surfaces use the existing image generation API and Prompt Queue, with shared progress and Stop controls. Multiple requests and comparison batches can be queued; GPU inference remains serialized. Text requests can still join the queue while an image is waiting or running. Results are appended to the original chat, even when another chat is opened. These are image-model LoRAs; they do not modify the language model's text replies.

Implementation: `ImageGenerationContext.jsx` owns shared image state and cancellation; `chatImageGeneration.js` builds requests and persists source-chat messages; `ChatImageControls.jsx` adds the chat controls. Existing backend model compatibility and GPU queue checks remain authoritative.

Validation includes request mapping, adapter compatibility, cancellation during preparation and inference, source-chat persistence, provider failures, frontend tests/build, and an isolated browser workflow with simulated image responses. No live model inference was needed for this UI change.

## Reference likeness and emulation

Use **Use as Generate reference** in shared image actions to bring gallery, chat, workflow, character-library images or selected face crops into Generate. This stages a reference without submitting a generation or changing the prompt. Upload, paste, drop and generated-output reuse remain available. Locked sources are checked before handoff and again when stored or run.

**Keep appearance**, **Balanced emulation**, and **Reinterpret style** set change amount, steps and guidance together. Keep appearance uses 25% change with 80 scheduled steps: 20 actual denoising steps, compared with seven at the default 30% of 24. More refinement is not a guarantee of better likeness. **Increase refinement steps** accounts for the selected strength and the shared 200-step ceiling.

**Fit whole image (extend edges)** preserves the full source and pads using border pixels. White padding and explicit center cropping remain choices. **Match source proportions** can reduce padding. Originals remain unchanged.

**Read likeness, style and composition** uses an installed Ollama vision model through the existing image-workflow queue. Analysis creates a local saved workflow, with separate editable appearance, style, composition and lighting observations. Select which fields to add to the current prompt; uncertainty stays out of the generation prompt. For style-only emulation, add style and lighting, then remove the pixel reference. Empty or malformed model output is rejected. Stopping or replacing the reference cannot apply stale observations to a new source.

**Compare change amounts** queues up to three nearby strengths with one shared seed and a matched actual denoising budget, bounded by the existing step limit. Prompt, dimensions, model and LoRA remain the same. Each request captures its own strength before upload; queued references and generation recipes remain independent of later UI edits. Results use the existing batch preview and source-chat persistence.

Compatible LoRAs show whether they were trained for character identity or style and expose **Add LoRA trigger to prompt**. Selection alone does not infer an identity or alter the prompt. Large pose or composition changes can still change identity; this pipeline does not add a face-embedding adapter or an automatic likeness score.

Validation uses isolated backend tests, frontend tests, a scratch production bundle, and `tests/fixtures/generateReference.html` with simulated models. These checks verify request routing, review behavior, pixel fitting, cancellation contracts and saved recipes; they do not measure real-model likeness or GPU output quality.

## Generation runtime and overlap

Generate batches keep GPU inference serialized, but release the GPU queue slot
before PNG encoding, blob registration, and output-folder copying. These CPU
tasks can overlap the next image or chat request. At most two images may be in
the saving stage when another image starts. Stop remains available until output
work finishes, and files become visible only after PNG encoding completes.

Switching to chat moves SDXL to CPU memory and keeps its weights for reuse when
at least 8 GiB or one quarter of system RAM (whichever is larger) remains free.
With less headroom it unloads as before. Training and explicit runtime reset
still unload the image model. This saves reload work when RAM permits; it does
not make simultaneous heavy GPU jobs fit in an 8 GB card.

Long-prompt encoding uses the actual execution device even when sequential
offload stores encoder weights on the `meta` device. This prevents the Compel
padding device mismatch with Allow long wait. Inference errors and cancellation
discard the interrupted runtime before the next request. Model, precision,
resolution, steps, prompt content, and seeds are not changed by these fixes.

`scripts/qa-generation-runtime.py --model MODEL_ID` is an opt-in real SDXL check
for long-prompt batches, CPU/GPU overlap, repeated seeded pixels, RAM handoff,
and cancellation/recovery. It uses fresh temporary output storage, no LoRA,
and should be run while the desktop GPU queue is idle. Its deliberate save
barrier tests overlap; its timings are not a throughput benchmark.

September 27 validation: the real 512px/four-step long-prompt batch passed with
Allow long wait, identical pixels for repeated seeds, concurrent CPU saving,
and cancellation followed by successful regeneration. The machine's available
RAM triggered the unload fallback; live retention was not demonstrated in that
run. Earlier runs also encountered an intermittent native `torch_cpu.dll`
access violation during reload. Later isolated reload checks and the complete
smoke passed, but that native crash is not considered resolved by these changes.
