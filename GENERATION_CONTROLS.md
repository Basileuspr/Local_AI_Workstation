# Generation controls

Generate offers fixed square (1024 × 1024), landscape (1152 × 864, 1152 × 768,
1280 × 720), and portrait (864 × 1152, 768 × 1152, 720 × 1280) presets. These use
exact 1:1, 4:3, 3:2, and 16:9 ratios and their inverses, within the local API's
512–1536, multiple-of-eight limits. Each is at most 1024 × 1024 pixels in area.
Actual model memory requirements still depend on the model and other settings.
Previously saved custom dimensions remain visible until a preset is chosen.

Steps: 1–60, presets 10/20/30/40/50/60, adjustments ±1/5/10/15.
Guidance: 1–20, presets 3/5.5/7/10/15/20, adjustments ±0.1/0.5/1/2.
Seed: blank for Random or 0–2147483647, adjustments ±1/10/100/1000.
Adjustments clamp at the limits. Starting from Random uses zero as the numeric
baseline; the Random button restores a new seed per image. Seed magnitude is
not an intensity setting. Manual values are validated before submission.

Edits affect the next submission. Running and waiting image requests retain
their captured prompts, models, dimensions, numeric settings and original chat.
Each request has its own Stop control. Stop all image requests cancels all image
requests submitted from this window. RESET DEFAULT only resets the editable draft.
