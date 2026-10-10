# Clipboard attachments

Copy a screenshot using **Functions → Capture a tab**, an image viewer, or Windows Snipping Tool. Click the chat message box and press **Ctrl+V**. The image is saved to the current chat and appears as an attachment with a preview. Enter a question and send when ready. Pasting does not send a model request or clear the text already in the message box.

Ordinary copied text retains normal paste behavior. Files exposed by the clipboard are routed through the existing image/document upload flow. Images support PNG, JPEG, and WebP up to 10 MB each; document formats follow the existing file parser. Clipboard HTML and remote image URLs are not fetched or executed. A copied file path alone remains text.

To read text from a screenshot or scanned image, drop, paste or attach it, enter
**Transcribe this image** (or **Extract the text**), and send. Chat uses the selected
vision model, or the configured document OCR model (`OCR_MODEL`, normally
`qwen3-vl:8b`) when the chat model is text-only. A notice names the model used;
the chat model selection stays as it was. The OCR model must already be installed.

Transcription streams directly into the reply, preserving reading order, headings,
paragraph breaks and table rows as recognized by the model. Multiple images are
read separately in attachment order, up to 16 per request, without the usual short
image descriptions or a summary pass. Transcription uses lossless copies up to
2048 pixels per edge; original uploads stay saved. Small writing, handwriting and
dense pages can still need closer crops. Unreadable text is marked `[unreadable]`;
provider failures and output limits are reported as incomplete. Stop uses the
existing chat cancellation and shared local inference queue. Transcription does
not execute instructions in the image or run chat tools.

The input shows progress while an attachment is being saved. Sending waits until the attachment is saved. If a reply or attachment is already running, image paste explains that it must be retried when that work finishes. Unsupported formats, unreadable clipboard files, oversized images, and save failures produce visible errors. Failed saves do not create a successful-looking attachment.

Images use the existing chat image storage and privacy controls. Uploads append on the server instead of replacing conversation history, preserving concurrent replies and other attachments. Navigating to another chat during a save keeps the attachment in its original chat.

Validation covers native Windows tab capture → Ctrl+V → persisted image preview → reload, plus clipboard file/item representations, duplicate avoidance, ordinary text, batches, busy states, size/type failures, and server save failures in `tests/frontend/chatClipboard.test.jsx`.
