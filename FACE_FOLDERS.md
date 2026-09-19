# Face extraction folders

In **Face Extractor**, **Save all N faces to folder…** copies the current dataset's extracted crops into a new folder inside the destination you choose. Selecting faces changes the action to **Save N selected faces to folder…**. The output is a flat folder of PNG images that can be imported into a LoRA project's dataset. Faces do not have to be accepted or saved as a character first.

Exports are explicit copies. They preserve the source images, extracted crops, character records, and previous exports. Each export creates a fresh folder; an interrupted write does not leave a partly written PNG masquerading as a completed crop. Partial exports report the number saved and retain completed files.

The desktop **Choose a folder** and face file picker accept selections above 100 images. Only images directly inside the chosen folder are scanned. The desktop retains a temporary selection grant and reads at most 100 files or about 16 MiB per batch (one larger valid image may occupy a batch by itself). It waits for extraction to finish before reading the next batch. The existing 20 MiB image limit still applies; unreadable or oversized files are reported and skipped.

Progress counts the whole selection and continues across app tabs. **Stop scanning** stops the current worker, prevents later batches, and keeps faces already extracted. Selection grants are released on completion, cancellation, or window navigation.

Uploaded originals needed for re-cropping are stored once inside the app's face dataset. Existing datasets with inline originals remain readable. This does not create or change a LoRA project automatically.

Validation: frontend batching and filesystem tests, backend face extraction/cancellation tests, and `scripts/qa-character-save.cjs` exercise these flows using temporary files and synthetic data.
