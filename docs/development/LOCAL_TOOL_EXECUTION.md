# Local chat tools, document understanding and image profiles

Enable **Local model tool use** in Chat options, then select up to 16 tools.
Use an installed Ollama model that supports native tool calling. Tool use is off
by default. Read tools run automatically when selected; actions that save data,
write files, contact networks or cancel work display their exact arguments for
Approve action or Deny. A reply allows four tool rounds and eight calls. Calls
run sequentially, and chat releases the shared inference queue between model
rounds so nested tools can enter the normal queue.

The registry includes `llm_callable` and `execution` policy for every entry.
JSON HTTP tools dispatch through their existing local routes, with schema,
session and maintenance validation. Models cannot select arbitrary endpoints,
headers, credentials, shell commands or filesystem APIs. Interactive workspaces,
uploaded-file tools, downloads and credential-bearing Discord Send remain in
their dedicated controls. Existing route readiness, file-operation plans and
GPU safeguards still apply.

`POST /tools/execute` accepts `{tool_id, arguments}`. Arguments use the
registry's `path`, `query` and `body` groups. A read returns a result; an action
returns an exact pending plan. `POST /tools/plans/{id}/decision` accepts only
`{approved: true}` or `{approved: false}`. Plans remain in memory, expire after
10 minutes, and cannot be replayed or edited during approval. Chat reports tool
activity and waits for review; stopping chat discards an unclaimed pending plan.
Completed actions are not rolled back by stopping a later model reply.

Document attachments preserve Word paragraph/table order, including nested
tables, and describe embedded raster pictures through the configured local OCR
vision model. PDFs retain useful native text and also inspect pages containing
raster images, vector paths or shading. Low-text pages use local transcription
with visual descriptions. Text-rich graphical pages append a labeled visual
description without replacing native text. Visual descriptions are model output
and may contain errors. Text and tables remain available if optional visual
understanding fails; import coverage reports missing descriptions. Documents
with no usable text and failed OCR return an extraction error.

Visual understanding processes at most 32 Word pictures or 32 text-rich PDF
graphical pages per import. Linked Word pictures are not fetched. Unsupported
picture formats and omitted pictures are reported. Pixel inputs are processed
in memory rather than saved as new media assets. Legacy binary `.doc` files
are not supported by the DOCX parser.

Image profiles save exactly **prompt, negative prompt, steps, guidance and
seed**. Add creates a snapshot; Update deliberately replaces that snapshot.
Editing ordinary controls never autosaves a selected profile. Applying one
keeps model, dimensions, LoRA, output folder and chat settings. Older profiles
remain readable; their extra settings are ignored during application, and a
legacy copy is retained when an older profile is explicitly updated.

Frontend preview tests use simulated tools. Backend tests verify authenticated
dispatch, validation, exact review, denial, replay/expiry prevention, cancellation
and inference-queue handoff with neutral data. GPU visual-description accuracy
requires separate live document testing.
