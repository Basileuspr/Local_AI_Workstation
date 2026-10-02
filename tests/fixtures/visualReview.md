# Visual Review integration check

Verified on 2026-10-02 against disposable data under
`%TEMP%/law-visual-review-preview`, using `visualReview_backend.py` and the Vite
fixture at `visualReview.html`. The backend fixture refuses ordinary data paths.

- Two generated PNG graphics were cataloged using the real Image Manager scanner.
- Two one-second H.264 MP4 fixtures were scanned using the bundled Media Manager.
- The browser exercised real authenticated routes, the queue, SQLite storage,
  the restricted Media bridge, and FFmpeg preview decoding. Face/scene inference
  was deliberately simulated and clearly labeled in the fixture.
- Catalog classification grouped two detected faces in each image. Renaming a
  group to `Alex (test)` carried through to both Media Manager preview results.
- Slideshow ratings, captions and tags persisted. Image Manager Like became
  Favorite, and Media Manager's Trip tag remained available in its native filter.
- Separating one mistaken match created a new person group and kept the original
  caption, tags and other person's association. A resumed catalog batch reused
  completed stages and preserved that correction.
- Screenshots were inspected for both panels. They use existing app styling and
  remain collapsed until opened. Tests did not open Explorer or alter user files.

An additional check used the installed SCRFD/ArcFace CPU provider on a generated
graphic; native inference completed and detected zero real faces. This confirms
the runtime loads, not person-grouping accuracy. No personal-photo, GPU, or real
vision-model accuracy benchmark was performed.

Automated validation: 171 focused backend tests, 62 focused frontend tests,
115 Media Manager Python tests, and 13 Media Manager JavaScript tests passed.

## Face naming and correction follow-up

Verified the revised Image Manager / Image Review panel with fresh disposable
data under `%TEMP%/law-visual-review-preview-normal`. The same synthetic provider
and real source scanner, authenticated routes, and SQLite catalog were used.

- Clicking a person opens their photos; renaming is a separate explicit action.
- Named separation changes one face, updates photo counts, and retains unsaved
  caption text. Undo restores its original group without losing that draft.
- A false detection can be removed and immediately restored, including when it
  was the last grouped face in the photo.
- Merge preview shows source and destination faces and the retained name; after
  merging, the destination is selected and both photos remain available.
- Naming from the photo inspector updates the whole group. Moving to another
  existing person and undoing it updates only the chosen face.
- Saved notes and group names survive closing/reopening. Cached classification
  preserves corrected faces and names.
- Screenshots were inspected for the person browser, merge preview, and centered
  opaque photo dialog with face controls beside the image.

The fixture simulates inference; these checks do not measure recognition accuracy.

## Review tag selection follow-up

Verified the real review dialog with `scripts/qa-review-tags.cjs` using a disposable
synthetic catalog and authenticated backend routes. Existing tag names from an
unclassified photo appear in the selector. Applying an existing tag preserves
other tags, caption and favorite. A newly created tag is reusable on the next
photo, survives close/reopen and matches both images in the native tag filter.
The screenshot was inspected; no user images or catalog were used.

Build the fixture with Vite using `tests/fixtures/visualReview.html` as the input
and `tmp/review-tags-qa` as output, then run the QA script with Electron.
