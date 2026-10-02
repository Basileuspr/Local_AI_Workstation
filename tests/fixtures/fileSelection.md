# File selection verification

Verified on 2026-10-02 using `fileSelection.html` with the real React Image
Manager and saved-image components, synthetic catalog responses, and the bundled
Media Manager's disposable `tests.ui_fixture_server --catalog` fixture.
Use `?apiPort=5191&apiToken=selection-fixture` with the Vite fixture configuration.

Browser checks confirmed:

- Ctrl-click adds and removes individual selections on thumbnails and checkboxes.
- Shift-click selects an inclusive range in display order; Ctrl+Shift adds it.
- Image Manager's Even-tag filter selected 02, 04, 06 and 08, excluding hidden
  odd-numbered images. Changing pages invalidated the previous range anchor.
- Media Manager's timeline and list layouts selected the expected chronological
  range without opening a player. Changing sort order invalidated the anchor.
- Ctrl-click in saved images enabled selection mode directly; thumbnail and
  checkbox ranges shared the same anchor and selected count.
- Image Manager Trash selected four rows by range. Space on its focused checkbox
  deselected one row and updated Restore selected from four to three. No restore,
  delete, move, export, publication, or personal-file operation was executed.

The pure selection contract is tested for both standalone implementations,
including reversed order, repeated range contraction, absent anchors, filtered
items, additive ranges, Command-click, selection caps and input preservation.
The full frontend suite passed (950 tests at validation time), as did the Media
Manager suite (116 Python tests and 13 JavaScript tests). Static-module traversal
also verifies that the new standalone selection module is actually served.
