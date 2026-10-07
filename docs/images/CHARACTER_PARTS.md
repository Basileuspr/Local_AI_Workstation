# Character Parts

Character Parts is a training-image curation workspace beside Faces. Create a
named dataset, import files or a folder, or choose images from the general and
saved library. One original is retained per content hash across character datasets.
Source images are never edited. Reimporting the same image keeps it once.

Select regions on the front-view silhouette or in the detailed region list:
body without head; torso, chest, abdomen, back, pelvis/hips, buttocks/glutes; shoulders, arms,
upper arms, elbows, forearms, wrists; hands, palms, backs of hands and fingers;
legs, thighs, knees, shins, calves, ankles, feet and toes; eyes and mouth.
Specific fingers, toes, and other details can be named in each selection.
Left and right always mean the character's own anatomical sides.

Viewing angles include front, back, left/right side, left/right three-quarter,
above, below, and uncertain/unspecified. They are editable labels, not claims of
automatic identity matching. The silhouette selects a filter; it does not segment
an image or create a pixel mask.

## Focus on one area

The starting focus is buttocks/glutes. Switch between front and back silhouettes;
the back view has a selectable glute region. Anatomical left/right labels follow
the view. Selecting a region also selects it for the next analysis.

Import an image, choose **Select area & focus**, and draw around the area you like.
For the glute region, include enough hips, lower back and upper thighs to assess
how it joins the character. **Include more surroundings** expands the crop while
keeping it inside the image. Choose **Use as focus** to save the crop as a temporary
visual reference; this does not automatically accept it for training.

**Select any area** supports a named custom selection anywhere in an image, such
as a hip-to-thigh transition, garment detail or part of the silhouette. This is not
limited to the predefined anatomy list. A custom selection needs a name before saving.

The focus panel displays the reference crop and its full image. Edit **What to look
for**, choose the local vision model, then **Find this region in other images**.
It scans up to 500 other sources, including previously analyzed images. The model
receives the reference crop and each target image separately and suggests matching
areas in target-image coordinates, with comparison notes for review. It does not
use face identity embeddings or produce a calibrated similarity score.

Open a suggested crop to compare it beside the reference and full source context.
Adjust, accept or reject it as in the existing curation flow. Any saved crop can
become the next focus. **Clear focus** returns to general browsing. Focus is temporary
UI state; saved selections and the exact reference used for each analysis remain
in the dataset and export manifest. Switching focus does not overwrite earlier work.

## Suggestions and review

Choose an installed local Ollama vision model and the regions to suggest. Analyze
the current image or up to 500 remaining images. An optional subject hint identifies
which character to focus on in a scene with multiple people. Work uses the shared
Prompt Queue and GPU coordination. Stop closes the active vision request and retains
completed suggestions. No model is downloaded and no training starts automatically.

Vision returns approximate crop rectangles, region/side/view labels, captions and
quality notes. Small fingers and toes, occlusion and anatomy can be misidentified.
Suggestions start unreviewed. Open a selection, drag its rectangle or enter edge
percentages, inspect the crop preview, correct labels and captions, and accept it,
reject it or save it for later. A manually drawn selection works without a vision model.
These are rectangular crops, not automatic pixel-perfect silhouette segmentation.

The full-image caption is separate from each crop caption. Reviewed captions and
existing selections survive reanalysis. Rejected selections remain in the dataset
and can be accepted later. Revision checks protect concurrent edits.

## Training export

Each selection can include the full image, its crop, or both. Export accepted creates
a ZIP with `full_images/`, `crops/`, matching caption `.txt` files, and `manifest.json`.
Full images appear once per source even when several accepted regions request them.
Crops retain their source resolution and are never upscaled or stretched. Output PNGs
use the displayed EXIF orientation; the stored originals retain their original bytes.
The manifest records original source references, selected boxes, region/angle labels,
review notes and model provenance. Pending and rejected selections are excluded.

Review the captions and add the intended training trigger word before export. The
archive prepares a dataset; it does not train a LoRA. The coverage table counts unique
accepted source images per region and angle, so repeated crops of one source do not
inflate coverage. It does not impose a target distribution or a training recipe.

Records live under `LAW_DATA_DIR/character_datasets`. Locked Images restrictions apply
to source reads, derived crops and exports, including images locked after import.
