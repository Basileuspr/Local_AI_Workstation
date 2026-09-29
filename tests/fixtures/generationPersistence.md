# Generate navigation and refresh regression

Run the isolated synthetic backend:

`venv\Scripts\python.exe tests/fixtures/generationPersistence.py`

Run the fixture UI:

`node node_modules/vite/bin/vite.js --config tests/fixtures/generatePreview.config.mjs`

Open `http://127.0.0.1:5179/tests/fixtures/generationPersistence.html?apiPort=5181`.
Select Images > Generate, choose the synthetic model, enter a prompt, expand the
batch controls, and queue four images. The worker pauses in model loading until
Complete fixture image is pressed. This uses the actual task registry, GPU queue
admission, session store, image routes, and frontend providers. It loads no GPU
model and writes only to a newly created temporary directory.

Check that:

- GIF Maker opens as its own sidebar workspace.
- Tab switches and Refresh preserve the backend request IDs and zero cancellations.
- Refresh restores the original four slots and current progress.
- Completing an image while Generate is hidden preserves its result on return.
- Refresh preserves completed previews alongside pending requests.
- Stop all image requests cancels pending work while retaining completed previews.
- Advance fixture step reports 1/4 steps, 20 seconds elapsed, and a 30-second
  step estimate. Matching queued images receive a live batch estimate even with
  no completed timing samples (also covered by the queue timing unit test).
- Complete each of four images once: the counter advances through all four
  original slots, finishes at 4/4 ready, and backend Started remains 4 without
  another submission. Refresh must not start a fifth image.

Tasks survive renderer reloads while the backend stays running. Backend shutdown
ends active tasks; already completed images remain in their saved chats.
