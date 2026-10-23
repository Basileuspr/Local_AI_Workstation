# Image generation, training and queue

Generate and chat share image-model settings and the backend’s model queue.
Install a compatible model/runtime first; selecting an unavailable option does
not download its requirements. See [setup](../setup/SETUP.md) for SDXL and the
optional Verboa runtime.

## Generate

1. Choose the image model, prompt and supported dimensions.
2. Set steps, guidance, seed and any compatible LoRA explicitly.
3. Review the settings and submit. The job captures those inputs and its
   destination chat at submission time.
4. Use the queue to inspect progress, cancel or reconnect to an accepted job.

A blank seed requests a random seed. Negative prompts depend on the pipeline
and guidance setting; do not assume every model uses SDXL conditioning.
Changing the base model clears incompatible adapter choices. Batch generation
creates sequential jobs with the selected seed/prompt progression; it is not a
Cartesian product of every control. Preview the batch before submitting.

## Saved profiles

Image profiles save prompt, negative prompt, steps, guidance and seed only.
Add creates a snapshot; Update explicitly replaces it. Editing controls does not
autosave a profile. Applying one keeps the current model, dimensions, LoRA, output
folder and chat settings. Legacy extra fields are not applied.

## Reference images and analysis

Choose a reference explicitly. Keep-appearance, balanced and reinterpretation
settings control how strongly the source is changed; none guarantees identity or
exact likeness. Padding/crop choices determine how the source fits the requested
canvas. Analyze with an installed local vision model to propose prompt fields,
then review and apply the proposed text. Analysis does not silently train a model
or apply a face embedding.

Strength comparisons hold the chosen seed and denoising budget consistently
across the displayed variants. Actual denoising steps can differ from the
scheduled step count because reference strength uses only part of the schedule.

**Analyze & Iterate** proposes prompt revisions using the selected local chat
model. Other generation settings remain explicit. It does not write durable user
memory or Knowledge. Gallery analysis can prepare a scene draft for review; that
handoff does not automatically generate another image.

## Queue and recovery

Accepted image jobs are owned by the backend. Switching chats, closing a pane
or losing a phone connection does not cancel an accepted job. Work that is still
waiting in a browser-only follow-up sequence has not necessarily reached the
backend. Keep that client open until submission is acknowledged.

Closing the desktop stops its owned backend. A backend restart interrupts active
jobs; they are not automatically replayed. Completed artifacts remain available
through their owning chat/library. Cancellation takes effect at supported
checkpoints and includes runtime cleanup before the GPU can be handed off.

Image, chat, vision and training work share coordinated GPU admission. A queue
position is not a time estimate. Out-of-memory errors do not authorize silently
changing your resolution, steps or model and retrying.

## CPU assistance and timing

CPU assistance prepares data and conditioning while GPU work remains serialized.
Light, Auto and Balanced policies bound worker counts and memory use. Balanced
exposes its preparation budget; it is an estimate for extra preparation memory,
not a cap on the whole Python process. Available RAM and reserved headroom can
reduce the selected budget. More workers do not guarantee a faster run.

SDXL keeps bounded, CPU-only conditioning/reference caches while the relevant
runtime is loaded. Changing models/adapters, resets and runtime cleanup invalidate
the applicable entries. Private sources are checked again when read; cache reuse
does not bypass vault access.

Displayed preparation, queue and denoising times describe different stages.
They are not GPU-kernel benchmarks, and overlapping stages must not be summed
as independent elapsed time. No documented cache or assistance option guarantees
a particular speedup on your hardware.

## LoRA dataset and training

Use the model/training workspace to choose a dataset, review images and captions,
and save training settings. **Analyze & Train** starts a backend-owned sequence:
analyze eligible images, fill blank/automatic captions while preserving manual
captions, unload vision work, then request the training runtime.

Dataset changes are locked while the sequence owns it. Cancel stops subsequent
stages and requests cancellation of the current stage. Restarted backend work is
reported as interrupted, not silently resumed. Inspect completed outputs and
logs before submitting again.

Training exports from [Character Parts](CHARACTERS.md#character-parts) contain
only accepted crops. Creating that export does not start training. SDXL LoRA
training and use are separate from Verboa/ERNIE generation.

## Other image workflows

Use [Image Workflows](IMAGE_WORKFLOWS.md) for explicit processing stages and
iterative scenes, [Image Manager](IMAGE_MANAGER.md) for external folders and
[gallery/review](GALLERY_AND_BULK_ACTIONS.md) for saved results and metadata.
