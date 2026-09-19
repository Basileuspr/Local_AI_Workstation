# Generate images from chat

Select an **Image model** above the normal message box, then an optional compatible **Image LoRA** and strength. Type an image description in the message box and click **Generate image**. Send and Enter continue to submit text chat.

**Image settings** opens Generate for negative prompts, dimensions, steps, guidance, seed, and other settings. These settings and image-model/LoRA selections are shared between both surfaces. Chat uses the message-box description without replacing the prompt draft in Generate. Changing the image model clears its LoRA selection. RESET DEFAULT clears both surfaces' shared image settings.

Both surfaces use the existing image generation API and Prompt Queue. There is one outstanding image request across Chat and Generate, with shared progress and Stop controls. Text requests can still join the queue while an image is waiting or running. Results are appended to the original chat, even when another chat is opened. These are image-model LoRAs; they do not modify the language model's text replies.

Implementation: `ImageGenerationContext.jsx` owns shared image state and cancellation; `chatImageGeneration.js` builds requests and persists source-chat messages; `ChatImageControls.jsx` adds the chat controls. Existing backend model compatibility and GPU queue checks remain authoritative.

Validation includes request mapping, adapter compatibility, cancellation during preparation and inference, source-chat persistence, provider failures, frontend tests/build, and an isolated browser workflow with simulated image responses. No live model inference was needed for this UI change.
