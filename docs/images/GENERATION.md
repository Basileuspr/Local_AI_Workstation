# Image generation, training and queue

Generate and chat share image-model settings and the backend’s model queue.
Install a compatible model/runtime first; selecting an unavailable option does
not download its requirements. See [setup](../setup/SETUP.md) for SDXL and the
optional Verboa runtime.

## Installing image models

Image weights are local to each PC and are not included in Git or the setup
script. The reviewed catalog can be installed from the repository root:

```powershell
venv\Scripts\python.exe scripts/install-image-models.py --all
```

Choose individual IDs instead of `--all` to limit the download:

| Model ID | Source and focus | Reference images in this app |
|---|---|---|
| `dreamshaper-xl-1-0` | [DreamShaper XL](https://huggingface.co/Lykon/dreamshaper-xl-1-0), illustration and general generation | Yes |
| `animagine-xl-4.0` | [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0), anime; standard checkpoint, not the separate Opt file | Yes |
| `illustrious-xl10-improved-uncensored-v30` | [Illustrious Improved Uncensored v3](https://huggingface.co/John6666/illustrious-xl10-improved-uncensored-v30-sdxl), anime; Diffusers conversion credited to Shopon_Skp | Yes |
| `verboa-image-1.0-nf4` | [Verboa Image 1.0 NF4](https://huggingface.co/verboa/Verboa-Image-1.0-nf4), photorealistic adult-oriented model documented in the earlier setup guide | No; text-to-image only |

“Uncensored” is the checkpoint publisher's label, not a guarantee of unrestricted
behavior or licensing. Verboa retains documented safety tuning. Review each
source's model card and license. Verboa requires accepting its access terms and
then authenticating locally with `venv\Scripts\hf.exe auth login`. Never place a
token in source files or shared logs. A failed entry does not prevent the installer
from attempting the remaining selected entries, but the command exits nonzero.

The installer pins source revisions, prefers FP16 SafeTensors, checks sizes and
published LFS SHA-256 hashes, and records `installation-manifest.json` per model.
It exposes a completed folder under `models/diffusers` only after verification;
interrupted files stay in `models/.installing` and can resume with the same command.
Existing folders are preserved; matching installs are rechecked. FP16 variant
files receive hardlinked default names for the application's loader. No remote
Python model code is loaded. `LAW_MODELS_DIR` or `--models-dir` changes the local
model root. Installing weights does not install optional Python dependencies.

Refresh the model list in Generate after installation. A model in a different
family needs a corresponding application provider; downloading arbitrary weights
does not make it selectable. [FLUX.2 Klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)
and [Qwen Image Edit 2511](https://huggingface.co/Qwen/Qwen-Image-Edit-2511) are
further editing candidates, not supported providers. Their quantization, memory
use and integration need separate evaluation.

## Generate

### Qwen image editing and Wan video

The **Qwen images & Wan video** tab inside Generate uses a separate local
`stable-diffusion.cpp` CUDA runtime. Install its pinned runtime and models on each PC:

```powershell
venv\Scripts\python.exe scripts/install-media-models.py --runtime --all
```

Wan output validation also uses the optional local video decoder installed by
`venv\Scripts\python.exe -m pip install -r requirements-audio.txt`. Missing decoder
support is reported before a video job is accepted.

Individual model IDs can replace `--all`. The installer verifies published file
sizes and SHA-256 hashes, shares companion files between models, resumes partial
downloads and writes a completed installation manifest only after verification.
The catalog is in `scripts/media-model-catalog.json`; binaries and weights stay
under the local `models` directory and are excluded from Git.

Set `LAW_MEDIA_MODELS_DIR` to an absolute local folder to put just Qwen/Wan
weights and their runtime on another drive. The installer and backend use the
same setting; restart the app after changing it. Other model families retain
their existing location. `--models-dir` overrides the installer destination
only, so it must match the backend setting. These public downloads do not send
Hugging Face account tokens, and the installer disables Hub telemetry.

| Model ID | Purpose | References |
|---|---|---|
| `qwen-image-2.1-turbo-q4` | [Qwen Image 2.1 Turbo Q4](https://huggingface.co/abenzerps/Qwen-Image-2.1-Turbo-Quantized), with the official quantized [Qwen3 VL encoder](https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF) | Up to four ordered images; describe what to change and preserve |
| `wan2.2-ti2v-5b-q4` | [Wan 2.2 TI2V 5B Q4](https://huggingface.co/QuantStack/Wan2.2-TI2V-5B-GGUF), standard text/image-to-video | Optional first image |
| `wan2.2-i2v-14b-uncensored` | [Wan 2.2 I2V 14B Uncensored](https://huggingface.co/rzgar/wan2.2-i2v-A14B-Uncensored-base), two-expert video model | One first image required |

Wan 5B starts at 832 × 480, 50 steps and guidance 5, using the simple scheduler
and flow shift 5. This recipe produced coherent text-to-video output in the
November 10 local GPU checks; the earlier 20-step/discrete recipe produced
corrupted imagery. Video dimensions accept multiples of 16, including 480.
Selecting a model restores its suggested dimensions and generation defaults.

The 14B publisher includes a tensor-name prefix that the runtime cannot load
for the high-noise expert. The installer retains the original checkpoint and
creates a compatible SafeTensors copy with renamed header keys and unchanged
tensor data. Both the source and prepared file have pinned SHA-256 hashes.
This requires approximately 14.55 GB of additional disk space. Existing installs
can run the same model installer again; changes to generation defaults do not
invalidate unchanged, pinned weight files.

The Wan checkpoints above are alternatives to the WAMU checkpoint used by the
`kulkas2pintu/wan777` hosted Space, not copies of that Space's deployment. The
uncensored labels come from the checkpoint publishers. No unrestricted-behavior
guarantee or independent abliteration claim is made.

These are community model distributions. The original projects are
[Qwen Image 2.1](https://github.com/QwenLM/Qwen-Image-2.1) and
[Wan 2.2](https://github.com/Wan-Video/Wan2.2); the local runtime comes from
[stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp).
The old Qwen Uncensored catalog revision is no longer available from its
publisher. Turbo uses a distinct model ID, the published eight-step sigma
schedule, and default guidance 1. Its step count is fixed to match that schedule.
Existing historical results retain their original model names.

Choose a model, enter a prompt, optionally upload reference images, then submit.
For Wan, select the frame count and frame rate. The 14B model's Steps setting
applies separately to its high-noise and low-noise experts. Results stay in this
tab's generation history; save images as PNG and videos as WebM. Completed Qwen
images also appear automatically in Gallery's General and Saved collections,
including existing outputs when Gallery opens. Gallery owns independent copies;
deleting one preserves the generation original and does not recreate the copy.
These jobs are not attached to a chat automatically. Restarting the backend marks
unfinished jobs as interrupted; it does not silently replay them.

Jobs use the same GPU admission queue as other workstation tasks. The provider
unloads the idle image pipeline before starting its subprocess. Memory mapping,
automatic GPU/RAM/disk placement, a 6 GiB managed VRAM budget, sequential CFG and
tiled VAE decoding reduce memory demand. Disk offloading can be very slow.
Stop terminates the subprocess even while it is loading. Failed requests are
not automatically retried with changed dimensions or models.

The [November 10 GPU acceptance record](../development/VERIFICATION.md#november-10-real-qwen-and-wan-generation)
covers a Qwen image, Wan 5B text/image-to-video, and Wan 14B image-to-video.
These short synthetic examples do not establish quality for every prompt or
maximum-size/long-video performance.

Running Qwen/Wan requests appear above the form with a preparation bar, elapsed
time and Stop. Once generation steps begin, the bar shows measured steps and
an approximate remaining generation time; decoding and saving add time. Wan
14B counts both experts, so 30 steps per expert means 60 total generation steps.
Loading, prompt/reference encoding and disk offloading may take several minutes
without a reliable completion estimate. Hardware utilization is a separate
measurement and is not the percentage of a generation job completed.

The runtime bubble and Prompt Queue use the same active-job status, including
preparation and stopping. Clicking a media job in Prompt Queue opens this tab.
Switching tabs preserves accepted jobs. If progress cannot be refreshed, the
last report is marked unavailable and its elapsed clock freezes until recovery;
a model-inventory failure does not hide job progress. Queue history estimates
for media require matching model/settings rather than unrelated chat durations.

Private recipes, outputs and bounded diagnostic logs live in
`data/generated_media/<job-id>`. Reference-image access is checked again when
the queued job starts, and temporary reference files are removed afterward.
New Qwen/Wan exports omit the runtime's embedded generation metadata. Prompts
remain in local history and diagnostic logs. Inference runs through a local CLI;
downloading models contacts GitHub/Hugging Face and their download infrastructure.
The **App media and documents** reset section includes these jobs and outputs.
Existing SDXL close-variation controls remain in the **Image generation** tab.

### SDXL and Verboa controls

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
