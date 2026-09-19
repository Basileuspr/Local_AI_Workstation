# CPU Assistance for LoRA

The LoRA Training settings card includes **CPU Assistance** and a **Preloading RAM budget (MiB)**. Save the project, analyze its dataset, start training, or use Analyze & Train; all three actions use the saved setting. Older projects default to Auto and 256 MiB.

| Mode | Preparation workers | Effective preload budget |
| --- | --- | --- |
| Light | 1 | Lower of the chosen budget and 64 MiB |
| Auto | Up to 2 | Lower of the chosen budget and 256 MiB |
| Balanced | Up to 4 | Chosen budget |

The budget accepts 32–2048 MiB. Worker counts also respect the physical CPU count, leaving one core's capacity where possible. This does not set hardware clocks, priorities, or CPU affinity.

Analysis prepares ordered batches in CPU threads while vision requests consume earlier batches. Context-overflow retries reuse already prepared images. Training preloads resized CPU images during initial GPU encoding, then preloads cached conditioning tensors during optimization. Sampling remains on the main training thread to preserve seeded random-number order. The isolated training worker uses one native PyTorch tensor thread to avoid multiplying native thread pools across preparation workers.

## Memory and cancellation

The RAM budget limits **estimated extra preparation work and preloaded buffers**, not total application, model, or activation-offload memory. Image scheduling conservatively accounts for decoded pixels, copies, resized tensors and encoded payloads; cached inputs use three times their serialized size as the estimate. A single foreground preparation can exceed the preload budget, as it could before this change, but does not preload more work in that case.

Scheduling also leaves the larger of 2 GiB or 20% of total RAM available for other work. Low headroom stops new speculative preloads, and oversized items fall back to serial preparation. These are conservative estimates, not an OS-enforced RAM cap. Existing GPU/model memory management is unchanged.

CPU workers prepare only data; they never run concurrent GPU inference. Analysis cancellation joins active CPU preparation and cancels pending work before releasing its GPU queue slot. Training's existing process cancellation and watcher retain the slot until the child process exits.

## Reading the timings

- **Preparation wait:** time analysis waited for prepared batches, including scheduling overhead.
- **Vision requests:** wall time awaiting Ollama requests, including model loading/network overhead and retries; not just GPU inference.
- **Initial preparation:** training's encoder loading, image preparation, encoding, and cache writing before loading the UNet.
- **Training input wait:** time waiting for cached training inputs.
- **Training steps:** tensor assembly/transfers, forward/backward passes, and optimizer work. Reading the loss on CPU completes the CUDA step before the timing is recorded.
- **CPU preparation work:** summed worker durations. This can overlap model work and must not be added to model time as if it were sequential wall time. During training this counter describes the current preparation phase/epoch.

Analysis timings persist in the saved analysis. Training timings are emitted with progress and completion, and persist in the project's training state. Timings exclude queue waiting. Initial preparation excludes UNet loading, and training-step time excludes checkpoint/final package saving, so the displayed categories are not a complete elapsed-time breakdown.

## Local preparation check

Measured on this machine using eight synthetic 1024×1024 PNGs, 512px training preparation, 768px analysis preparation, a 256 MiB requested budget, and the median of three runs:

| Mode | Analysis preparation | Training image preparation |
| --- | ---: | ---: |
| Light | 0.271 s | 0.191 s |
| Auto | 0.274 s | 0.101 s |
| Balanced | 0.270 s | 0.056 s |

The earlier serial code measured 0.328 s and 0.188 s respectively in a single warm run. That separate observation is not a controlled speedup comparison. The three-mode results above compare preparation only, with warm filesystem caches and no actual vision inference or training. They do not establish an end-to-end speedup or real-model training viability. At this budget, the conservative estimate allowed only one prepared analysis batch at a time, explaining why its results were similar.

Implementation uses [Python's thread-pool cleanup API](https://docs.python.org/3.13/library/concurrent.futures.html) and [PyTorch's CPU thread control](https://docs.pytorch.org/docs/stable/generated/torch.set_num_threads.html). No dependencies were added.
