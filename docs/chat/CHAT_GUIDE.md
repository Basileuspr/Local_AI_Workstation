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
- Enter or **Send** submits text, attachments, or both. You can send images alone
  in a new or existing chat and let the selected vision model react without typing
  a prompt. Use the composer’s image-generation action for an image job.
  The selected chat model and the image model are separate settings.
- **Response length** accepts an exact limit from 1 to 32,768 tokens. Automatic
  allows up to 2,048. Thinking uses the same allowance. The effective limit can
  be lower when the model context or remaining prompt space requires it; inspect
  the reported cap rather than assuming the requested number was available.
- Model, prompt, context and generation settings are captured when a request is
  submitted. Changing controls afterward affects later requests.
- **Chat options → Session context / Thinking** and **Response length** belong to
  the selected installed model. Switching models restores its saved context,
  thinking, output and sampling settings. Chat A and Chat B remember these
  independently. **Reset this model’s settings** restores metadata-based starting
  values for that model; replacing its installed version starts a fresh profile.
- Plain text beneath the chat header shows the next request’s limits, advertised
  model limit, image/tool capabilities and installed file size. After a reply it
  also shows that model’s recorded prompt/output counts, request context, generation
  speed and context adjustments. Prompt counts identify provider counts versus
  estimates. Generation speed excludes loading/prompt processing and describes the
  final inference round when tools run. Thinking and answer tokens share one cap.
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

Uploads have no application byte, pixel or attachment-count ceiling. Image
originals stream to disk and the transcript stores references rather than base64
copies. Model context and inference previews are handled separately from saving
the original. See [upload and import sizes](../workspace/FILE_TOOLS.md#upload-and-import-sizes).

Chat history, optional durable user memory, roleplay settings and Knowledge
retrieval have distinct owners. Review the active context controls when answers
include unexpected information. [Knowledge](../workspace/KNOWLEDGE_VAULT.md) is
explicitly ingested; uploading a chat attachment does not automatically create a
Knowledge library.

The model’s advertised context ceiling, its installed file size and the selected
request window describe different things. A larger file does not automatically
mean a larger context. New profiles start conservatively at the smaller of the
host default and known model limit. Larger selectable windows can require more
memory and run slower; the advertised maximum is not a hardware performance
guarantee. Thinking controls expose only settings reported for that model. If a
provider emits thinking despite an Off request, the next status records it.

The input allowance is the selected context minus output and a small safety
reserve. The conversation estimate excludes memories, Knowledge excerpts and tool
definitions that the backend adds later; the backend budgets their actual content
together and shortens optional context only when needed. Earlier turns compact
near 90% of the estimated input allowance. Selecting a larger profile can reuse
original earlier messages when the full conversation fits; the saved summary and
full transcript remain available.

## Durable memory

Open **Workspace → Memory**, **Chat options → Manage saved memories**, or
**Browse and organize memories** beside the quick-save field in model settings.
The library shows the saved text, category, priority, active/paused state, creation
and edit times, and existing project/chat associations. Nothing is saved merely
by opening the workspace.

Use **Add memory** for a lasting preference, fact or constraint. Categories accept
custom names; priority ranges from 1 (low) to 5 (high). Search text and category or
project names, filter by category/status, and sort by priority or edit time.
**Save memory** commits edits. Switching workspaces retains an open draft; closing
it or opening a different entry asks before discarding unsaved changes.

**Pause** excludes an entry from future model requests while retaining it for
review; **Resume** makes it eligible again. **Delete memory** asks for a button
confirmation, with no typing requirement. Version checks reject stale edits or
deletions; refresh the library and reopen the entry to reconcile.

The current selection considers up to ten active memories, ordered by descending
priority and most recent edit. **Next candidate** identifies the ordinary-chat
shortlist, not confirmed use. Project requests can narrow the list; context limits
can shorten or omit content. Categories are organization labels, not chat scope
boundaries. Roleplay can separately disable saved user memory in **Response
influences**. Inspect a reply’s recorded influences for its actual supplied context.

**Export filtered memories · JSON** saves a readable copy of every matching entry
across pages, including full text. It does not replace **EXPORT BACK-UP** or provide
an import workflow. The library is distinct from chat rolling summaries and
Knowledge documents. Editing, pausing or deleting an entry does not erase copies
already present in chat replies, summaries or backups.

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
