Run `node node_modules/vite/bin/vite.js --config tests/fixtures/generatePreview.config.mjs`
and open `http://127.0.0.1:5179/tests/fixtures/generatePreview.html?apiPort=5179`.

This fixture uses the real Generate provider, history reducer, preview, and
viewer. JSON responses are synthetic; saved image requests serve the local SVG.
It does not run inference or write to the user's backend data.

- Start a fixture batch, then complete one image. Check the thumbnail loads and
  opens while three requests remain pending.
- Schedule the next completion, then open the first image before the delay
  expires. The viewer should retain image 1 and allow browsing to image 2.
- Complete an image with a preview failure. Retry should recover its thumbnail.
- Open previews with Enter/Space and close the viewer. Repeat for a single image.
- Fill Generate's positive and negative prompts and use Save prompts to Index.
  Change one prompt, switch to Prompt Index, and use Import from Generate.
  Both entries must remain separate and the existing editor draft must survive.
  Fail next prompt save simulates a recoverable save error; retry must retain
  the dialog's name and prompt pair.

Keep privacy behavior in the shared ProtectedImage component; this fixture
uses its default context and does not exercise the vault or actual GPU inference.
