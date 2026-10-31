# Tool discovery and local model execution

Dashboard’s searchable catalog describes backend tools and interactive workspaces.
Loading, filtering or exporting it does not execute tools, probe models or inspect
user files. Exports include the whole catalog.

## Discovery

Authenticated endpoints are `GET /tools/registry`,
`GET /tools/registry/{tool_id}` and `GET /tools/registry.md`.
Contracts include stable IDs, purpose, interface, effects, prerequisites,
availability, input schema, output description, `llm_callable` and execution policy.

Registered means the route exists, not that its runtime/models are ready.
UI-only tools require their workspace. Missing routes are unavailable.
The catalog is curated; OpenAPI is the broader route inventory.

Coordinator is a main workspace with Coding, Research & Knowledge and Media
Librarian harnesses. Its catalog entries open the interactive UI; action approval,
Knowledge saves and transfer confirmation remain explicit workspace controls.
See [Coordinator](../workspace/COORDINATOR.md) for saved runs and recovery.

Reverse Engineer's catalog entry describes its interactive tool hub and saved
desktop launchers. Ghidra, dnSpyEx, JADX, x64dbg and Frida are external free tools.
Local installation receipts link them automatically; custom selections remain available.
They are not exposed as model-callable analysis or shell endpoints;
opening a catalog entry does not launch a program.

Phone is an interactive setup workspace. Its catalog entry does not expose
filesystem discovery or device commands to models. Trusted desktop IPC checks
installation files for KDE Connect and scrcpy; it does not launch either tool,
probe a phone, or read notifications. Companion retains its existing controls.

HTTP schemas derive from the actual route models. Arguments are grouped into
path/query/body and other documented locations. Binary/upload contracts do not
grant arbitrary filesystem access. Outputs can be asynchronous task snapshots or
downloads; descriptions are not universal machine-validated response schemas.
Session credentials belong to the trusted client, never a model prompt/export.

## Opt-in chat execution

Enable **Local model tool use**, choose up to 16 eligible tools and select an
installed Ollama model with native tool-calling support. Tool use defaults off.

Selected read tools can run automatically. Actions that save/write, contact a
network or cancel work present exact arguments for **Approve action** or **Deny**.
A response is bounded to four rounds and eight sequential calls. Chat releases
inference admission between model rounds so tools can use the normal queue.

`POST /tools/execute` accepts `{tool_id, arguments}`. Reads return results;
actions return a pending plan. `POST /tools/plans/{id}/decision` accepts only
`{approved: true}` or `{approved: false}`. Plans are memory-only, expire after
ten minutes and cannot be edited/replayed. Stopping chat discards an unclaimed
plan; it does not undo completed actions.

Models cannot choose arbitrary endpoints, headers, credentials, shell commands
or filesystem APIs. Uploaded-file tools, interactive workspaces, downloads and
credential-bearing Discord Send remain in dedicated controls. Route validation,
session/origin checks, maintenance gates and reviewed file plans still apply.

## Document understanding

Chat DOCX extraction preserves paragraph/table order and can describe embedded
raster pictures using the configured local OCR/vision model. PDF extraction keeps
native text and can add labeled visual descriptions for graphical pages.
Optional failures retain usable text/tables with coverage warnings; no usable
text plus failed OCR produces an error.

Visual processing is bounded to 32 Word pictures or 32 text-rich graphical PDF
pages per import. Linked Word images are not fetched; unsupported/omitted pictures
are reported. Legacy binary DOC is unsupported. Model visual descriptions can be
wrong and require review. Folder Review has a separate, text/metadata-only contract.

## Maintaining contracts

Update `backend/services/tool_catalog.py` and the execution policy with stable
IDs and accurate effects. Reuse route models rather than duplicating schemas.
Incompatible semantics need a new ID or an explicit compatibility strategy.
Do not add live prerequisite probes to discovery.

[Chat](../chat/CHAT_GUIDE.md) · [Architecture](ARCHITECTURE_REFERENCE.md) ·
[Verification](VERIFICATION.md)
