# Characters, faces and character parts

These workspaces curate references. Assigning a name or linking an image does
not train a model, identify a person, or change the original file.

## Character profiles

Create a profile with a name, biography, notes and tags. Link images, faces,
character parts, LoRAs, Knowledge items, files or other profiles using their
existing references. References can belong to several characters. Untying a
reference does not delete its source.

Uploaded files are saved copies, with duplicate handling and vault checks.
Deleting a profile or unlinking its upload does not remove the saved upload bytes.
Review the storage owner before deleting media separately. Image preview depends
on supported image formats/codecs.

Audio can save a voice reference to a character. Applying it to voice generation
explicitly replaces that tool’s current reference; it does not play or generate
audio automatically. Verify any reference transcript before use.

## Phone character intake

The [phone companion](../../mobile-companion/docs/SETUP.md#character-intake) also
supports profile creation/editing and visible Saved Image references through
**More tools → Character profiles**. Saves share this character store, preserve
other desktop references and reject stale edits while retaining the phone draft.
Phone intake does not start training or generation.

## Roleplay and Knowledge

Loading a saved character into roleplay copies its current profile into the
roleplay settings. Later edits there do not alter the saved character. Loading a
replacement disables general prompt/style and saved-user-memory overlays to avoid
unintended mixing. Existing Knowledge selection remains visible; check it,
especially an all-sources scope. Images and LoRAs are not automatically attached.

Roleplay settings can remain active across chats. Use a new chat to clear the
conversation history, and review or disable the roleplay settings separately.

**Save to Knowledge** creates an explicit Markdown snapshot of the profile,
tags and reference inventory using the existing local embedding workflow.
It does not embed linked image pixels or publish absolute paths. Refresh updates
the stable snapshot identity. Removing its Knowledge node does not delete the
character, and deleting the profile does not delete the existing Knowledge copy.

## Face folders

Choose a source folder and extract faces from its direct image files. Processing
uses bounded batches and preserves completed results if stopped. A run starts
with a timestamp-based name; rename it to a useful label. Saved names persist
for recorded runs, but older data without a run record cannot be reconstructed.

Export writes face PNG copies into a fresh output folder. It does not require
character-part acceptance and does not modify source images. Face detection and
crops are approximate; they are not identity verification or improved resolution.

## Character parts

Character Parts keeps original image identity and content hashes while you curate
candidate body/face regions. Front/back and anatomical left/right filters organize
the selection. A silhouette filter changes the display/filtering; it is not a
segmentation mask. Custom named crops and temporary focus views are separate.

Use an installed local vision model to propose regions, then review the rectangles
and accept or reject each candidate. The suggested labels and confidence-like
outputs are not proof of a person’s identity or anatomical accuracy. Existing
vault access rules still apply.

Training export includes only accepted crops, PNG files, captions and a manifest.
Review the export before using it as a dataset. It neither modifies originals nor
automatically starts [LoRA training](GENERATION.md#lora-dataset-and-training).

[Gallery and collections](GALLERY_AND_BULK_ACTIONS.md) ·
[Audio](../media/AUDIO.md) · [Knowledge](../workspace/KNOWLEDGE_VAULT.md)
