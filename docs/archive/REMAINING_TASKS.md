# Remaining tasks implementation

> Historical record retained during the October 5, 2026 documentation cleanup.
> Dates, test results, constraints and open issues describe the original work;
> verify current behavior against source and focused tests. Start at the
> [documentation index](../README.md) for maintained guides.

## Chat

- **Message pins:** Pin or Unpin a saved message. Pinned opens a list that jumps to the original message. Pins are stored with the conversation and survive reload, export, and backup. Narrow pin updates preserve message content, attachments, summaries, and concurrent appended turns.
- **Top / Bottom:** The transcript toolbar jumps to either end of each chat pane. Reading earlier messages pauses automatic following of streamed text; Bottom resumes it.
- **Steer:** During an active text reply, choose Steer and enter a new direction. Stop & steer stops the current request, saves its partial reply, and queues the new instruction immediately after that save. Existing waiting prompts keep their order. The composer draft and pending attachments remain available. This uses a follow-up request because the local provider does not accept a new instruction inside an already-running inference request. If saving fails, steering does not submit and its text is retained.
- **Context:** The header displays the prompt estimate and effective window. Chat options shows output and safety reserves, summaries, available input budget, the model metadata limit, and recorded counts from the last processed request. The effective window remains the smaller of the configured application limit and the known model limit. Estimates are labeled; a model’s trained maximum is not presented as the current request budget.

## Application maintenance

- **Check for Updates:** Available in the application toolbar and Dashboard. It explicitly queries the configured HTTPS release manifest and reports unavailable checks separately from up-to-date results. An installation or download is not started by checking. This checkout has no release feed configured; a feed can later be provided through `LAW_UPDATE_MANIFEST_URL`.
- **Dependency controls:** Existing Dashboard → Application awareness and maintenance controls were retained and verified. Check Dependency Compatibility inspects the selected requirements profile and installed metadata. Update Dependency prepares an eligible recorded target for inspection; installation requires the owning desktop and its explicit Approve and install action. Large binary/runtime upgrades remain subject to their existing restrictions. No dependencies were changed during this implementation.

## Learning & Breaks

- **University:** Six offline lessons on clear requests, context, data, retrieval, neural networks, and controlled experiments. Each includes concepts, a practice exercise, working notes, and a knowledge check.
- **Agent University:** Six offline lessons on the agent loop, scope and permissions, tool contracts, untrusted source content, recovery, and evaluation. These are learning exercises for designing agent workflows; they do not execute agent actions or train a model.
- Course notes and passed checks are stored separately on this device. Export notes & progress downloads a JSON copy. Copy practice prompt lets the user start a lesson with a local model explicitly.
- **Neural Network:** A local 2-input, 3-hidden-neuron, 2-output educational network. Inputs, weights, biases, and tanh/ReLU/sigmoid activation can be changed interactively. Layer stepping displays weighted sums and activations; softmax output proportions are computed numerically. This does not inspect installed model internals or perform training.
- **Break Room:** A local Memory Match game with eight pairs, pause/resume, new game, move count, and a saved best score. Hidden workspaces pause pending pair resolution. No model/GPU runtime is used.

## Images

- **REVIEW** is available directly inside the Images Gallery collection navigation and through Images → Review.
- Existing ratings, captions, tags, face grouping, and optional scene classification are retained. Automated classification depends on available local models.
- **Add to folder** is visible on individual cards and in the review slideshow. It saves pending captions before opening the folder dialog. The user may choose or create a Gallery folder; source files are preserved.

## Deferred

**VPN toggle:** No configured user or all-user Windows VPN connection was found. A provider or configured connection is needed before adding a working connection toggle. No network settings, accounts, or credentials were changed.

## Validation

- New tests cover message-pin persistence, strict requests, concurrent append/rename preservation, and protection against older whole-chat saves removing pins.
- Frontend tests cover steering priority and chat/pane isolation, narrow pin updates, course storage, network calculations, card pair construction, and updated navigation behavior.
- Browser checks used the production UI and session/image routes with temporary data and a synthetic chat provider. Verified saved pins after reload, Top/Bottom, steering and preserved composer drafts, course notes/progress after reload, network controls, game pause, update-check feedback, and reviewed-image folder filing with preserved notes and ratings.
- Read-only dependency inspection reported no installed package metadata conflicts. These checks do not establish real GPU inference or binary compatibility.
- Reproduce the isolated browser fixture with `node scripts/build-remaining-tasks-qa.mjs`, then `venv\Scripts\python.exe -B scripts/qa_remaining_tasks.py tmp/remaining-tasks-qa --serve`. The helper prints its loopback URL; open `/tests/fixtures/remainingTasks.html?apiPort=<port>` on that origin. Stop the helper after validation.

Fully restart Electron after rebuilding to load the updated application and backend routes.
