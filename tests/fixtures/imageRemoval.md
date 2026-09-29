# Image selection removal checks

Run `npx vite --config tests/fixtures/imageRemoval.config.mjs`, then open
`http://127.0.0.1:5181/tests/fixtures/imageRemoval.html?apiPort=5181`.
API calls are intercepted in the fixture; it does not generate images or modify real chats.

Verified with the browser on 2026-09-27:

- Select batch images 1 and 3 and Remove selected: only those previews disappear,
  all four ordinal positions remain, and selected count resets to zero.
- Remove image 2 individually; open remaining image 4 and remove from the viewer:
  the empty viewer closes.
- Choose three test PNGs in the chat composer: all stay pending and saved-message count stays zero.
  Remove two together; only the third remains.
- Fail next attachment save, then Send: attachment stays pending and count stays zero.
  Retry Send: exactly one attachment is saved and the pending list clears.
- Send a pending image and a prompt from a new chat: the fixture saves the image,
  prompt, and synthetic reply, and clears the composer.
- Choose three converter inputs, Select all, Remove selected: list clears and Convert disables.

Related regression tests cover preservation of batch ordinals, workflow reference
assignments, and byte-for-byte preservation of stored workflow images after removing
and restoring them from selection. Other image surfaces share the removal controls;
these browser checks do not claim an end-to-end test of every tool or live model.
