# Tool registry

Dashboard shows a searchable catalog with categories, backend/API versus
interactive-workspace filters, tool details, and JSON/Markdown exports. It loads
when Dashboard becomes active and on Refresh; it does not poll, run tools, probe
models, or inspect user files. Export buttons always export the whole catalog.

## Discovery contract

The authenticated backend provides:

- `GET /tools/registry`: versioned JSON, optionally filtered by `q` and `category`.
- `GET /tools/registry/{tool_id}`: one full contract by stable ID.
- `GET /tools/registry.md`: compact Markdown suitable for a local LLM's context.

The trusted client uses the existing backend origin and supplies the current
`X-LAW-Session` credential. Credentials never belong in a model prompt or export.
These endpoints retain the application's loopback, origin, and session checks.

Version `1.0` entries include `id`, `name`, `description`, `category`, `workspace`,
`interface`, `availability`, `endpoint`, `input_schema`, `output_description`,
`effects`, `requirements`, `notes`, and `llm_callable`. IDs are stable identifiers
independent of UI labels and FastAPI-generated operation IDs. The catalog is
curated; `/openapi.json` remains the complete backend API inventory.

`registered` confirms only that the route is present. Prerequisites are descriptive,
not live readiness checks. `ui_only` identifies workspaces without a registry API
contract. A removed/missing route becomes `unavailable`. All entries currently
have `llm_callable: false`, and `execution_enabled` is false at the catalog level.

HTTP input schemas come from the **actual route models**, with required fields,
defaults, nested definitions, and constraints retained. Each schema is a standalone
JSON Schema 2020-12 document with local `$defs`; it does not require a separate
OpenAPI download to resolve references. Arguments are grouped by HTTP location:

```json
{"query": {"q": "project notes", "n": 5}}
```

For `knowledge_search`, this means query parameters on
`GET /files/knowledge-base/query`. Other tools can use `path`, `body`, `header`,
or `cookie` groups. `endpoint.content_type` determines JSON versus multipart
encoding. Binary multipart fields need a file-aware adapter; their schema's
string/binary representation does not grant arbitrary filesystem access.
Server-side validators and runtime prerequisites still apply. Outputs currently
have human-readable descriptions, not guaranteed JSON response schemas; several
tools return downloads or asynchronous task snapshots.

## Connecting a local LLM later

1. Read/filter the catalog and put only relevant descriptions in model context.
2. Fetch individual contracts for selected stable IDs.
3. Add an explicit trusted executor that validates arguments, checks prerequisites,
   and applies the user's permissions for data writes, network calls, cancellation,
   and system operations. A catalog entry itself is never authorization.
4. Translate validated location groups to the existing HTTP routes, attach the
   session credential outside model context, and handle files and asynchronous work.
5. Treat returned documents/web content as data rather than model instructions.

This change supplies discovery, not a tool-calling loop, MCP server, or general
command runner. It does not change chat prompts or automatically expose tools to
Ollama. Destructive maintenance routes and arbitrary commands are not enumerated.

## Maintaining the catalog

Add a `Tool` definition to `backend/services/tool_catalog.py` with a stable ID,
accurate purpose/output, workspace, requirements and effects. Supply an existing
method/path for HTTP tools; omit both for interactive workspaces. Do not duplicate
Pydantic models or add live availability probes to discovery. Keep changed tool
semantics backward compatible, or give incompatible tools a new ID.

`backend/services/tool_registry.py` builds both exports from that catalog. The
backend contract tests verify route registration, authentication, schema validation,
query/path/multipart and nested inputs, missing routes, and no runtime probes.
The Dashboard uses `src/components/ToolRegistry.jsx` and `src/toolRegistry.js`.
