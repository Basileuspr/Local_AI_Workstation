# Analyze & Iterate

Generate and the image library use the same button label for two related actions.

## Generate: revise prompts in place

Enter a positive prompt, then select **Analyze & Iterate**. Choose a local chat model, describe the desired change, and optionally specify exact character names or trigger words to retain. The analysis model, iteration goal and preservation notes carry over between reviews until the app closes.

The dialog proposes positive and negative prompts and explains the revision. Edit the suggestions if needed, then choose **Apply prompts to Generate**. The model, LoRA, seed, dimensions and other generation settings remain unchanged. Press Generate when ready, then repeat for another individual image or training variation. This path does not create an iterative scene or require a generated image.

Prompt analysis uses the existing request queue. Stop or close cancels the analysis. It does not read or write durable chat memory, load knowledge documents, or append messages to a chat. Invalid, incomplete or cancelled responses cannot replace the prompts, and changed Generate drafts must be reviewed again before applying an older proposal.

## Image library: review a scene from an image

Open an image in General, Hidden, Saved, Liked, Disliked, a folder, or Workflow Images. The viewer's **Analyze & Iterate** button opens a vision-analysis dialog. Select an installed local vision model and choose **Analyze image**.

Review its observations, uncertainties and possible next steps. **Open scene draft** opens Iterative scenes with an owned copy of the original source and editable observed details. Suggested future actions remain in the notes and are not applied automatically. Existing scene edits are saved before switching. Generation remains an explicit action in the scene editor.

Scene sources currently support PNG, JPEG and WebP. Locked images are not copied into public scenes. The scene editor supports a canvas from 256 to 1024 pixels per side, in multiples of eight; inspect the transferred size before generating. Original image bytes stay intact. Image model selection is explicit.

Analysis runs retain their snapshots and model metadata in Image Workflows, including unsuccessful attempts. Closing a running image analysis requests cancellation and waits for the queue's terminal state. Existing workflow Stop and runtime-reset behavior also apply.
