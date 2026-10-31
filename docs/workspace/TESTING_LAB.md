# Testing Lab

Open **Testing Lab** in the main utility navigation. Results persist in the local
application data folder, so you can return after hours, days or weeks.

## Start a comparison

1. Choose **Workstation essentials** and an installed local chat model. Its ten
   synthetic cases cover following instructions, coding plans/review, numerical
   reports, document facts, missing information and revised information.
2. Optionally enter an exact online model/version. Start comparison records a
   frozen suite, settings and build identity, then runs local requests through
   the shared Prompt Queue. Opening another workspace does not stop the run.
3. In the run details, choose an online response, expand **Exact prompt**, and copy
   the system instruction and messages to a fresh conversation with that model.
   Use tools off for a comparable text-only baseline. Record provider, version,
   date, tool/web access and reasoning mode under **Comparison conditions**.
   Paste and record the answer. Each baseline response can be recorded once;
   create another run to test a replacement.
4. Read the reference and rubric, then review request accuracy, factual accuracy,
   and optional freshness from 0 (incorrect) to 4 (fully correct). Add notes that
   explain the evidence. Save the review.

Online baselines use pasted text. The lab makes no paid/provider API calls,
stores no provider credentials, and cannot verify a pasted answer's model
identity or measure its latency. Online settings may differ from local settings.

These are **text-only model evaluations** using the case messages and a fixed
system instruction. Normal chat memory, Knowledge retrieval, browser access,
tools, generated images and executed code are outside this harness. Coding cases
evaluate an answer or plan; use [Coding Coordinator](CODING_COORDINATOR.md) to
verify actual project edits and checks. Starter update cases measure whether a
model follows revised evidence in its input, rather than fetching current facts.

## Make the tests fit your use cases

Expand **Customize suite & save a revision**. Add a test using your own request,
category, expected answer/check and review rubric. Edit the JSON draft to rename
the suite, remove cases or add multi-turn messages. The final message must be a
user request. Save a revision before running it; old runs keep their original
suite snapshots. Export suite saves the currently selected saved revision.

Supported automatic assertions are `exact` (trimmed, case-sensitive text),
`contains`, `not_contains` (case-insensitive text) and `json_equals` (whole JSON,
without Markdown fences or extra text; object key order is immaterial). JSON
booleans and numbers are distinct. Cases without checks stay unscored until
human review; checks are never presented as independently verified truth.

For current-world information, use a `live_freshness` case with these fields:

```json
{
  "id": "current-policy",
  "name": "Use the verified current policy",
  "category": "live_freshness",
  "messages": [{"role": "user", "content": "Using this dated policy excerpt, return only JSON with retention_days: [paste verified excerpt here]."}],
  "checks": [{"kind": "json_equals", "value": "{\"retention_days\":14}"}],
  "rubric": "Use the current supplied policy; do not repeat the superseded value.",
  "reference": "Replace with the independently verified answer and evidence.",
  "source": "Replace with the authoritative source URL/document revision.",
  "checked_at": "2030-01-01T12:00:00Z",
  "valid_until": "2030-01-02T12:00:00Z"
}
```

The dates and values above are a schema example, **not verified policy facts**.
Set real checked/expiry dates and verify the source yourself. Future check dates
and expired references block new runs. Expiry disables affected schedules with
a visible reason. A response recorded after reference expiry retains its checks
as evidence but receives no aggregate automatic score. Saving updated evidence
creates a new suite revision and a separate comparison group. This lab does not
browse, fetch sources or silently update its own expected answers.

## Repeat over time

Schedules run **local models only**, every 1–720 hours, for 1–365 runs. They
capture the selected suite revision and settings. The first run starts at the
next scheduler check (within about 30 seconds when idle). Keep the backend
running and the computer awake; the Testing Lab tab may be closed.

Only one evaluation run executes at a time. Each local response enters the
normal inference queue, so ordinary work can proceed between test responses.
Missed intervals create one run on return, without a catch-up backlog. The next
interval starts from that run. Failed attempts count toward the finite run limit.
**Disable schedule** stops future runs. **Stop run** cancels the current run and
preserves completed answers. It does not disable the schedule.

After a backend interruption, completed answers remain saved and unfinished
local requests become interrupted. They are not silently replayed. A pending
online answer can still be recorded against that run. A future scheduled run
can proceed normally. Maintenance prevents new scheduled runs and requires
active evaluations to finish or stop before reset/backup.

## Interpret and keep results

- Charts compare the same suite content and local settings group. Choose
  automated checks, human request/factual/freshness review, local response time,
  or local tokens/s. Select a point to open its evidence.
- Scores average available completed/scored responses; missing responses and
  failed requests are not scored as successful answers. Coverage, failures,
  assertion coverage and review counts are displayed separately. Partial runs
  and selective reviews can bias the averages; complete and review the same
  cases for both models before comparing.
- Local response time starts at the chat request. Queue wait and model
  preparation are recorded separately. First visible token latency, input/output
  token counts, stop reason, model digest/quantization and Ollama version are
  retained. Tokens/s uses Ollama's generation count/duration, which may include
  thinking tokens. These are measured after model preparation, rather than a
  cold-start benchmark. Provider load/prompt timings and reported cached input
  counts are also retained; see the [Ollama chat response fields](https://docs.ollama.com/api/chat).
- Runs retain host/RAM/GPU observations, build identity and settings. Model alias
  changes, hardware contention, reasoning, output limits and online tools can
  alter comparability even within one chart group. Repeated identical seeds
  improve control but do not guarantee identical output.
- Charts and the run list show up to the latest 500 runs. Older runs remain in
  the database and accessible by their run ID. Use **Export JSON** for full
  prompts, references, raw answers, runtime evidence and reviews. **Export CSV**
  provides response-level scores and text with spreadsheet-formula escaping.

History uses `evaluations/history.sqlite3` beneath the configured app data folder
(`LAW_DATA_DIR`, or the application's normal local data location). Suites and
schedules share this private store. Keep normal app-data backups; clearing/resetting
that data can remove testing history. Prompts, answers and exports can contain
private information. They are not source files and are never published by Git.

This is a diagnostic environment for your tasks, not a standardized model
ranking, a factuality oracle, or evidence of weeks-long reliability until those
runs have actually happened. See [development verification](../development/VERIFICATION.md)
for the checks performed on the harness itself.
