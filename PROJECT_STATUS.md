# Project status

Verified 2026-09-23 on the local `baseline/v1.0.0-portable` checkout. The
known limitations below were last reviewed on 2026-09-19.

The application is a working local desktop development checkout. It is not a
packaged release, and the checks below do not establish production readiness.

## Verification

- 735 backend tests passed with isolated data, log, model and test directories.
- 410 frontend tests passed.
- The Vite production build passed.
- Existing FastAPI lifecycle deprecation warnings and a Vite bundle-size
  warning remain.

These checks used an existing dependency installation. A fresh dependency
installation, real GPU inference and LoRA training were not validated by this
publication check.

## Implemented areas

- Electron startup, authenticated loopback API access and local settings.
- Streaming Ollama chat, attachments, session storage and export routes.
- Document ingestion, knowledge-base retrieval and durable memory.
- Single-page public HTTPS ingestion with network destination checks.
- Image generation, prompt controls, galleries, queues and image workflows.
- LoRA dataset preparation, training orchestration and adapter controls.
- Face detection, crop curation, similarity grouping and character profiles.
- Persistent scene state and reviewed transitions between generated frames.
- Image collections, media manager, image editor and character parts.
- Knowledge vault and knowledge graph.
- Dashboard drive space, system stats, CPU assistance, maintenance and reset.

## Known limitations

- Locked images can remain accessible through face-derived copies; the private
  image boundary needs to cover those derived resources.
- Replacing a knowledge-base document can remove the previous index before a
  replacement embedding succeeds.
- Desktop navigation restrictions can block chat Markdown and face ZIP
  downloads even when their API routes succeed.
- Face Studio selection and reference state do not fully survive reload.
- The LLM action planner / iterative scene director is not implemented.
- ControlNet, an embedding-conditioned face adapter and general multi-reference
  conditioning are not implemented.
- A previously recorded real SDXL smoke test ended in a native runtime crash
  before producing a frame. End-to-end continuity quality remains unverified.
- Portable packaging and a clean-machine installation test remain outstanding.

Feature-specific documentation describes additional constraints. Older sections
of `ARCHITECTURE.md` and implementation reports are historical snapshots; source
and current tests take precedence where they differ.
