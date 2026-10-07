# Word documents in chat

Ask **Make this a .docx** or **Create a Word document about ...**, or use **Create Word document** above the message box. The button inserts `/docx`; describe the document after it and send. Questions about how to write Python or create DOCX files remain ordinary chat.

The app creates a real Word file and adds a persistent attachment to the reply. **View** opens a local document window with zoom, expand/restore, scrolling, and download. **Download** saves the `.docx`. The preview contains the document's text, tables, and embedded images; exact pagination and typography can differ in Word. Word and LibreOffice are not required to create or preview it.

Supported content includes a title, paragraphs, section headings, bulleted and numbered lists, tables, and images saved in the current chat. Sine and cosine plots can be generated locally from a bounded mathematical specification. Other code or filenames mentioned by a model do not create files. Missing images must be attached before they can be embedded.

The selected local model drafts validated structured content through Ollama. No model-generated Python, shell commands, or arbitrary file paths are executed. Models must support structured output. Truncated, malformed, or failed generations report an error and do not present a fake file attachment. Stop cancels drafting; an in-progress file build finishes cancellation before the chat queue is released.

## Storage and access

Documents live under `<LAW_DATA_DIR>/artifacts/<artifact-id>/`. The original chat stores the attachment descriptor and document text for subsequent context. Files are published only after the Word package and preview are complete. The backend saves the reply before announcing completion, so navigating away does not redirect the attachment to another chat.

Preview, image, and download endpoints require the app session credential. Source images are resolved from the source chat, never fetched from model-provided paths or URLs. Images locked after creation block access to the derived document. Deleting a source chat hides its documents; restoring the chat restores access. Artifact bytes are retained until app reset or a future explicit cleanup. Normal app backups include them, and reset inventories list them as Chat documents.

Creation and failures are recorded in the existing backend logs. A Word library missing from a partial installation is reported with setup guidance. The normal core requirements already include `python-docx` and Pillow; no additional Windows runtime or GPU is required for file construction and preview. The model still needs enough resources to draft the content.

## Implementation and checks

- `backend/services/chat_documents.py`: request detection, schema, model stream, image resolution, bounded plotting, atomic file creation and persistence.
- `backend/routes/artifacts.py`: authenticated preview, image, and file routes.
- `src/components/DocumentViewer.jsx`: attachment controls and local viewer.
- `tests/backend/test_chat_documents.py` and `tests/frontend/documents.test.jsx`: file contents, image access, malformed output, cancellation, path validation, viewer rendering and conversation context.

Use `npm run verify` with all backend storage redirected to disposable directories. Live verification should include an actual model-generated file, the normal chat send flow, a saved chat image, attachment persistence after reload, and the viewer/download controls.
