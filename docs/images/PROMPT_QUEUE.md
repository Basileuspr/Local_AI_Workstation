# Prompt Queue

Chat, image generation, LoRA training, LoRA dataset analysis, and chat-memory
compaction share a first-in, first-out queue. Submit through the existing tabs.
Requests wait when another local GPU task is active. The Prompt Queue tab shows
waiting positions, running work, recent outcomes, and cancel/stop controls.
Generate and chat image controls remain editable during requests. Each image
submission captures its settings and destination chat; its request card can be
stopped independently. Reset Default clears the draft without cancelling jobs.
Image workflow drafts also remain editable: every Run creates a separate,
immutable snapshot and can wait behind earlier runs of the same workflow.

Chat accepts follow-ups while a reply is running. Follow-ups wait in the window
until the earlier reply is saved, then join the shared backend queue with updated
conversation context. They are visible and cancellable in the composer and
Prompt Queue. Model/settings and destination are captured at submission.
Follow-ups are not yet backend jobs or persisted messages while waiting for that
reply, and other submitted model work can therefore enter the backend queue first.
Reset / Unload clears these waiting prompts as well as cancelling active work.

LoRA projects retain dataset/settings locks during their own analysis or training;
the project picker and New button remain available to prepare another project.
Analysis results and training refreshes stay attached to their original project.

The queue is scoped to the current backend run. Chat and image requests depend
on the submitting window staying open. Restarting does not replay requests;
an old queued LoRA project becomes interrupted and can be submitted again.
Validation errors and provider failures are reported rather than retried forever.

## Execution and cancellation

- `backend/services/request_queue.py` owns FIFO admission, bounded recent
  history, cancellation signals, and provider handoff preparation.
- `gpu_coordination.py` reserves the GPU for the next job and lets its service
  consume that reservation once. Cancelling a job does not release its slot;
  its handler/worker must finish cleaning up first.
- Image generation stays in the thread pool; waiting requests use asynchronous
  waits so the API remains responsive.
- LoRA `/train` returns HTTP 202 with queued training state. A background task
  retains queue admission until the training watcher finishes. Project edits
  and dataset changes are locked while queued or training.
- Chat streams retain their request IDs and Stop behavior. GPU allocations
  from the preceding provider are released before the next provider starts.
- Reset / Unload cancels pending work before resetting ordinary runtimes.
  Existing restrictions on resetting during active LoRA/OCR work remain.

## Results and API

- `GET /queue` returns current jobs and recent history.
- `POST /queue/{job_id}/cancel` cancels a waiter or signals a running job.
- `POST /sessions/{session_id}/messages/append` merges messages by stable ID
  under a store lock. Queued results do not replace another request's messages
  or redirect the UI to a chat the user has left.
- The frontend queue provider shares one status poller across the queue page
  and source-tab status indicators.

Verification covers mixed FIFO execution, GPU reservation handoff, cancellation
before and during execution, training lifetime, stream cleanup, unavailable
clients, restart handling, and concurrent result appends. Browser checks use
isolated data and simulated providers; they do not prove real model performance
or training quality. Backend tests should run with `LAW_DATA_DIR` set to a
temporary directory before importing the application.
# Analyze and train a LoRA in one queued workflow

The LoRA pane's **Analyze & Train** action saves the visible project settings and submits `POST /lora/projects/{project_id}/analyze-and-train`. The backend returns HTTP 202 and runs both stages without keeping the submitting browser request open. Choose a vision model, image base model, and dataset first.

One FIFO queue entry owns the entire workflow. The queue and LoRA pane show the analysis/training stage. After complete analysis, the workflow fills blank or automatically created captions, preserving edited captions and older nonempty captions whose origin is unknown. Existing **Analyze current dataset** and **Apply all suggested captions** controls remain available for manual review and replacement.

Training starts only after every current image has a valid analysis suggestion. Analysis failures, cancellation, and changed datasets prevent the handoff. The worker rechecks training readiness before launch. Model handoff retains queue admission while releasing the vision model and reserving the training GPU lease. Project settings, captions, and datasets stay locked while the workflow is queued or active.

Cancel from either the LoRA pane or Prompt Queue stops the current stage and prevents the remaining stages. The GPU slot is held until provider/process cleanup completes. Pending workflows are not resumed after a backend restart; they become interrupted and can be submitted again. As with ordinary training, closing a pane does not cancel the server-owned workflow.
