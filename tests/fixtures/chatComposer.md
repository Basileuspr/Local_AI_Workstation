# Chat composer layout preview

Run `node node_modules/vite/bin/vite.js --config tests/fixtures/chatComposer.config.mjs`, then open `http://127.0.0.1:5181/tests/fixtures/chatComposer.html`.

The preview renders the real composer with mocked API responses. It does not verify live inference, file persistence, or microphone capture.

Browser checks completed on 2026-09-28:

- The empty composer is 105px tall at 1280px and 390px viewport widths; no horizontal page overflow at 390px.
- Images and Audio open above the toolbar without expanding the composer; switching between them hides the previous panel.
- Escape dismisses the open tool and returns focus to its trigger, including from the message box.
- Word prepends `/docx ` while retaining the draft; /Edit inserts its command and focuses the message box.
- A reviewed transcript survives tool switches; Insert into message inserts it, closes Audio, and focuses the draft.
- The attachment menu still exposes Upload image and Upload document.
- No browser console errors during these checks.

Validation: production build passed (existing bundle-size warning); 48 tests passed across chatClipboard, chatImageGeneration, chatEdit, and audio.
