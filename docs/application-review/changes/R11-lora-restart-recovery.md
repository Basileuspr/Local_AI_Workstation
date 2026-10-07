# R11: LoRA recovery after backend restart

Implemented October 5–6, 2026 (America/Denver), with final verification on October 6. This record describes source and isolated validation; it does not certify a restarted production desktop or real GPU training.

Previously, a backend restart only reconciled queued training. A project saved as starting, running or cancelling could remain frozen, while the new manager had no child handle to cancel. A stale `training.lock` also prevented another run.

The LoRA router now reconciles persisted runs during backend startup. Dead queued, starting, running and cancelling runs become `interrupted`, with saved progress/logs retained and instructions to start a new run. Existing training controls become available again. Recovery starts no training automatically and does not resume optimizer state from a checkpoint.

Process checks require the exact worker module invocation, the project path in this data directory and the run identifier. New locks also record the child PID and creation time. Command discovery covers older locks and a crash between spawning the child and recording its PID. A reused PID alone never authorizes termination.

A verified surviving worker keeps the shared GPU lease reserved and its dataset frozen. The LoRA pane exposes **Recover previous run**. This action rechecks worker identity, stops only matching workers for that project, waits for their exit and then persists recovery. A worker that exits independently is reconciled on the next training-status poll. Unverifiable recorded ownership retains the GPU reservation and produces a recovery error. Legacy locks also retain ownership if a Python process has an inaccessible command line; inaccessible system processes with other names are excluded. A malformed lock is reconciled through command discovery without trusting its PID.

If the worker published a completed adapter before the backend died, recovery reattaches the package matching the saved project/run instead of treating it as lost training. Existing adapters, datasets, captions and run/checkpoint files are preserved. Restart recovery deletes no run files or caches. The normal finished-worker cleanup continues to remove only its own temporary input cache.

Recovery persists project state before removing the stale lock. A disk-full write failure leaves the saved run and lock retryable. Training-status polling exposes a recovery retry, and a later successful retry completes reconciliation. Startup failures after spawning also wait for child termination before releasing the GPU lease. Monitor failures retain the lock when terminal state could not be persisted.

## Validation

- 92 focused backend tests passed across LoRA restart recovery, training manager, project store, queued workflows, request queue, worker and vision analysis. Four existing FastAPI lifecycle deprecation warnings remained.
- 4 frontend checks passed: deliberate recovery UI, failed recovery keeping training blocked, ordinary cancellation for current-backend runs, and the existing authenticated LoRA API contract.
- A real disposable parent process exited abruptly and left a synthetic worker running. Recovery detected it, prevented GPU admission, stopped it deliberately and verified GPU release and persisted interruption afterward. The synthetic worker loads no models or CUDA.
- Checks cover all active states, legacy ownership discovery, reused/unrelated PIDs, independently exiting workers, frozen live datasets, HTTP submission after dead-run recovery, completion-package byte preservation, checkpoint/original byte preservation, and combined broken-monitor/disk-full persistence failure.
- A scratch Vite frontend build passed (594 modules). It used a separate output directory and no release identity capture. Existing bundle-size and manifold browser-externalization warnings remained.
- Scoped `git diff --check` passed.

Real LoRA training, a forced crash of the production Electron/backend processes, inference quality and GPU resource measurements remain unverified. No live user training data was changed by these checks.

## Changed implementation

- `backend/services/lora_recovery.py`: process identity discovery and verified stopping.
- `backend/services/lora_training.py`: startup/status reconciliation, GPU reservation and lock lifecycle.
- `backend/services/lora_store.py`: raw persisted-state loading for reconciliation and protection for recovered queued ownership.
- `backend/routes/lora.py`: startup lifecycle, status retry and explicit recovery endpoint.
- `src/api.js` and `src/components/LoraStudio.jsx`: recovery request and pane control.
- `tests/backend/test_lora_recovery.py`, `tests/backend/test_lora_queued_workflow.py`, `tests/frontend/loraRecovery.test.jsx`: isolated regressions and updated manager fixture.
