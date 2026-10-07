# Local AI Workstation performance review — 20 September 2026

> Historical record retained during the October 5, 2026 documentation cleanup.
> Dates, test results, constraints and open issues describe the original work;
> verify current behavior against source and focused tests. Start at the
> [documentation index](../README.md) for maintained guides.

The live hardware matches the supplied specification. This review changed local
source code and ran isolated tests and synthetic benchmarks. It did not modify
user documents, images, datasets, trained adapters, installed models, drivers,
Windows power settings, or generation/training quality settings. The running
desktop backend must be fully restarted to load the changes.

**Verified machine and configuration**

| Component | Verified value |
| --- | --- |
| System | ASUS, x64; Windows 11 Home 10.0.26200, build 26200 |
| Motherboard / BIOS | TUF GAMING Z690-PLUS WIFI D4, Rev 1.xx; American Megatrends 1720 |
| CPU | Intel Core i7-12700K, 12 physical cores / 20 logical processors, 3.60 GHz nominal |
| RAM | Two 16 GiB Gold Key NMUD416E82-3200E modules at 3200 MT/s; approximately 31.7 GiB usable |
| GPU | RTX 3070, 8192 MiB; NVIDIA driver 616.64; VBIOS 94.04.3a.40.2b |
| Disk 0 / C: | Samsung 850 EVO 500GB, firmware EMT02B6Q, SATA; 465.8 GiB physical |
| Disk 1 / N: | Crucial CT1000BX500SSD1, firmware M6CR061, SATA; 931.5 GiB physical |
| Disk 2 / E: and F: | PCIe SSD, firmware ECFM53.1, NVMe; 931.5 GiB physical |
| Windows power plan | High performance, already active |
| Pagefile at initial inspection | C:\pagefile.sys, 8704 MiB allocated, 109 MiB in use |
| Python inference stack | PyTorch 2.11.0+cu128 / CUDA 12.8, Diffusers 0.39.0, Transformers 5.14.1, Accelerate 1.14.0 |
| Face runtime | ONNX Runtime 1.24.2; CPU and Azure providers available, CUDA provider absent |
| Ollama / retrieval | Ollama 0.34.2; ChromaDB 1.5.9; nomic-embed-text for embeddings; requested chat context 16,384 tokens |

The system model string is the placeholder `System Product Name`, which explains
the Dashboard's “Unavailable.” Windows' newer disk API identifies SATA and NVMe;
the supplied IDE/SCSI values are the older CIM interface labels. CPU temperature
is unavailable from the system sensors used by the app.

At initial inspection, C: had approximately **37.1 GiB free of 464.6 GiB**
(about 92% used), E: **289.2 GiB free of 908.2 GiB**, F: **23.3 GiB free**, and
N: **182.0 GiB free of 928.6 GiB**. Utilization readings are snapshots, so they
naturally differ from the supplied readings. Models, application data, and the
Python environment remain in their existing C: locations.

**Changes made and workload coverage**

| Workload | Finding and resolution / reviewed behavior |
| --- | --- |
| Generate, chat images, SDXL workflow stages | Forced attention slicing replaced Diffusers' efficient native SDPA. Keep native SDPA on supported PyTorch, with a legacy fallback. Retain fp16, TF32, CPU offload, VAE slicing/tiling, prompts, steps, resolution and guidance. |
| Repeated img2img/inpaint workflow frames | The manager unnecessarily switched back to the base pipeline before every frame. Reuse the current variant's offload hooks until a real operation or LoRA change requires switching. Shared weights and cache invalidation remain intact. |
| Switching SDXL workflow operations | Diffusers 0.39's `from_pipe` defaults to float32 and recast the shared fp16 weights. A real img2img probe crashed during that conversion in `torch_cpu.dll`. Passing `torch_dtype=None` preserves each component's current dtype, avoids the shared-weight conversion and its extra memory use, and passed repeated img2img, inpaint and return-to-txt2img execution. |
| Chat and memory compaction | `keep_alive: 0` forced cold model loading after each call. Retain models for 300 seconds, configurable through `LAW_OLLAMA_KEEP_ALIVE_SECONDS`. Image/training handoff and Reset still explicitly unload Ollama. |
| LoRA dataset analysis/caption suggestions | Every batch, including context-split retries, unloaded the model. Retain the same model between calls. Existing bounded CPU preprocessing, image order, schema, prompts and review-before-apply behavior remain intact. |
| Workflow image descriptions / OCR | Successful descriptions can reuse the retained Ollama model. Failure and cancellation still await explicit unload before releasing admission. |
| LoRA training and adapter use | Reviewed latent/text caching, bounded preparation, gradient checkpointing, activation offload, optimizer, mixed precision, checkpointing, RNG ordering, cancellation and GPU handoff. Retained the existing memory protections and all training settings; no complete new training job was run. Adapter changes still clear shared workflow variants. |
| Knowledge-base ingestion | Replaced one new HTTP client/request per chunk with batches of 16 on one reused connection. Validate response count, dimensions and finite vectors before writing. Preserve previous document chunks on embedding failure/cancellation. |
| Knowledge-base search/listing and chat RAG | Standalone embeddings now enter the shared GPU queue; retrieval inside chat uses its existing lease. Cancellation keeps the lease until the worker exits. Document listing reads metadata without loading every stored text chunk. Chunk boundaries, embedding model and retrieval settings stay unchanged. |
| Face extraction / Face Studio | CPU-only jobs incorrectly reserved or waited in the GPU FIFO. Added explicit CPU admission: jobs remain visible, paused and cancellable, while GPU inference can proceed independently. |
| Face detection / recognition | Automatic threading created competing large pools for detector and recognizer. Use six threads per session, bounded by CPU count. `LAW_FACE_INTRA_OP_THREADS=0` restores runtime auto-selection. Detection thresholds, embeddings, alignment and crop settings are unchanged. |
| Face Bank, similarity, duplicates, clustering and exports | Reviewed CPU/vector and persistence paths. Existing crop/embedding reuse remains. Similarity/cluster scans may grow with dataset size; no broad data-format or matching changes were made without a measured need. |
| Document upload / PDF OCR | Text-layer extraction runs off the event loop; vision OCR runs only for pages needing it. The existing multi-page OCR loop already retains its model until the final page. Render resolution, transcription prompts and OCR quality remain unchanged. |
| Workflow planning, scenes and CPU upscale | Planning is deterministic validation; Lanczos upscale runs on CPU. Scene orchestration benefits from the shared SDXL changes. ControlNet and multi-reference adapters are currently unavailable capabilities, not performance fixes. |
| Image Review, galleries, collections and workflow exports | Existing pagination and lazy image loading limit rendered cards. ZIP export uses stored PNG bytes and spools large output; stitched exports cache results and bound canvas size. Reviewed without changing original image bytes or privacy guards. |
| Prompt Index, sessions, durable memory and streaming UI | Persistence work is off the main event loop; streamed text avoids a full React update for each token. Session/image listings still scan metadata and are a future scaling concern, rather than a measured current inference bottleneck. |
| Dashboard / shared queue / runtime reset | Hardware samples are cached and blocking probes run off the event loop. Tested CPU/GPU overlap, FIFO admission, model handoff, pause, disconnect and cancellation. Reset retains explicit model unloading. |
| Public web import | Existing bounded downloads, cached results, timeouts and redirect validation remain. No inference bottleneck was found in this network-bound path; local-network and TLS protections remain intact. |

**Measurements on this PC**

These are bounded local probes, not universal speed guarantees. No two
benchmark processes used the GPU concurrently. Test prompts were synthetic;
the image prompt described a mountain lake with no people.

| Probe | Previous behavior | Updated behavior | Evidence scope |
| --- | --- | --- | --- |
| SDXL, 1024×1024, 24 steps, seed 42, guidance 5.5 | 20.74 s sliced attention | 16.42 s native SDPA | One warmed pair after initial warm-up; about 21% lower latency. First native run took 37.07 s, so cold/warm timing is reported separately. Checkpoint load took 6.97 s. |
| SDXL peak allocated CUDA memory | 5507 MiB | 5335 MiB | PyTorch process allocations; excludes desktop/driver reservations. |
| Representative SDXL attention operation | 10.90 ms; 395 MiB peak allocated | 3.28 ms; 82 MiB | Median of seven FP16 calls, shape `[2,4096,640]`; component timing, not whole-image speed. |
| 32 embedding inputs, 500 characters each | 7.378 s | 0.232 s, batches of 16 | Median of three passes with a warm nomic model. Includes HTTP overhead; excludes document parsing and Chroma writes. |
| Qwen3.5 9B repeated short reply | 7.251 s with forced unload | 0.281 s with retained weights | Fixed 7-token response, 16,384 context, temperature 0 and seed 42. First cold call was 21.365 s; token generation itself remained about 0.19 s. |
| SCRFD CPU detector, 640×640 tensor | 131.3 ms automatic threads | 51.6 ms, six threads | Median of seven calls, both detector and recognizer sessions resident. Synthetic input. |
| ArcFace CPU recognizer, 112×112 tensor | 208.9 ms automatic threads | 51.4 ms, six threads | Same methodology; excludes face detection and crop preparation. |

Embedding vectors and face-model probe outputs matched exactly. SDXL's attention
kernel change introduces small numerical differences: the two landscape images
had a mean absolute difference of 1.49 on a 0–255 channel scale, with no obvious
visual degradation on inspection. Repeated native-SDPA runs were pixel-identical
in this check. This is a limited quality check, not a quality claim over every
prompt or dataset.

Raw measurements and reproducible probe scripts are in
`tmp/performance-review/compute-results.json`, `ollama-results.json`,
`sdxl-results.json`, and their neighboring `benchmark_*.py` files. Neutral sample
images are retained there for inspection, outside application data.

**Verification**

The final source passed all **626 backend tests**, **298 frontend tests**, and
the production Vite build. Backend tests used separate temporary data, log and
model directories. `git diff --check` passed. Existing FastAPI startup/shutdown
deprecation notices and the frontend bundle-size warning remain.

Real SDXL execution also covered a 512×512, four-step operation-switching smoke
test: img2img, a second img2img, inpaint, then txt2img. All four produced valid
outputs after the dtype fix, and the protected black-mask region was unchanged.
These reduced-step runs validate operation switching and mask preservation,
not production-quality output or a workflow speed multiplier. The trace and
results are in `tmp/performance-review/workflow-runtime/`.

The Images redesign was checked separately with synthetic gallery data and no
access to the application's personal stores. Browser checks covered search,
viewing and image navigation, selection across pages, saved and rated folders,
workflow search, Hidden Images, the Locked Images PIN screen, source-chat
navigation, and preserved chat drafts. Window widths of 360, 640, 900, 1024 and
1600 pixels showed no horizontal page or gallery overflow.
The verified desktop preview is `tmp/image-library-qa/full-library.png`.

**Remaining limits and decisions**

The 8 GiB GPU remains the limiting resource for larger language models, SDXL
and LoRA training. Installed 20B model files are roughly 12.8–14.7 GiB before
runtime overhead, so they cannot reside entirely in 8 GiB of VRAM. The Qwen
benchmark reported about 6.10 GiB total resident size and 5.12 GiB on GPU.
Reducing model size, context, image resolution, inference steps, training
resolution or training precision could change quality or capabilities; none of
those choices was made.

C: remains nearly full and holds the models on a SATA SSD. Moving model storage
to E: would provide NVMe storage and more room, but this review did not relocate
or delete any files. A storage migration needs destination/path validation and
its own before/after measurement; no disk-speed gain is claimed here. Face CUDA
installation, compilation and training optimizer changes were also left as
separate experiments rather than introducing new memory/dependency risks.

The implemented choices follow the installed library behavior and official
documentation: Diffusers warns against combining [attention slicing with native
SDPA](https://huggingface.co/docs/diffusers/v0.39.0/en/api/pipelines/overview#diffusers.DiffusionPipeline.enable_attention_slicing);
Ollama documents [model retention](https://docs.ollama.com/faq#how-do-i-keep-a-model-loaded-in-memory-or-make-it-unload-immediately)
and [batched embeddings](https://docs.ollama.com/api/embed); ONNX Runtime documents
[per-session CPU threading](https://onnxruntime.ai/docs/performance/tune-performance/threading.html).
