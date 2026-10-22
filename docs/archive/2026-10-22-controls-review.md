# Desktop and phone controls review — 2026-10-22

Scope: all 45 registered desktop workspaces, the separate Media Manager surface,
and the phone companion. This is a source and isolated-browser review, with
synthetic services and data. It does not certify every native action, screen
reader, real provider, GPU workload, or physical phone interaction.

## Findings and changes

| Area | Finding | Result |
|---|---|---|
| Code replies | Desktop fences had no individual copy control; phone displayed raw fences. | Shared dark code boards, sticky 44 px copy button, keyboard scrolling, exact whitespace copying, and announced clipboard errors. Desktop streaming uses React updates scoped to the original message and chat. |
| Output size | Max Tokens rounded to a preset, phone sent no explicit limit, and reasoning silently increased finite budgets. | Exact 1–32,768 token control, shared desktop state, explicit phone payload and retry identity, no hidden reasoning increase. Automatic accurately describes the existing 2,048-token default. Context reductions and saved phone usage are visible. |
| Desktop chat settings | Advanced parameters was a pointer-only div; sliders and several fields lacked names. | Native keyboard button with expanded state, named fields, pressed states for roleplay/profiles. Modified profile parameters clear the selected profile indicator. |
| Split chat | Model radio groups shared a name, and contrast inputs shared an ID. | Instance-specific radio groups and pane-specific label targets. |
| LoRA dataset | Caption fields depended on placeholder text. | Each caption has an accessible name identifying its image. Save-on-blur behavior remains documented in LoRA information. |
| Shared controls | Textareas, links and disclosures were missing from the shared focus rule; compact touch controls were 36 px. | Shared focus rules cover them; covered touch controls have a 44 px minimum. Specialist canvas handles retain their geometry. |
| Phone chat | Cancellation required opening Jobs; connection expansion was not announced. | Stop reply in the composer, an expanded-state connection button, and a keyboard-focusable transcript. |
| QA | The control-action fixture assumed implicit folder browsing; the phone fixture could select a live published shell instead of the new build. | Explicit fixture folder selection and temporary phone build assets. Tests cannot silently exercise an old published interface. |

## Review coverage

The initial source inventory covered 212 React files and 2,232 native control
elements. Candidate issues were manually checked: Field wrappers already label
workflow/scene inputs, hidden file inputs have visible Browse controls, and chat,
queue, and LoRA card pointer handlers have equivalent buttons or checkboxes.
Image Editor pixel sampling/painting and other spatial canvas gestures still
require a pointer; they are not claimed as fully keyboard-accessible.

The rendered inventory found 1,105 named controls across the 45 desktop routes
with details expanded, plus 41 named controls in the separate Media Manager.
These are fixture-state counts; empty inventories and unavailable devices do not
expose every conditional control. Deeper chat settings were checked separately.

| Desktop workspace | Controls in expanded fixture |
|---|---:|
| Dashboard | 37 |
| Prompt Queue | 2 |
| Functions | 22 |
| Info Center | 90 |
| Chats | 30 |
| Index | 4 |
| Knowledge | 17 |
| Web Research & Sources | 15 |
| Canvas | 75 |
| File Converter | 3 |
| Local Files | 2 |
| Document Editor | 49 |
| Packager | 7 |
| Hash Auditor | 12 |
| Folder Review | 11 |
| Audio | 43 |
| Reels Analyzer | 17 |
| Sound Mixer | 52 |
| 3D Slicer | 11 |
| Linked applications | 13 |
| Gallery | 4 |
| Image Manager | 51 |
| Generate | 81 |
| Review | 11 |
| Editor | 97 |
| GIF Maker | 16 |
| Workflows | 5 |
| Media Manager | 0 |
| Character Creator | 3 |
| Faces | 3 |
| Character Parts | 3 |
| LoRA | 30 |
| University | 35 |
| Agent University | 34 |
| Neural Network | 12 |
| Break Room | 99 |
| Browser | 9 |
| 3D Viewer & Editor | 39 |
| Markdown Viewer | 3 |
| HTML Viewer | 4 |
| CSS / Styling | 6 |
| Styling Library | 30 |
| JavaScript Viewer | 3 |
| Spreadsheets | 3 |
| Shortcut Registry | 12 |

## Behavioral influence

- Chat model, system/roleplay instructions, sampling, Knowledge, memory and tool
  controls were traced through store state, request assembly, backend context
  fitting and saved influence receipts. Sampling and prose instructions influence
  model output; they do not guarantee wording or factual correctness. Token caps
  limit each provider call, including thinking, not an exact word count or a
  multi-call workflow total.
- Shared image controls already use the same serializer on desktop and phone.
  The phone walkthrough verifies the forwarded size, steps, guidance, LoRA,
  prompts and seed, job queues, retained drafts and saved results with synthetic
  inference. Real model quality and speed are separate checks.
- Existing isolated action checks cover menus, draft preservation, explicit
  function-template application, capture dispatch, image metadata, preview
  sandboxing, thumbnail sizing, and reset/import cancellation. They do not execute
  destructive operations against live stores or launch the user's native tools.
- Phone pairing, reconnect, gallery filtering, original-byte download, job retry,
  cancellation and refresh remain covered by existing frontend/backend/browser
  checks. Size preferences persist locally; private messages and credentials do
  not enter browser storage or the service-worker cache.

## Reproduce the focused checks

Run from the resolved checkout directory (not its Windows junction) so Vite
transforms fixture JSX correctly:

- `npm test`
- `venv\Scripts\python.exe -m pytest tests/backend/test_mobile_companion.py tests/backend/test_chat_context_budget.py tests/backend/test_thinking_trace.py tests/backend/test_chat_influences.py`
- Start `node node_modules/vite/bin/vite.js --config tests/fixtures/workspaceControls.config.mjs`,
  then run `node_modules\.bin\electron.cmd scripts/qa-response-controls.cjs` and
  `node_modules\.bin\electron.cmd scripts/qa-control-actions.cjs`.
- Build the phone bundle, then run
  `node_modules\.bin\electron.cmd scripts/qa-mobile-companion.cjs`.

The control-action walkthrough passed 26 behavior checks and 33 menu layouts.
The new response-control walkthrough passed 11 checks at desktop and phone widths,
including keyboard activation, invalid input, exact values, sticky copying after
vertical/horizontal scrolling and page overflow. Clipboard writes in that fixture
are intercepted. The HTTPS phone walkthrough verified the 1,537-token request,
reload persistence, code board and saved applied cap alongside its existing checks.

Final validation: 1,517 frontend tests passed (3 existing skips), 2,164 backend
tests passed (2 existing skips), and 21 Media Manager tests passed. Desktop and
phone production builds passed. The production chat walkthrough passed its nine
checks, including queued settings and receipts after reload, using an isolated
build and synthetic providers. Its local harness was adapted to select the saved
chat, open the current Chat options disclosure, and exclude capability probes
from captured chat requests.

Deployment requires a desktop restart for the backend changes, followed by the
existing Dashboard phone-update workflow. Keep previous immutable phone releases
available for clients that have not accepted the update. No new native APK is
required for these web-interface changes.
