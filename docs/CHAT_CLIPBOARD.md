# Clipboard attachments

Copy a screenshot using **Functions → Capture a tab**, an image viewer, or Windows Snipping Tool. Click the chat message box and press **Ctrl+V**. The image is saved to the current chat and appears as an attachment with a preview. Enter a question and send when ready. Pasting does not send a model request or clear the text already in the message box.

Ordinary copied text retains normal paste behavior. Files exposed by the clipboard are routed through the existing image/document upload flow. Images support PNG, JPEG, and WebP up to 10 MB each; document formats follow the existing file parser. Clipboard HTML and remote image URLs are not fetched or executed. A copied file path alone remains text.

The input shows progress while an attachment is being saved. Sending waits until the attachment is saved. If a reply or attachment is already running, image paste explains that it must be retried when that work finishes. Unsupported formats, unreadable clipboard files, oversized images, and save failures produce visible errors. Failed saves do not create a successful-looking attachment.

Images use the existing chat image storage and privacy controls. Uploads append on the server instead of replacing conversation history, preserving concurrent replies and other attachments. Navigating to another chat during a save keeps the attachment in its original chat.

Validation covers native Windows tab capture → Ctrl+V → persisted image preview → reload, plus clipboard file/item representations, duplicate avoidance, ordinary text, batches, busy states, size/type failures, and server save failures in `tests/frontend/chatClipboard.test.jsx`.
