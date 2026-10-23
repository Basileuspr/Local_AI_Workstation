# Chat, attachments and media actions

Use **New Chat**, choose an installed Ollama model, and send a message.
A new chat starts unsaved; sending a message or saving an attachment creates its
session. Typing alone does not. Startup normally opens a blank workspace;
**Resume Last Chat** restores the previous conversation when enabled.

## Compose and control a response

- **Chat options → Chat width** adjusts the centered conversation area from 640
  to 1,600 pixels. Drag the slider or use its arrow keys; **Reset width** restores
  800 pixels. Messages and the composer resize together. The maximum width is
  remembered for both chats on this computer, and smaller panes fit their available
  space. Long replies scroll above the composer.
- Enter sends text; use the composer’s image-generation action for an image job.
  The selected chat model and the image model are separate settings.
- **Response length** accepts an exact limit from 1 to 32,768 tokens. Automatic
  allows up to 2,048. Thinking uses the same allowance. The effective limit can
  be lower when the model context or remaining prompt space requires it; inspect
  the reported cap rather than assuming the requested number was available.
- Model, prompt, context and generation settings are captured when a request is
  submitted. Changing controls afterward affects later requests.
- Prompt Queue coordinates model work. Stop requests cancellation; GPU ownership
  remains with the task until cleanup finishes. Hiding a notice does not cancel it.
- Code blocks keep source whitespace and expose **Copy code**, including on narrow
  screens. Copying code excludes surrounding prose and Markdown fences.
- Response influence details describe the context/options actually submitted.
  They do not prove which instruction caused a particular sentence.

The current UI, shared settings and persistence are implemented in
`src/App.jsx`, `src/useChatUploads.js`, `src/responseBudget.js`
and the backend chat/session services. See [architecture](../development/ARCHITECTURE_REFERENCE.md)
before changing request or storage behavior.

## Attachments and context

Attach supported documents or images using the composer. An attachment saved
during navigation belongs to the chat selected when its upload began. A vision
model is needed to interpret image pixels; attaching an image to a text-only model
does not give it vision. Installed software/specification context describes
detected local capabilities, not a guarantee that a runtime or model works.

Chat history, optional durable user memory, roleplay settings and Knowledge
retrieval have distinct owners. Review the active context controls when answers
include unexpected information. [Knowledge](../workspace/KNOWLEDGE_VAULT.md) is
explicitly ingested; uploading a chat attachment does not automatically create a
Knowledge library.

## Second chat

Open the second chat through Workspace options / the side pane. It has its own
conversation selection and model controls while using the shared backend queue.
Two visible panes do not imply two models can infer on the same GPU at once.
History edits must respect session revisions: refresh/reconcile conflicts rather
than overwriting changes from another client.

## Images in chat

**Generate image** uses the shared image settings, selected model and explicit
LoRA. Requests retain their original chat destination and submitted settings.
Model changes can clear an incompatible adapter. See
[image generation and queue](../images/GENERATION.md) for reference images,
batches, cancellation and restart behavior.

For an existing image, use its media action to open **Image Editor**, or use
`/Edit` with the intended image. If no explicit image is selected, the chat
workflow can use its latest image. Preview and undo changes, then **Send edited
image to chat** to append a new PNG. The source remains unchanged. This is a local
pixel editor; the chat model does not execute arbitrary image-editing code.
See [Image Editor](../images/IMAGE_EDITOR.md).

Saved gallery copies have a separate lifetime from their source chat. Removing
chat content does not necessarily remove copies in collections. Locked vault
items remain subject to the vault’s access checks across chat, editing and exports.

## Create a Word document

Use `/docx` for a structured Word document assembled from supported text,
paragraphs, lists, tables and eligible images in the current chat. Supported
bounded plots use the built-in renderer. The model cannot run arbitrary Python or
read arbitrary filesystem paths to construct the document.

Generation validates the structure and stores the output through managed storage.
Preview it, then download the DOCX. Preview pagination may differ from Word.
Source-chat deletion can hide the associated document until that chat is restored.
Use [Document Editor](../workspace/DOCUMENT_EDITOR.md) for ongoing visual editing
and [Local Files](../workspace/FILE_TOOLS.md) for preserving an existing DOCX package.

## Related guides

[Characters and roleplay](../images/CHARACTERS.md) ·
[Gallery, collections and review](../images/GALLERY_AND_BULK_ACTIONS.md) ·
[Audio](../media/AUDIO.md) · [Storage and backup](../workspace/STORAGE_AND_BACKUP.md)
