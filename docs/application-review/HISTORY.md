# Application history

[Open searchable reader and comparison](index.html#history)

## How dates should be read

Git author and commit dates are recorded metadata, not proof of deployment or original implementation time. A first-observed snapshot establishes that source was present by that timestamp. File modification times are not used as introduction dates. Commit subjects describe intent; changed paths provide supporting scope. No historical user data is copied into this record.

First source observation: **2026-10-02T10:40:26.579945-06:00** (America/Denver).
Latest source observation: **2026-10-03T04:01:43.423973-06:00**.
App version: **1.0.1-dev**. Branch: ``. HEAD: `5a2cc374c5072666b63d56c666f65abb71a2ff77`.

Latest captured build: `1.0.1-dev+20261003T100143-423973Z.5a2cc374.a5ef3338380b.dirty`. Dirty at capture: True.

## Uncommitted feature observations

### Application audit, offline reader and source snapshot comparisons

Created during this September 30, 2026 audit at the user's request. The first source snapshot records the precise observation time. Application behavior was not changed.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [docs/application-review/README.md](../../docs/application-review/README.md), [docs/application-review/review.json](../../docs/application-review/review.json), [docs/application-review/reader-template.html](../../docs/application-review/reader-template.html), [scripts/capture-app-review.py](../../scripts/capture-app-review.py).

### Audio recording, transcription, extraction and voice controls

Present in this working tree; PROJECT_STATUS reports a feature review on 2026-09-28. Exact introduction dates are not established.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [AUDIO.md](../../AUDIO.md), [src/components/AudioWorkspace.jsx](../../src/components/AudioWorkspace.jsx), [src/components/AudioExtractor.jsx](../../src/components/AudioExtractor.jsx), [src/components/VoiceCloningPanel.jsx](../../src/components/VoiceCloningPanel.jsx), [backend/routes/audio.py](../../backend/routes/audio.py), [backend/routes/audio_extraction.py](../../backend/routes/audio_extraction.py), [backend/routes/voice_cloning.py](../../backend/routes/voice_cloning.py).

### Character Creator and per-reply response influences

Present but not committed at inspection; September 28 status entry is a reported review date, not an independently established creation date.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [CHARACTERS.md](../../CHARACTERS.md), [src/components/CharacterCreator.jsx](../../src/components/CharacterCreator.jsx), [src/components/ChatInfluences.jsx](../../src/components/ChatInfluences.jsx), [backend/services/character_resources.py](../../backend/services/character_resources.py), [backend/services/chat_influences.py](../../backend/services/chat_influences.py).

### GIF Maker, ZIP Packager and isolated source browser

First recorded by this snapshot; September 28 status entry reports these capabilities.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [src/components/GifMaker.jsx](../../src/components/GifMaker.jsx), [src/components/FilePackager.jsx](../../src/components/FilePackager.jsx), [src/components/ViewerBrowser.jsx](../../src/components/ViewerBrowser.jsx), [backend/services/gif_maker.py](../../backend/services/gif_maker.py), [backend/services/file_packager.py](../../backend/services/file_packager.py), [electron/viewerBrowser.js](../../electron/viewerBrowser.js).

### Backend-owned image batches, retained previews and ETA helpers

First recorded by this snapshot; exact implementation times are unavailable for untracked files.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [backend/services/image_tasks.py](../../backend/services/image_tasks.py), [src/components/ImageBatchOutput.jsx](../../src/components/ImageBatchOutput.jsx), [src/generationHistory.js](../../src/generationHistory.js), [src/queueTiming.js](../../src/queueTiming.js), [src/imageProgress.js](../../src/imageProgress.js).

### Compact composer, image seeds, output destinations and removal controls

Present in the current uncommitted working tree; first-observed capture date is the only new timestamp established here.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [src/components/ChatComposer.css](../../src/components/ChatComposer.css), [src/components/ImageSeedControls.jsx](../../src/components/ImageSeedControls.jsx), [src/components/ImageOutputFolder.jsx](../../src/components/ImageOutputFolder.jsx), [src/components/ImageRemovalControls.jsx](../../src/components/ImageRemovalControls.jsx).

### Transitive Undici dependency update

Committed HEAD locks Undici 7.29.0; the inspected working-tree lock records 7.30.0. The original update date is unknown. npm audit reported zero advisories during this review.

First recorded observation: 2026-09-30T22:10:51.927290-06:00.

Source: [package-lock.json](../../package-lock.json).

### R02: shared revision-keyed session and image metadata cache

Implemented during this user-authorized follow-up. Documented at 2026-09-30T23:17:55.880201-06:00. Synthetic benchmark recorded at 2026-10-01T05:16:14.312107+00:00; current full automated suites and a scratch build passed. This records a source implementation, not deployment or real-user-library latency. Final privacy hardening also suppresses unverifiable legacy metadata while locks exist. Whole-worktree snapshots include other local edits; the R02 source list defines this change scope.

First recorded observation: 2026-09-30T23:17:55.880201-06:00.

Source: [backend/services/session_store.py](../../backend/services/session_store.py), [backend/routes/sessions.py](../../backend/routes/sessions.py), [src/api.js](../../src/api.js), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx), [tests/backend/test_session_metadata.py](../../tests/backend/test_session_metadata.py), [tests/backend/test_image_collections.py](../../tests/backend/test_image_collections.py), [tests/frontend/sessionImageInventory.test.js](../../tests/frontend/sessionImageInventory.test.js), [scripts/benchmark-session-metadata.py](../../scripts/benchmark-session-metadata.py), [docs/application-review/changes/R02-session-metadata.md](../../docs/application-review/changes/R02-session-metadata.md), [docs/application-review/benchmarks/session-metadata.json](../../docs/application-review/benchmarks/session-metadata.json).

### R01: coordinated 1.0.1-dev version and captured desktop/renderer/API build identity

Implemented during this explicitly requested follow-up and documented at 2026-09-30T23:51:06.121761-06:00. This is a local development version and source-capture workflow, not a published stable release. Existing commit dates, September 28 reported feature dates and September 30 first observations remain distinct; original uncommitted feature creation dates are not inferred.

First recorded observation: 2026-09-30T23:51:06.121761-06:00.

Source: [package.json](../../package.json), [package-lock.json](../../package-lock.json), [scripts/capture-app-review.py](../../scripts/capture-app-review.py), [scripts/prepare-build.cjs](../../scripts/prepare-build.cjs), [vite.config.mjs](../../vite.config.mjs), [electron/buildInfo.js](../../electron/buildInfo.js), [electron/main.js](../../electron/main.js), [backend/services/build_info.py](../../backend/services/build_info.py), [backend/main.py](../../backend/main.py), [backend/services/software_specs.py](../../backend/services/software_specs.py), [backend/routes/system_stats.py](../../backend/routes/system_stats.py), [src/buildIdentity.js](../../src/buildIdentity.js), [src/softwareSpecs.js](../../src/softwareSpecs.js), [src/components/SoftwareSpecs.jsx](../../src/components/SoftwareSpecs.jsx), [RELEASES.md](../../RELEASES.md), [tests/backend/test_build_identity.py](../../tests/backend/test_build_identity.py), [tests/frontend/buildIdentity.test.js](../../tests/frontend/buildIdentity.test.js), [docs/application-review/changes/R01-build-identity.md](../../docs/application-review/changes/R01-build-identity.md).

### R03: revision-checked session replacement and metadata-only rename/compaction

Implemented during this explicitly requested follow-up; synthetic HTTP/store/reducer checks preserve newer messages and image references. This records source implementation, not live deployment or original creation times of preexisting features.

First recorded observation: 2026-10-01T00:10:04-06:00.

Source: [backend/services/session_store.py](../../backend/services/session_store.py), [backend/routes/sessions.py](../../backend/routes/sessions.py), [src/api.js](../../src/api.js), [src/components/InputBar.jsx](../../src/components/InputBar.jsx), [src/components/Header.jsx](../../src/components/Header.jsx), [backend/routes/bridge.py](../../backend/routes/bridge.py), [src/App.jsx](../../src/App.jsx), [src/useStore.jsx](../../src/useStore.jsx), [src/sessionPersistence.js](../../src/sessionPersistence.js), [src/webAccess.js](../../src/webAccess.js), [src/useChatUploads.js](../../src/useChatUploads.js), [src/ImageGenerationContext.jsx](../../src/ImageGenerationContext.jsx), [src/workspaceContext.js](../../src/workspaceContext.js), [tests/backend/test_session_revisions.py](../../tests/backend/test_session_revisions.py), [tests/frontend/sessionRevisions.test.jsx](../../tests/frontend/sessionRevisions.test.jsx), [docs/application-review/changes/R03-session-revisions.md](../../docs/application-review/changes/R03-session-revisions.md).

## Dated source observations

### 2026-10-02T10:40:26.579945-06:00 · Production build source capture

Source version 1.0.1-dev; HEAD `de4dd46`. Compared with committed HEAD: 100 added, 107 changed, 0 removed source/document files.

Snapshot: [metadata JSON](snapshots/2026-10-02T164026-579945Z.json). Hashes prove source differences, not feature correctness or measured speed improvements.

Build identifier: `1.0.1-dev+20261002T164026-579945Z.de4dd463.eb9f54d1c5ad.dirty`. Dirty at capture: True. Capture UTC: 2026-10-02T16:40:26.579945+00:00.

### 2026-10-02T10:41:25.604137-06:00 · Production build source capture

Source version 1.0.1-dev; HEAD `de4dd46`. Compared with previous observation: 0 added, 1 changed, 0 removed source/document files.

Snapshot: [metadata JSON](snapshots/2026-10-02T164125-604137Z.json). Hashes prove source differences, not feature correctness or measured speed improvements.

Build identifier: `1.0.1-dev+20261002T164125-604137Z.de4dd463.31739da4d6db.dirty`. Dirty at capture: True. Capture UTC: 2026-10-02T16:41:25.604137+00:00.

### 2026-10-02T10:42:23.544937-06:00 · Production build source capture

Source version 1.0.1-dev; HEAD `de4dd46`. Compared with previous observation: 0 added, 2 changed, 0 removed source/document files.

Snapshot: [metadata JSON](snapshots/2026-10-02T164223-544937Z.json). Hashes prove source differences, not feature correctness or measured speed improvements.

Build identifier: `1.0.1-dev+20261002T164223-544937Z.de4dd463.be28a8fecf49.dirty`. Dirty at capture: True. Capture UTC: 2026-10-02T16:42:23.544937+00:00.

### 2026-10-02T17:56:28.177725-06:00 · Production build source capture

Source version 1.0.1-dev; HEAD `8c01ac0`. Compared with previous observation: 315 added, 239 changed, 0 removed source/document files.

Snapshot: [metadata JSON](snapshots/2026-10-02T235628-177725Z.json). Hashes prove source differences, not feature correctness or measured speed improvements.

Build identifier: `1.0.1-dev+20261002T235628-177725Z.8c01ac0b.cf731d05a91a.dirty`. Dirty at capture: True. Capture UTC: 2026-10-02T23:56:28.177725+00:00.

### 2026-10-03T04:01:43.423973-06:00 · Production build source capture

Source version 1.0.1-dev; HEAD `5a2cc37`. Compared with previous observation: 108 added, 89 changed, 0 removed source/document files.

Snapshot: [metadata JSON](snapshots/2026-10-03T100143-423973Z.json). Hashes prove source differences, not feature correctness or measured speed improvements.

Build identifier: `1.0.1-dev+20261003T100143-423973Z.5a2cc374.a5ef3338380b.dirty`. Dirty at capture: True. Capture UTC: 2026-10-03T10:01:43.423973+00:00.

## Committed local source history

### 2026-09-19T06:35:17-06:00 · e696497 · Publish current application source without private runtime history

Author date: 2026-09-19T06:35:17-06:00. Commit date: 2026-09-19T06:35:17-06:00. 247 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `.gitignore`
- `ARCHITECTURE.md`
- `CHAT_IMAGE_GENERATION.md`
- `CPU_ASSISTANCE.md`
- `DASHBOARD_RESET.md`
- `FACE_FOLDERS.md`
- `GALLERY_AND_BULK_ACTIONS.md`
- `GENERATION_CONTROLS.md`
- `IMAGE_COLLECTIONS.md`
- `IMAGE_WORKFLOWS.md`
- `INTERNET_ACCESS_PROPOSAL.md`
- `PROJECT_STATUS.md`
- `PROMPT_QUEUE.md`
- `README.md`
- `ROADMAP_SEGMENTS_4_6.md`
- `backend/config.py`
- `backend/main.py`
- `backend/maintenance.py`
- `backend/routes/export.py`
- `backend/routes/faces.py`
- `backend/routes/files.py`
- `backend/routes/image_generation.py`
- `backend/routes/image_library.py`
- `backend/routes/image_workflows.py`
- `backend/routes/lora.py`
- `backend/routes/memory.py`
- `backend/routes/prompt_index.py`
- `backend/routes/request_queue.py`
- `backend/routes/sessions.py`
- `backend/routes/system_stats.py`
- `backend/routes/web.py`
- `backend/services/app_logging.py`
- `backend/services/cpu_assistance.py`
- `backend/services/faces/__init__.py`
- `backend/services/faces/bank.py`
- `backend/services/faces/crops.py`
- `backend/services/faces/insight_onnx.py`
- `backend/services/faces/pipeline.py`
- `backend/services/faces/providers.py`
- `backend/services/faces/store.py`
- `backend/services/file_parser.py`
- `backend/services/gpu_coordination.py`
- `backend/services/image_generation.py`
- `backend/services/image_library.py`
- `backend/services/image_store.py`
- `backend/services/image_vault.py`
- `backend/services/image_workflows/__init__.py`
- `backend/services/image_workflows/adapters.py`
- `backend/services/image_workflows/contracts.py`
- `backend/services/image_workflows/deletion.py`
- `backend/services/image_workflows/exports.py`
- `backend/services/image_workflows/planning.py`
- `backend/services/image_workflows/providers.py`
- `backend/services/image_workflows/runner.py`
- `backend/services/image_workflows/scene_state.py`
- `backend/services/image_workflows/scenes.py`
- `backend/services/image_workflows/store.py`
- `backend/services/knowledge_base.py`
- `backend/services/lora_store.py`
- `backend/services/lora_training.py`
- `backend/services/lora_vision.py`
- `backend/services/lora_worker.py`
- `backend/services/maintenance_gate.py`
- `backend/services/memory_store.py`
- `backend/services/process_lock.py`
- `backend/services/prompt_index_store.py`
- `backend/services/request_queue.py`
- `backend/services/session_guard.py`
- `backend/services/session_store.py`
- `backend/services/system_stats.py`
- `backend/services/web_access.py`
- `electron/driveFolders.js`
- `electron/faceFiles.js`
- `electron/filePicker.js`
- `electron/logger.js`
- `electron/main.js`
- `electron/maintenance.js`
- `electron/preferenceMigration.js`
- `electron/preload.js`
- `electron/security.js`
- `package-lock.json`
- `package.json`
- `pytest.ini`
- `requirements-sdxl-cuda.txt`
- `requirements.lock.txt`
- `requirements.txt`
- `scripts/qa-character-save.cjs`
- `scripts/qa-desktop.cjs`
- `scripts/qa-iterative-sdxl.py`
- `scripts/qa-preference-migration.cjs`
- `scripts/qa-task-progress.cjs`
- `src/App.jsx`
- `src/ImageGenerationContext.jsx`
- `src/ImagePrivacy.jsx`
- `src/api.js`
- `src/bulkActions.js`
- `src/chatImageGeneration.js`
- `src/chatSubmissionQueue.js`
- `src/components/BulkActions.jsx`
- `src/components/CharacterNameDialog.jsx`
- `src/components/ChatImageControls.css`
- `src/components/ChatImageControls.jsx`
- `src/components/CollapsibleImageFolder.jsx`
- `src/components/CollectionImages.jsx`
- `src/components/CollectionPager.jsx`
- `src/components/CpuPerformance.jsx`
- `src/components/CustomProfileControls.jsx`
- `src/components/Dashboard.css`
- `src/components/Dashboard.jsx`
- `src/components/DashboardReset.jsx`
- `src/components/EmojiPicker.jsx`
- `src/components/FaceBank.jsx`
- `src/components/FaceStudio.css`
- `src/components/FaceStudio.jsx`
- `src/components/FreshFileInput.jsx`
- `src/components/Header.jsx`
- `src/components/ImageFolderTools.jsx`
- `src/components/ImageGallery.jsx`
- `src/components/ImageGenerationHelp.css`
- `src/components/ImageGenerationHelp.jsx`
- `src/components/ImageGenerationProgress.jsx`
- `src/components/ImageRequests.jsx`
- `src/components/ImageReview.jsx`
- `src/components/ImageReviewMetadata.jsx`
- `src/components/ImageSettingsControls.jsx`
- `src/components/ImageStudio.jsx`
- `src/components/ImageTagButtons.jsx`
- `src/components/ImageViewer.jsx`
- `src/components/ImageWorkflows.jsx`
- `src/components/InputBar.jsx`
- `src/components/LockedImages.jsx`
- `src/components/LoraAnalysisProgress.jsx`
- `src/components/LoraHelp.jsx`
- `src/components/LoraStudio.jsx`
- `src/components/MarkdownMessage.jsx`
- `src/components/MessageList.jsx`
- `src/components/PromptIndex.jsx`
- `src/components/PromptPhraseButtons.css`
- `src/components/PromptPhraseButtons.jsx`
- `src/components/PromptQueue.css`
- `src/components/PromptQueue.jsx`
- `src/components/SceneStudio.jsx`
- `src/components/SettingsPanel.jsx`
- `src/components/Sidebar.jsx`
- `src/components/Toast.jsx`
- `src/components/WebAccess.css`
- `src/components/WebAccess.jsx`
- `src/components/WorkflowDeleteDialog.jsx`
- `src/components/WorkflowExportControls.jsx`
- `src/components/WorkflowImageLibrary.jsx`
- `src/components/WorkflowRunPanel.jsx`
- `src/config.js`
- `src/contextMemory.js`
- `src/emojiCatalog.json`
- `src/faceApi.js`
- `src/faceImport.js`
- `src/imageLibraryApi.js`
- `src/imageRefs.js`
- `src/imageReview.js`
- `src/imageSettingsControls.js`
- `src/imageWorkflow.js`
- `src/imageWorkflowApi.js`
- `src/index.html`
- `src/main.jsx`
- `src/messageIds.js`
- `src/modelCatalog.js`
- `src/preferences.js`
- `src/promptPhrases.js`
- `src/responseStyle.js`
- `src/roleplayPrompt.js`
- `src/sceneState.js`
- `src/serviceStatus.js`
- `src/styles.css`
- `src/taskProgress.js`
- `src/useChatUploads.js`
- `src/useImageLibrary.js`
- `src/useSelection.js`
- `src/useStore.jsx`
- `src/useTaskProgress.js`
- `src/webAccess.js`
- `tests/backend/conftest.py`
- `tests/backend/test_api_smoke.py`
- `tests/backend/test_app_logging.py`
- `tests/backend/test_async_offloading.py`
- `tests/backend/test_bulk_deletion_safety.py`
- `tests/backend/test_config.py`
- `tests/backend/test_cpu_assistance.py`
- `tests/backend/test_face_bank.py`
- `tests/backend/test_faces.py`
- `tests/backend/test_file_parser.py`
- `tests/backend/test_gpu_coordination.py`
- `tests/backend/test_image_collections.py`
- `tests/backend/test_image_generation_cancel.py`
- `tests/backend/test_image_prompt_tokens.py`
- `tests/backend/test_image_store.py`
- `tests/backend/test_image_workflow_adapters.py`
- `tests/backend/test_image_workflow_execution.py`
- `tests/backend/test_image_workflows.py`
- `tests/backend/test_iterative_scenes.py`
- `tests/backend/test_lora_queued_workflow.py`
- `tests/backend/test_lora_store.py`
- `tests/backend/test_lora_training.py`
- `tests/backend/test_lora_vision.py`
- `tests/backend/test_lora_worker.py`
- `tests/backend/test_maintenance.py`
- `tests/backend/test_prompt_index_store.py`
- `tests/backend/test_queue_session_results.py`
- `tests/backend/test_request_queue.py`
- `tests/backend/test_session_guard.py`
- `tests/backend/test_session_store.py`
- `tests/backend/test_status.py`
- `tests/backend/test_system_stats.py`
- `tests/backend/test_web_access.py`
- `tests/backend/test_workflow_deletion.py`
- `tests/backend/test_workflow_exports.py`
- `tests/fixtures/characterSave.jsx`
- `tests/fixtures/taskProgress.jsx`
- `tests/frontend/chatImageGeneration.test.js`
- `tests/frontend/chatUploads.test.js`
- `tests/frontend/collapsibleImages.test.jsx`
- `tests/frontend/config.test.js`
- `tests/frontend/contextMemory.test.js`
- `tests/frontend/cpuPerformance.test.jsx`
- `tests/frontend/dashboard.test.jsx`
- `tests/frontend/desktopMaintenance.test.js`
- `tests/frontend/desktopSecurity.test.js`
- `tests/frontend/driveFolders.test.js`
- `tests/frontend/faceBank.test.js`
- `tests/frontend/faceBrowser.test.js`
- `tests/frontend/faceFiles.test.js`
- `tests/frontend/faceImport.test.js`
- `tests/frontend/galleryAndBulkActions.test.jsx`
- `tests/frontend/imageReview.test.jsx`
- `tests/frontend/imageSettings.test.js`
- `tests/frontend/imageWorkflow.test.js`
- `tests/frontend/markdown.test.jsx`
- `tests/frontend/promptPhrases.test.js`
- `tests/frontend/queuedEditing.test.jsx`
- `tests/frontend/sceneState.test.jsx`
- `tests/frontend/serviceStatus.test.js`
- `tests/frontend/sessionCredential.test.js`
- `tests/frontend/sessionDeletion.test.js`
- `tests/frontend/taskProgress.test.jsx`
- `tests/frontend/webAccess.test.js`
- `tests/frontend/workflowExecution.test.jsx`
- `vite.config.mjs`
- `vitest.config.mjs`

</details>

### 2026-09-24T00:12:44-06:00 · 55e1ffe · Publish application update: media, editing, knowledge vault and hardening

Author date: 2026-09-24T00:12:44-06:00. Commit date: 2026-09-24T00:12:44-06:00. 217 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `.gitignore`
- `ANALYZE_AND_ITERATE.md`
- `ARCHITECTURE.md`
- `CHARACTER_PARTS.md`
- `CHAT_IMAGES_AND_SOFTWARE_SPECS.md`
- `DASHBOARD_RESET.md`
- `DASHBOARD_STORAGE.md`
- `GALLERY_AND_BULK_ACTIONS.md`
- `GENERATION_CONTROLS.md`
- `IMAGE_COLLECTIONS.md`
- `IMAGE_EDITOR.md`
- `IMAGE_WORKFLOWS.md`
- `INTERNET_ACCESS_PROPOSAL.md`
- `KNOWLEDGE_VAULT.md`
- `MEDIA_ACTIONS_AND_CHAT_EDIT.md`
- `MEDIA_MANAGER.md`
- `PROJECT_STATUS.md`
- `README.md`
- `ROADMAP_SEGMENTS_4_6.md`
- `backend/backup_import.py`
- `backend/config.py`
- `backend/drive_space.py`
- `backend/main.py`
- `backend/maintenance.py`
- `backend/routes/character_parts.py`
- `backend/routes/faces.py`
- `backend/routes/files.py`
- `backend/routes/image_generation.py`
- `backend/routes/image_library.py`
- `backend/routes/image_workflows.py`
- `backend/routes/system_stats.py`
- `backend/services/character_parts/__init__.py`
- `backend/services/character_parts/analysis.py`
- `backend/services/character_parts/contracts.py`
- `backend/services/character_parts/store.py`
- `backend/services/faces/insight_onnx.py`
- `backend/services/faces/pipeline.py`
- `backend/services/faces/store.py`
- `backend/services/image_generation.py`
- `backend/services/image_generation_limits.py`
- `backend/services/image_library.py`
- `backend/services/image_workflows/adapters.py`
- `backend/services/image_workflows/contracts.py`
- `backend/services/image_workflows/runner.py`
- `backend/services/image_workflows/scene_analysis.py`
- `backend/services/knowledge_base.py`
- `backend/services/knowledge_graph.py`
- `backend/services/lora_vision.py`
- `backend/services/maintenance_gate.py`
- `backend/services/maintenance_paths.py`
- `backend/services/request_queue.py`
- `backend/services/software_specs.py`
- `backend/services/system_stats.py`
- `electron/contextMenu.js`
- `electron/driveSpace.js`
- `electron/faceFiles.js`
- `electron/filePicker.js`
- `electron/main.js`
- `electron/maintenance.js`
- `electron/maintenanceStorage.js`
- `electron/mediaManager.js`
- `electron/preload.js`
- `package-lock.json`
- `package.json`
- `requirements.lock.txt`
- `scripts/qa-chat-edit.cjs`
- `scripts/qa-chat-specs-fixture.py`
- `scripts/qa-chat-specs.cjs`
- `scripts/qa-generation-controls-fixture.py`
- `scripts/qa-generation-controls.cjs`
- `scripts/qa-image-editor-fixture.py`
- `scripts/qa-image-editor.cjs`
- `scripts/qa-image-magic-browser.js`
- `scripts/qa-knowledge-vault.cjs`
- `scripts/qa-media-manager.cjs`
- `scripts/qa_knowledge_vault.py`
- `scripts/verify-editor-detail.py`
- `src/AnalyzeIterateContext.jsx`
- `src/App.jsx`
- `src/ImageDestinations.jsx`
- `src/ImageGenerationContext.jsx`
- `src/ImagePrivacy.jsx`
- `src/alphabetical.js`
- `src/api.js`
- `src/characterParts.js`
- `src/characterPartsApi.js`
- `src/chatEdit.js`
- `src/chatImageGeneration.js`
- `src/chatImages.js`
- `src/components/AnalyzeIterate.css`
- `src/components/AppLayout.css`
- `src/components/AppLayout.jsx`
- `src/components/CharacterFocus.jsx`
- `src/components/CharacterNameDialog.jsx`
- `src/components/CharacterRegionEditor.jsx`
- `src/components/CharacterSilhouette.jsx`
- `src/components/CharacterStudio.css`
- `src/components/CharacterStudio.jsx`
- `src/components/ChatImageControls.jsx`
- `src/components/CollectionImages.jsx`
- `src/components/CustomProfileControls.jsx`
- `src/components/Dashboard.css`
- `src/components/Dashboard.jsx`
- `src/components/DashboardReset.jsx`
- `src/components/DriveFolderSizes.jsx`
- `src/components/FaceBank.jsx`
- `src/components/FaceStudio.css`
- `src/components/FaceStudio.jsx`
- `src/components/ImageBatchControls.jsx`
- `src/components/ImageEditor.css`
- `src/components/ImageEditor.jsx`
- `src/components/ImageFolderTools.jsx`
- `src/components/ImageGallery.jsx`
- `src/components/ImageGenerationHelp.jsx`
- `src/components/ImageItemActions.jsx`
- `src/components/ImageLibrary.css`
- `src/components/ImageMagic.jsx`
- `src/components/ImageRequests.jsx`
- `src/components/ImageResolutionControls.jsx`
- `src/components/ImageReview.jsx`
- `src/components/ImageSettingsControls.jsx`
- `src/components/ImageStudio.jsx`
- `src/components/ImageTagButtons.jsx`
- `src/components/ImageViewer.jsx`
- `src/components/ImageWorkflows.jsx`
- `src/components/InputBar.jsx`
- `src/components/KnowledgeGraph.jsx`
- `src/components/KnowledgeVault.css`
- `src/components/KnowledgeVault.jsx`
- `src/components/LockedImages.jsx`
- `src/components/LoraHelp.jsx`
- `src/components/LoraStudio.jsx`
- `src/components/MarkdownMessage.jsx`
- `src/components/MediaCardActions.jsx`
- `src/components/MediaManager.css`
- `src/components/MediaManager.jsx`
- `src/components/MessageList.jsx`
- `src/components/PromptIterationDialog.jsx`
- `src/components/PromptPhraseButtons.jsx`
- `src/components/PromptQueue.css`
- `src/components/PromptQueue.jsx`
- `src/components/SceneIterationDialog.jsx`
- `src/components/SceneStudio.jsx`
- `src/components/SettingsPanel.jsx`
- `src/components/Sidebar.jsx`
- `src/components/SidebarNavigation.css`
- `src/components/SidebarNavigation.jsx`
- `src/components/SoftwareSpecs.jsx`
- `src/components/WorkflowImageLibrary.jsx`
- `src/downloadBlob.js`
- `src/faceApi.js`
- `src/faceImport.js`
- `src/imageBatch.js`
- `src/imageDimensions.js`
- `src/imageEditor.js`
- `src/imageEditor.worker.js`
- `src/imageEditorColors.js`
- `src/imageEditorSession.js`
- `src/imageEditorStages.js`
- `src/imageGenerationLimits.js`
- `src/imageLibraryApi.js`
- `src/imageMagic.js`
- `src/imageSettingsControls.js`
- `src/imageWorkflow.js`
- `src/imageWorkflowApi.js`
- `src/knowledgeGraph.js`
- `src/mediaRotation.js`
- `src/navigation.js`
- `src/promptIteration.js`
- `src/promptPhrases.js`
- `src/sceneIteration.js`
- `src/softwareSpecs.js`
- `src/styles.css`
- `src/systemSpecs.js`
- `src/useStore.jsx`
- `tests/backend/test_api_smoke.py`
- `tests/backend/test_async_offloading.py`
- `tests/backend/test_backup_import.py`
- `tests/backend/test_character_parts.py`
- `tests/backend/test_config.py`
- `tests/backend/test_drive_space.py`
- `tests/backend/test_faces.py`
- `tests/backend/test_image_collections.py`
- `tests/backend/test_image_generation_cancel.py`
- `tests/backend/test_image_workflow_adapters.py`
- `tests/backend/test_image_workflows.py`
- `tests/backend/test_iterative_scenes.py`
- `tests/backend/test_knowledge_base.py`
- `tests/backend/test_knowledge_graph.py`
- `tests/backend/test_lora_vision.py`
- `tests/backend/test_maintenance.py`
- `tests/backend/test_request_queue.py`
- `tests/backend/test_scene_analysis.py`
- `tests/backend/test_software_specs.py`
- `tests/backend/test_system_stats.py`
- `tests/frontend/analyzeIterate.test.jsx`
- `tests/frontend/characterParts.test.jsx`
- `tests/frontend/chatEdit.test.js`
- `tests/frontend/chatImageGeneration.test.js`
- `tests/frontend/chatImages.test.jsx`
- `tests/frontend/contextMenu.test.js`
- `tests/frontend/dashboard.test.jsx`
- `tests/frontend/desktopMaintenance.test.js`
- `tests/frontend/driveSpace.test.jsx`
- `tests/frontend/faceDatasetLoads.test.js`
- `tests/frontend/galleryAndBulkActions.test.jsx`
- `tests/frontend/generationBatchDimensions.test.jsx`
- `tests/frontend/imageEditor.test.js`
- `tests/frontend/imageEditorDetail.test.js`
- `tests/frontend/imageEditorStages.test.js`
- `tests/frontend/imageMagic.test.js`
- `tests/frontend/imageSettings.test.js`
- `tests/frontend/knowledgeGraph.test.jsx`
- `tests/frontend/mediaManager.test.js`
- `tests/frontend/navigation.test.jsx`
- `tests/frontend/queuedEditing.test.jsx`
- `tests/frontend/systemSpecs.test.js`

</details>

### 2026-09-25T02:06:24-06:00 · 0da52d2 · Add Functions workspace, tab captures, and Generate controls

Author date: 2026-09-25T02:05:21-06:00. Commit date: 2026-09-25T02:06:24-06:00. 36 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `FUNCTIONS.md`
- `backend/main.py`
- `backend/routes/image_generation.py`
- `backend/services/image_workflows/runner.py`
- `electron/captureSnapshot.js`
- `electron/desktopFunctions.js`
- `electron/main.js`
- `electron/mediaManager.js`
- `electron/preload.js`
- `electron/refreshGraphics.ps1`
- `electron/tabCapture.js`
- `scripts/qa-functions.cjs`
- `src/App.jsx`
- `src/api.js`
- `src/chatImageGeneration.js`
- `src/chatSubmissionQueue.js`
- `src/components/AppLayout.jsx`
- `src/components/CharacterStudio.jsx`
- `src/components/ImageRequestEditor.css`
- `src/components/ImageRequestEditor.jsx`
- `src/components/ImageStudio.jsx`
- `src/components/InputBar.jsx`
- `src/components/PromptQueue.css`
- `src/components/PromptQueue.jsx`
- `src/components/Sidebar.jsx`
- `src/components/SidebarNavigation.css`
- `src/components/SidebarNavigation.jsx`
- `src/components/Tools.css`
- `src/components/Tools.jsx`
- `src/contextMemory.js`
- `src/functionButtons.js`
- `src/imageClipboard.js`
- `src/navigation.js`
- `src/queueNavigation.js`
- `tests/frontend/contextMemory.test.js`
- `tests/frontend/functions.test.js`

</details>

### 2026-09-25T11:06:59-06:00 · 7657de7 · Add adaptive Windows capabilities and graceful recovery

Author date: 2026-09-25T11:06:59-06:00. Commit date: 2026-09-25T11:06:59-06:00. 37 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `PROJECT_STATUS.md`
- `README.md`
- `WINDOWS_COMPATIBILITY.md`
- `backend/config.py`
- `backend/main.py`
- `backend/services/capabilities.py`
- `backend/services/faces/insight_onnx.py`
- `backend/services/image_generation.py`
- `backend/services/knowledge_base.py`
- `backend/services/lora_store.py`
- `backend/services/optional_dependencies.py`
- `electron/compatibility.js`
- `electron/main.js`
- `electron/preload.js`
- `electron/recovery.html`
- `requirements-core.txt`
- `requirements-faces.txt`
- `requirements-knowledge.txt`
- `scripts/check-core.py`
- `scripts/setup-windows.ps1`
- `src/App.jsx`
- `src/ImageGenerationContext.jsx`
- `src/api.js`
- `src/components/AppLayout.jsx`
- `src/components/Compatibility.jsx`
- `src/components/Dashboard.jsx`
- `src/components/LoraStudio.jsx`
- `src/components/MediaManager.jsx`
- `src/components/Tools.jsx`
- `src/modelCatalog.js`
- `src/styles.css`
- `tests/backend/test_capabilities.py`
- `tests/backend/test_compatibility.py`
- `tests/backend/test_config.py`
- `tests/frontend/compatibility.test.jsx`
- `tests/frontend/dynamicCapabilities.test.jsx`
- `tests/frontend/startupRecovery.test.js`

</details>

### 2026-09-25T12:33:04-06:00 · fea8e5b · Add paired PC bridge for durable chat and image delegation

Author date: 2026-09-25T12:33:04-06:00. Commit date: 2026-09-25T12:33:04-06:00. 15 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `PC_BRIDGE.md`
- `PROJECT_STATUS.md`
- `README.md`
- `backend/main.py`
- `backend/routes/bridge.py`
- `backend/services/bridge.py`
- `backend/services/bridge_store.py`
- `backend/services/maintenance_gate.py`
- `scripts/check-core.py`
- `src/bridgeApi.js`
- `src/components/Dashboard.jsx`
- `src/components/PCBridge.css`
- `src/components/PCBridge.jsx`
- `tests/backend/test_bridge.py`
- `tests/frontend/bridge.test.jsx`

</details>

### 2026-09-25T14:07:13-06:00 · dbdcdb0 · Harden boot, listener boundaries and PC bridge recovery

Author date: 2026-09-25T14:07:13-06:00. Commit date: 2026-09-25T14:07:13-06:00. 22 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `PC_BRIDGE.md`
- `backend/config.py`
- `backend/main.py`
- `backend/routes/bridge.py`
- `backend/services/app_logging.py`
- `backend/services/bridge.py`
- `backend/services/bridge_store.py`
- `backend/services/network_diagnostics.py`
- `electron/logger.js`
- `electron/main.js`
- `src/bridgeApi.js`
- `src/components/PCBridge.jsx`
- `src/config.js`
- `tests/backend/test_app_logging.py`
- `tests/backend/test_bridge.py`
- `tests/backend/test_config.py`
- `tests/backend/test_network_diagnostics.py`
- `tests/frontend/bridge.test.jsx`
- `tests/frontend/config.test.js`
- `tests/frontend/logger.test.js`
- `tests/frontend/sessionCredential.test.js`
- `tests/frontend/startupRecovery.test.js`

</details>

### 2026-09-25T15:55:08-06:00 · bbcd1d5 · Create Word documents in chat with local preview and downloads

Author date: 2026-09-25T15:55:01-06:00. Commit date: 2026-09-25T15:55:08-06:00. 12 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `backend/main.py`
- `backend/maintenance.py`
- `backend/routes/artifacts.py`
- `backend/services/chat_documents.py`
- `src/api.js`
- `src/components/DocumentViewer.jsx`
- `src/components/InputBar.jsx`
- `src/components/MessageList.jsx`
- `src/contextMemory.js`
- `src/styles.css`
- `tests/backend/test_chat_documents.py`
- `tests/frontend/documents.test.jsx`

</details>

### 2026-09-25T16:54:14-06:00 · 09d1e59 · Support clipboard screenshot attachments in chat

Author date: 2026-09-25T16:54:01-06:00. Commit date: 2026-09-25T16:54:14-06:00. 4 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `src/chatClipboard.js`
- `src/components/InputBar.jsx`
- `src/useChatUploads.js`
- `tests/frontend/chatClipboard.test.jsx`

</details>

### 2026-09-25T20:20:37-06:00 · a84d295 · Bundle the complete Media Manager with private local storage

Author date: 2026-09-25T20:20:37-06:00. Commit date: 2026-09-25T20:20:37-06:00. 82 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `.gitignore`
- `MEDIA_MANAGER.md`
- `README.md`
- `electron/compatibility.js`
- `electron/main.js`
- `electron/mediaManager.js`
- `electron/mediaManagerPaths.js`
- `media-manager/README.md`
- `media-manager/frontend/actions.js`
- `media-manager/frontend/adapter.js`
- `media-manager/frontend/captures.js`
- `media-manager/frontend/folder-picker.js`
- `media-manager/frontend/image-tools.js`
- `media-manager/frontend/index.html`
- `media-manager/frontend/library.js`
- `media-manager/frontend/organizer.css`
- `media-manager/frontend/organizer.js`
- `media-manager/frontend/playback.js`
- `media-manager/media_organizer/__init__.py`
- `media-manager/media_organizer/__main__.py`
- `media-manager/media_organizer/captures.py`
- `media-manager/media_organizer/catalog.py`
- `media-manager/media_organizer/classify.py`
- `media-manager/media_organizer/cli.py`
- `media-manager/media_organizer/constants.py`
- `media-manager/media_organizer/custom_folders.py`
- `media-manager/media_organizer/dates.py`
- `media-manager/media_organizer/folder_browser.py`
- `media-manager/media_organizer/frames.py`
- `media-manager/media_organizer/hashing.py`
- `media-manager/media_organizer/image_tools.py`
- `media-manager/media_organizer/manifest.py`
- `media-manager/media_organizer/media_actions.py`
- `media-manager/media_organizer/metadata.py`
- `media-manager/media_organizer/mover.py`
- `media-manager/media_organizer/mp4box.py`
- `media-manager/media_organizer/names.py`
- `media-manager/media_organizer/planner.py`
- `media-manager/media_organizer/progress.py`
- `media-manager/media_organizer/report.py`
- `media-manager/media_organizer/scan.py`
- `media-manager/media_organizer/scanner.py`
- `media-manager/media_organizer/snapshot.py`
- `media-manager/media_organizer/thumbnails.py`
- `media-manager/media_organizer/tools.py`
- `media-manager/media_organizer/ui_server.py`
- `media-manager/media_organizer/winfs.py`
- `media-manager/package.json`
- `media-manager/tests/__init__.py`
- `media-manager/tests/library.test.mjs`
- `media-manager/tests/mp4build.py`
- `media-manager/tests/playback.test.mjs`
- `media-manager/tests/test_captures.py`
- `media-manager/tests/test_catalog.py`
- `media-manager/tests/test_classify.py`
- `media-manager/tests/test_custom_folders.py`
- `media-manager/tests/test_dates.py`
- `media-manager/tests/test_desktop_bridge.py`
- `media-manager/tests/test_frames.py`
- `media-manager/tests/test_image_tools.py`
- `media-manager/tests/test_job_progress.py`
- `media-manager/tests/test_media_actions.py`
- `media-manager/tests/test_mp4box.py`
- `media-manager/tests/test_planner_mover.py`
- `media-manager/tests/test_thumbnails.py`
- `media-manager/tests/test_ui_server.py`
- `media-manager/tests/test_workflow.py`
- `media-manager/tests/ui_browser_test.mjs`
- `media-manager/tests/ui_captures_folders_test.mjs`
- `media-manager/tests/ui_catalog_test.mjs`
- `media-manager/tests/ui_custom_folders_test.mjs`
- `media-manager/tests/ui_duplicates_test.mjs`
- `media-manager/tests/ui_extended_media_test.mjs`
- `media-manager/tests/ui_fixture_server.py`
- `media-manager/tests/ui_image_tools_test.mjs`
- `media-manager/tests/ui_media_actions_test.mjs`
- `media-manager/tests/ui_playback_test.mjs`
- `package.json`
- `scripts/qa-media-manager.cjs`
- `scripts/test-media-manager.cjs`
- `src/components/MediaManager.jsx`
- `tests/frontend/mediaManager.test.js`

</details>

### 2026-09-25T20:36:43-06:00 · b506010 · Add local workspace tools and protect converted image privacy

Author date: 2026-09-25T20:36:43-06:00. Commit date: 2026-09-25T20:36:43-06:00. 56 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `FUNCTIONS.md`
- `backend/main.py`
- `backend/routes/workspaces.py`
- `backend/services/chat_canvas.py`
- `backend/services/faces/pipeline.py`
- `backend/services/image_conversion.py`
- `backend/services/image_library.py`
- `backend/services/image_workflows/exports.py`
- `backend/services/knowledge_base.py`
- `electron/compatibility.js`
- `electron/desktopFunctions.js`
- `electron/main.js`
- `electron/preload.js`
- `electron/programLaunchers.js`
- `electron/security.js`
- `electron/tabCapture.js`
- `electron/windowsPrograms.js`
- `scripts/qa-workspace-launchers.cjs`
- `scripts/qa-workspaces.cjs`
- `src/App.jsx`
- `src/api.js`
- `src/canvasDrawing.js`
- `src/canvasStore.js`
- `src/codePreview.js`
- `src/components/AppLayout.jsx`
- `src/components/CanvasWorkspace.jsx`
- `src/components/CodeViewer.jsx`
- `src/components/Dashboard.jsx`
- `src/components/FileConverter.jsx`
- `src/components/Header.jsx`
- `src/components/InputBar.jsx`
- `src/components/KnowledgeContext.jsx`
- `src/components/KnowledgeVault.jsx`
- `src/components/MessageList.jsx`
- `src/components/ModelOrder.jsx`
- `src/components/SidebarNavigation.jsx`
- `src/components/SpreadsheetViewer.jsx`
- `src/components/Tools.css`
- `src/components/Tools.jsx`
- `src/csv.js`
- `src/functionButtons.js`
- `src/index.html`
- `src/modelOrder.js`
- `src/navigation.js`
- `src/preferences.js`
- `src/useStore.jsx`
- `src/workspaceContext.js`
- `tests/backend/test_faces.py`
- `tests/backend/test_image_collections.py`
- `tests/backend/test_workflow_exports.py`
- `tests/backend/test_workspace_tools.py`
- `tests/frontend/csv-canvas.test.js`
- `tests/frontend/functions.test.js`
- `tests/frontend/knowledge-context.test.jsx`
- `tests/frontend/program-launchers.test.js`
- `tests/frontend/workspace-tools.test.js`

</details>

### 2026-09-25T20:44:37-06:00 · a639dca · Fix image generation rejecting queue session metadata

Author date: 2026-09-25T20:44:37-06:00. Commit date: 2026-09-25T20:44:37-06:00. 2 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `backend/routes/image_generation.py`
- `tests/backend/test_image_generation_cancel.py`

</details>

### 2026-09-28T02:23:52-06:00 · d8b5247 · Add local audio recording, transcription, and voice cloning

Author date: 2026-09-28T02:23:52-06:00. Commit date: 2026-09-28T02:23:52-06:00. 44 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `AUDIO.md`
- `README.md`
- `backend/main.py`
- `backend/routes/audio.py`
- `backend/routes/voice_cloning.py`
- `backend/services/audio.py`
- `backend/services/audio_acceleration.py`
- `backend/services/speaker_diarization.py`
- `backend/services/speaker_worker.py`
- `backend/services/voice_cloning.py`
- `backend/services/voice_worker.py`
- `electron/audioPermissions.js`
- `electron/main.js`
- `electron/tabCapture.js`
- `requirements-audio.txt`
- `scripts/benchmark-audio-accuracy.py`
- `scripts/install-voice-models.ps1`
- `scripts/qa-audio-upload.cjs`
- `scripts/qa-audio.cjs`
- `scripts/qa-voice-cloning.cjs`
- `scripts/qa-voice-recording.cjs`
- `src/App.jsx`
- `src/audio.js`
- `src/audioSpeech.js`
- `src/components/AppLayout.jsx`
- `src/components/AudioWorkspace.css`
- `src/components/AudioWorkspace.jsx`
- `src/components/InputBar.jsx`
- `src/components/MessageList.jsx`
- `src/components/SidebarNavigation.jsx`
- `src/components/VoiceCloningPanel.jsx`
- `src/functionButtons.js`
- `src/navigation.js`
- `src/voiceCloning.js`
- `tests/backend/test_audio.py`
- `tests/backend/test_audio_acceleration.py`
- `tests/backend/test_speaker_diarization.py`
- `tests/backend/test_voice_cloning.py`
- `tests/fixtures/audio.config.mjs`
- `tests/fixtures/audio.html`
- `tests/fixtures/audio.jsx`
- `tests/fixtures/audio_backend.py`
- `tests/frontend/audio.test.js`
- `tests/frontend/voiceCloning.test.js`

</details>

### 2026-09-28T22:51:26-06:00 · de4dd46 · Expand character, audio, and media workspaces

Author date: 2026-09-28T22:51:26-06:00. Commit date: 2026-09-28T22:51:26-06:00. 227 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `AUDIO.md`
- `CHARACTERS.md`
- `CHAT_IMAGE_GENERATION.md`
- `INTERNET_ACCESS_PROPOSAL.md`
- `KNOWLEDGE_VAULT.md`
- `PROJECT_STATUS.md`
- `README.md`
- `backend/main.py`
- `backend/routes/audio.py`
- `backend/routes/audio_extraction.py`
- `backend/routes/faces.py`
- `backend/routes/image_generation.py`
- `backend/routes/request_queue.py`
- `backend/routes/web.py`
- `backend/routes/workspaces.py`
- `backend/services/audio_extraction.py`
- `backend/services/character_resources.py`
- `backend/services/chat_canvas.py`
- `backend/services/chat_documents.py`
- `backend/services/chat_influences.py`
- `backend/services/faces/bank.py`
- `backend/services/file_packager.py`
- `backend/services/gif_maker.py`
- `backend/services/image_generation.py`
- `backend/services/image_generation_limits.py`
- `backend/services/image_library.py`
- `backend/services/image_tasks.py`
- `backend/services/image_workflows/adapters.py`
- `backend/services/image_workflows/contracts.py`
- `backend/services/image_workflows/scene_state.py`
- `backend/services/request_queue.py`
- `backend/services/session_store.py`
- `backend/services/web_access.py`
- `electron/browserPolicy.js`
- `electron/gifFiles.js`
- `electron/main.js`
- `electron/outputFolder.js`
- `electron/preload.js`
- `electron/tabCapture.js`
- `electron/viewerBrowser.js`
- `media-manager/frontend/captures.js`
- `media-manager/frontend/library.js`
- `media-manager/frontend/organizer.css`
- `media-manager/frontend/organizer.js`
- `media-manager/tests/library.test.mjs`
- `media-manager/tests/test_catalog.py`
- `media-manager/tests/ui_duplicates_test.mjs`
- `package-lock.json`
- `scripts/qa-audio-extraction.cjs`
- `scripts/qa-audio-upload.cjs`
- `scripts/qa-character-workspace.cjs`
- `scripts/qa-chat-influences.cjs`
- `scripts/qa-generation-runtime.py`
- `scripts/qa-viewer-browser.cjs`
- `scripts/qa_character_workspace.py`
- `scripts/qa_chat_influences.py`
- `src/App.jsx`
- `src/CharacterWorkspace.jsx`
- `src/ImageDestinations.jsx`
- `src/ImageGenerationContext.jsx`
- `src/api.js`
- `src/audioExtraction.js`
- `src/characterKnowledge.js`
- `src/characterResources.js`
- `src/chatImageGeneration.js`
- `src/chatImages.js`
- `src/chatInfluences.js`
- `src/components/AppLayout.jsx`
- `src/components/AudioExtractor.jsx`
- `src/components/AudioWorkspace.css`
- `src/components/AudioWorkspace.jsx`
- `src/components/CharacterCreator.css`
- `src/components/CharacterCreator.jsx`
- `src/components/CharacterFileButton.jsx`
- `src/components/CharacterResources.jsx`
- `src/components/CharacterStudio.jsx`
- `src/components/ChatComposer.css`
- `src/components/ChatImageControls.jsx`
- `src/components/ChatInfluences.css`
- `src/components/ChatInfluences.jsx`
- `src/components/CodeViewer.jsx`
- `src/components/CollectionImages.jsx`
- `src/components/FaceBank.jsx`
- `src/components/FaceStudio.jsx`
- `src/components/FileConverter.jsx`
- `src/components/FilePackager.css`
- `src/components/FilePackager.jsx`
- `src/components/GeneratedImagePreview.jsx`
- `src/components/GifFrameThumbnail.jsx`
- `src/components/GifMaker.css`
- `src/components/GifMaker.jsx`
- `src/components/GifOutputFolder.jsx`
- `src/components/GifPlayer.jsx`
- `src/components/GifSaveActions.jsx`
- `src/components/Header.jsx`
- `src/components/ImageBatchOutput.jsx`
- `src/components/ImageEditor.jsx`
- `src/components/ImageFolderTools.jsx`
- `src/components/ImageGallery.jsx`
- `src/components/ImageGenerationHelp.jsx`
- `src/components/ImageGenerationProgress.jsx`
- `src/components/ImageGenerationSizing.jsx`
- `src/components/ImageGenerationStatus.jsx`
- `src/components/ImageLibrary.css`
- `src/components/ImageMagic.jsx`
- `src/components/ImageOutputFolder.jsx`
- `src/components/ImageRemovalControls.css`
- `src/components/ImageRemovalControls.jsx`
- `src/components/ImageRequestEditor.jsx`
- `src/components/ImageRequests.jsx`
- `src/components/ImageResolutionControls.jsx`
- `src/components/ImageSeedControls.css`
- `src/components/ImageSeedControls.jsx`
- `src/components/ImageSettingsControls.jsx`
- `src/components/ImageStudio.css`
- `src/components/ImageStudio.jsx`
- `src/components/ImageViewer.jsx`
- `src/components/ImageWorkflows.jsx`
- `src/components/InputBar.jsx`
- `src/components/KnowledgeCharacters.jsx`
- `src/components/KnowledgeVault.css`
- `src/components/KnowledgeVault.jsx`
- `src/components/LockedImages.jsx`
- `src/components/MessageList.jsx`
- `src/components/PromptIndex.jsx`
- `src/components/PromptQueue.css`
- `src/components/PromptQueue.jsx`
- `src/components/SaveImagePrompts.css`
- `src/components/SaveImagePrompts.jsx`
- `src/components/SceneStudio.jsx`
- `src/components/SettingsPanel.jsx`
- `src/components/SidebarNavigation.jsx`
- `src/components/ViewerBrowser.css`
- `src/components/ViewerBrowser.jsx`
- `src/components/VoiceCloningPanel.jsx`
- `src/components/WebAccess.css`
- `src/components/WebAccess.jsx`
- `src/components/WebImageReader.css`
- `src/components/WebImageReader.jsx`
- `src/components/WorkflowImageLibrary.jsx`
- `src/components/WorkflowRunPanel.jsx`
- `src/filePackager.js`
- `src/functionButtons.js`
- `src/generationHistory.js`
- `src/gifMaker.js`
- `src/gifThumbnailCache.js`
- `src/imageGenerationLimits.js`
- `src/imageMagic.js`
- `src/imageProgress.js`
- `src/imagePromptIndex.js`
- `src/imageSeed.js`
- `src/imageTaskState.js`
- `src/imageWorkflow.js`
- `src/index.html`
- `src/navigation.js`
- `src/preferences.js`
- `src/queueNavigation.js`
- `src/queueTiming.js`
- `src/roleplayPrompt.js`
- `src/styles.css`
- `src/useChatUploads.js`
- `src/useGifThumbnails.js`
- `src/useStore.jsx`
- `src/voiceReferencePhrases.js`
- `src/webAccess.js`
- `tests/backend/test_audio_extraction.py`
- `tests/backend/test_character_resources.py`
- `tests/backend/test_chat_documents.py`
- `tests/backend/test_chat_influences.py`
- `tests/backend/test_file_packager.py`
- `tests/backend/test_generation_overlap.py`
- `tests/backend/test_gif_maker.py`
- `tests/backend/test_image_collections.py`
- `tests/backend/test_image_generation_cancel.py`
- `tests/backend/test_image_output_folder.py`
- `tests/backend/test_image_resolution_limits.py`
- `tests/backend/test_image_tasks.py`
- `tests/backend/test_image_workflow_adapters.py`
- `tests/backend/test_image_workflows.py`
- `tests/backend/test_prompt_index_store.py`
- `tests/backend/test_request_queue.py`
- `tests/backend/test_web_images.py`
- `tests/fixtures/chatComposer.config.mjs`
- `tests/fixtures/chatComposer.html`
- `tests/fixtures/chatComposer.jsx`
- `tests/fixtures/chatComposer.md`
- `tests/fixtures/generatePreview.config.mjs`
- `tests/fixtures/generatePreview.html`
- `tests/fixtures/generatePreview.jsx`
- `tests/fixtures/generatePreview.md`
- `tests/fixtures/generatePreview.svg`
- `tests/fixtures/generationPersistence.html`
- `tests/fixtures/generationPersistence.jsx`
- `tests/fixtures/generationPersistence.md`
- `tests/fixtures/generationPersistence.py`
- `tests/fixtures/imageRemoval.config.mjs`
- `tests/fixtures/imageRemoval.html`
- `tests/fixtures/imageRemoval.jsx`
- `tests/fixtures/imageRemoval.md`
- `tests/fixtures/viewerBrowser.html`
- `tests/fixtures/viewerBrowser.jsx`
- `tests/frontend/audioExtraction.test.js`
- `tests/frontend/characterKnowledge.test.js`
- `tests/frontend/chatImageGeneration.test.js`
- `tests/frontend/chatImages.test.jsx`
- `tests/frontend/chatInfluences.test.jsx`
- `tests/frontend/filePackager.test.js`
- `tests/frontend/functions.test.js`
- `tests/frontend/generationHistory.test.js`
- `tests/frontend/gifFiles.test.js`
- `tests/frontend/gifMaker.test.js`
- `tests/frontend/gifOutputFolder.test.jsx`
- `tests/frontend/gifThumbnailCache.test.js`
- `tests/frontend/imageBatchOutput.test.jsx`
- `tests/frontend/imageGenerationSizing.test.jsx`
- `tests/frontend/imageMagic.test.js`
- `tests/frontend/imageOutputFolder.test.jsx`
- `tests/frontend/imageProgress.test.js`
- `tests/frontend/imagePromptIndex.test.js`
- `tests/frontend/imageSeed.test.jsx`
- `tests/frontend/imageTaskState.test.js`
- `tests/frontend/imageWorkflow.test.js`
- `tests/frontend/lockImageDialog.test.jsx`
- `tests/frontend/queueTiming.test.jsx`
- `tests/frontend/taskProgress.test.jsx`
- `tests/frontend/viewerBrowser.test.jsx`
- `tests/frontend/webAccess.test.js`

</details>

### 2026-10-02T10:43:47-06:00 · 8c01ac0 · Improve chat reliability, Knowledge editing, and workspace tools

Author date: 2026-10-02T10:43:47-06:00. Commit date: 2026-10-02T10:43:47-06:00. 207 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `.gitignore`
- `AUDIO.md`
- `CHARACTERS.md`
- `CHAT_IMAGE_GENERATION.md`
- `KNOWLEDGE_VAULT.md`
- `PROJECT_STATUS.md`
- `README.md`
- `RELEASES.md`
- `TOOL_REGISTRY.md`
- `backend/main.py`
- `backend/routes/bridge.py`
- `backend/routes/faces.py`
- `backend/routes/files.py`
- `backend/routes/image_generation.py`
- `backend/routes/request_queue.py`
- `backend/routes/sessions.py`
- `backend/routes/system_stats.py`
- `backend/routes/tool_registry.py`
- `backend/routes/voice_cloning.py`
- `backend/services/build_info.py`
- `backend/services/character_resources.py`
- `backend/services/chat_checklists.py`
- `backend/services/conditional_status.py`
- `backend/services/ernie_image.py`
- `backend/services/generation_reference.py`
- `backend/services/image_generation.py`
- `backend/services/image_tasks.py`
- `backend/services/image_workflows/adapters.py`
- `backend/services/image_workflows/contracts.py`
- `backend/services/image_workflows/reference_analysis.py`
- `backend/services/knowledge_graph.py`
- `backend/services/knowledge_node_options.py`
- `backend/services/knowledge_notes.py`
- `backend/services/lora_store.py`
- `backend/services/lora_worker.py`
- `backend/services/session_store.py`
- `backend/services/software_specs.py`
- `backend/services/tool_catalog.py`
- `backend/services/tool_registry.py`
- `backend/services/voice_cloning.py`
- `docs/application-review/README.md`
- `docs/application-review/benchmarks/session-metadata.json`
- `docs/application-review/changes/R01-build-identity.md`
- `docs/application-review/changes/R02-session-metadata.md`
- `docs/application-review/changes/R03-session-revisions.md`
- `docs/application-review/reader-template.html`
- `docs/application-review/review.json`
- `electron/buildInfo.js`
- `electron/captureSnapshot.js`
- `electron/main.js`
- `electron/tabCapture.js`
- `package-lock.json`
- `package.json`
- `requirements-ernie.txt`
- `scripts/benchmark-session-metadata.py`
- `scripts/capture-app-review.py`
- `scripts/prepare-build.cjs`
- `scripts/qa-chat-checklists.cjs`
- `scripts/qa-chat-speech.cjs`
- `scripts/qa-generate-reference.cjs`
- `scripts/qa-generate-reference.py`
- `scripts/qa-knowledge-vault.cjs`
- `scripts/qa_chat_checklists.py`
- `scripts/qa_chat_speech.py`
- `scripts/qa_knowledge_vault.py`
- `src/App.jsx`
- `src/CharacterWorkspace.jsx`
- `src/ChatWorkspace.jsx`
- `src/ImageDestinations.jsx`
- `src/ImageGenerationContext.jsx`
- `src/api.js`
- `src/appPolling.js`
- `src/audioSpeech.js`
- `src/buildIdentity.js`
- `src/characterResources.js`
- `src/chatImageGeneration.js`
- `src/chatPins.js`
- `src/chatSpeech.js`
- `src/components/AppLayout.css`
- `src/components/AppLayout.jsx`
- `src/components/AudioWorkspace.css`
- `src/components/CharacterLinks.css`
- `src/components/CharacterLinks.jsx`
- `src/components/CharacterStudio.jsx`
- `src/components/ChatChecklistEditor.jsx`
- `src/components/ChatImageControls.jsx`
- `src/components/ChatMessageMarkdown.jsx`
- `src/components/ChatSideContent.jsx`
- `src/components/ChatSpeak.jsx`
- `src/components/ChatWorkspace.css`
- `src/components/Dashboard.css`
- `src/components/Dashboard.jsx`
- `src/components/DocumentViewer.jsx`
- `src/components/FaceStudio.jsx`
- `src/components/GenerateReference.jsx`
- `src/components/GeneratedImagePreview.jsx`
- `src/components/Header.jsx`
- `src/components/ImageBatchOutput.jsx`
- `src/components/ImageGenerationHelp.jsx`
- `src/components/ImageGenerationProgress.jsx`
- `src/components/ImageItemActions.jsx`
- `src/components/ImageRequestEditor.jsx`
- `src/components/ImageSettingsControls.jsx`
- `src/components/ImageStudio.css`
- `src/components/ImageStudio.jsx`
- `src/components/ImageViewer.jsx`
- `src/components/InputBar.jsx`
- `src/components/KnowledgeGraph.jsx`
- `src/components/KnowledgeNodeComposer.jsx`
- `src/components/KnowledgeNodeEditor.jsx`
- `src/components/KnowledgeNodeSymbol.jsx`
- `src/components/KnowledgeVault.css`
- `src/components/KnowledgeVault.jsx`
- `src/components/LoraStudio.jsx`
- `src/components/MarkdownMessage.jsx`
- `src/components/MessageList.jsx`
- `src/components/PCBridge.jsx`
- `src/components/PromptQueue.jsx`
- `src/components/ReferenceAnalysis.jsx`
- `src/components/ResizableDivider.jsx`
- `src/components/SettingsPanel.jsx`
- `src/components/ShortcutRegistry.css`
- `src/components/ShortcutRegistry.jsx`
- `src/components/Sidebar.jsx`
- `src/components/SidebarNavigation.jsx`
- `src/components/SoftwareSpecs.jsx`
- `src/components/ToolRegistry.css`
- `src/components/ToolRegistry.jsx`
- `src/components/VoiceCloningPanel.jsx`
- `src/components/VoiceOutputSettings.jsx`
- `src/components/WorkflowRunPanel.jsx`
- `src/functionButtons.js`
- `src/generationHistory.js`
- `src/generationReference.js`
- `src/knowledgeGraph3D.js`
- `src/knowledgeNodeOptions.js`
- `src/knowledgeNodes.js`
- `src/markdownTasks.js`
- `src/navigation.js`
- `src/polling.js`
- `src/pollingPolicies.js`
- `src/preferences.js`
- `src/sessionPersistence.js`
- `src/shortcutRegistry.js`
- `src/softwareSpecs.js`
- `src/styles.css`
- `src/toolRegistry.js`
- `src/useChatUploads.js`
- `src/useStore.jsx`
- `src/useTaskProgress.js`
- `src/voiceCloning.js`
- `src/webAccess.js`
- `src/workspaceContext.js`
- `src/workspaceLayout.js`
- `tests/backend/test_api_smoke.py`
- `tests/backend/test_bridge.py`
- `tests/backend/test_build_identity.py`
- `tests/backend/test_bulk_deletion_safety.py`
- `tests/backend/test_character_links.py`
- `tests/backend/test_chat_checklists.py`
- `tests/backend/test_chat_influences.py`
- `tests/backend/test_ernie_image_generation.py`
- `tests/backend/test_generation_reference.py`
- `tests/backend/test_image_collections.py`
- `tests/backend/test_image_store.py`
- `tests/backend/test_image_workflow_adapters.py`
- `tests/backend/test_knowledge_graph.py`
- `tests/backend/test_knowledge_notes.py`
- `tests/backend/test_queue_session_results.py`
- `tests/backend/test_session_metadata.py`
- `tests/backend/test_session_revisions.py`
- `tests/backend/test_session_store.py`
- `tests/backend/test_tool_registry.py`
- `tests/backend/test_voice_cloning.py`
- `tests/backend/test_web_images.py`
- `tests/fixtures/chatChecklist.jsx`
- `tests/fixtures/generatePreview.jsx`
- `tests/fixtures/generateReference.config.mjs`
- `tests/fixtures/generateReference.html`
- `tests/fixtures/generateReference.jsx`
- `tests/fixtures/shortcutRegistry.config.mjs`
- `tests/fixtures/shortcutRegistry.html`
- `tests/fixtures/shortcutRegistry.jsx`
- `tests/fixtures/shortcutRegistryFull.html`
- `tests/fixtures/shortcutRegistryFull.jsx`
- `tests/fixtures/toolRegistry.config.mjs`
- `tests/fixtures/toolRegistry.html`
- `tests/fixtures/toolRegistry.jsx`
- `tests/frontend/buildIdentity.test.js`
- `tests/frontend/characterLinks.test.jsx`
- `tests/frontend/chatChecklists.test.jsx`
- `tests/frontend/chatPins.test.jsx`
- `tests/frontend/chatSpeech.test.js`
- `tests/frontend/ernieImageGeneration.test.js`
- `tests/frontend/generationHistory.test.js`
- `tests/frontend/generationReference.test.jsx`
- `tests/frontend/imageBatchOutput.test.jsx`
- `tests/frontend/knowledgeGraph.test.jsx`
- `tests/frontend/knowledgeGraph3D.test.js`
- `tests/frontend/knowledgeNodes.test.jsx`
- `tests/frontend/sessionImageInventory.test.js`
- `tests/frontend/sessionRevisions.test.jsx`
- `tests/frontend/shortcutRegistry.test.jsx`
- `tests/frontend/toolRegistry.test.jsx`
- `tests/frontend/webAccess.test.js`
- `tests/frontend/workspaceLayout.test.jsx`
- `vite.config.mjs`

</details>

### 2026-10-02T17:59:21-06:00 · 5a2cc37 · Add document and 3D editors with workspace and media updates

Author date: 2026-10-02T17:59:21-06:00. Commit date: 2026-10-02T17:59:21-06:00. 554 in-scope changed paths.

<details><summary>Changed source/document paths</summary>

- `APPLICATION_AWARENESS.md`
- `ARCHITECTURE.md`
- `DOCUMENT_EDITOR.md`
- `DUAL_CHAT.md`
- `FOLDER_REVIEW.md`
- `FUNCTIONS.md`
- `GITHUB_PUBLICATION.md`
- `IMAGE_MANAGER.md`
- `KNOWLEDGE_VAULT.md`
- `MEDIA_MANAGER.md`
- `PROJECT_STATUS.md`
- `README.md`
- `RELEASES.md`
- `ROADMAP_SEGMENTS_4_6.md`
- `VISUAL_REVIEW.md`
- `WINDOW_RENDERING.md`
- `backend/backup_import.py`
- `backend/main.py`
- `backend/maintenance.py`
- `backend/routes/document_editor.py`
- `backend/routes/faces.py`
- `backend/routes/folder_review.py`
- `backend/routes/hash_auditor.py`
- `backend/routes/image_generation.py`
- `backend/routes/image_library.py`
- `backend/routes/image_manager.py`
- `backend/routes/image_workflows.py`
- `backend/routes/local_files.py`
- `backend/routes/lora.py`
- `backend/routes/prompt_index.py`
- `backend/routes/sessions.py`
- `backend/routes/storage_libraries.py`
- `backend/routes/system_stats.py`
- `backend/routes/visual_review.py`
- `backend/routes/web.py`
- `backend/routes/workspaces.py`
- `backend/services/app_updates.py`
- `backend/services/character_parts/analysis.py`
- `backend/services/character_parts/store.py`
- `backend/services/character_resources.py`
- `backend/services/chat_canvas.py`
- `backend/services/chat_checklists.py`
- `backend/services/chat_documents.py`
- `backend/services/chat_influences.py`
- `backend/services/chat_model_runtime.py`
- `backend/services/context_awareness.py`
- `backend/services/dependency_management.py`
- `backend/services/desktop_control.py`
- `backend/services/document_editor.py`
- `backend/services/environment_awareness.py`
- `backend/services/faces/store.py`
- `backend/services/file_handlers.py`
- `backend/services/folder_review.py`
- `backend/services/folder_review_reader.py`
- `backend/services/hash_auditor.py`
- `backend/services/image_conversion.py`
- `backend/services/image_generation.py`
- `backend/services/image_library.py`
- `backend/services/image_manager.py`
- `backend/services/image_manager_tools.py`
- `backend/services/image_manager_trash.py`
- `backend/services/image_store.py`
- `backend/services/image_thumbnails.py`
- `backend/services/image_vault.py`
- `backend/services/image_workflows/deletion.py`
- `backend/services/image_workflows/exports.py`
- `backend/services/image_workflows/runner.py`
- `backend/services/image_workflows/store.py`
- `backend/services/index_knowledge_links.py`
- `backend/services/knowledge_graph.py`
- `backend/services/local_database.py`
- `backend/services/local_documents.py`
- `backend/services/local_files.py`
- `backend/services/local_video.py`
- `backend/services/maintenance_gate.py`
- `backend/services/prompt_index_store.py`
- `backend/services/request_queue.py`
- `backend/services/review_metadata.py`
- `backend/services/session_guard.py`
- `backend/services/session_store.py`
- `backend/services/storage_libraries.py`
- `backend/services/thinking_trace.py`
- `backend/services/tool_catalog.py`
- `backend/services/video_analysis.py`
- `backend/services/visual_classification.py`
- `backend/services/visual_review.py`
- `docs/application-review/review.json`
- `electron/appShutdown.js`
- `electron/audioPermissions.js`
- `electron/browserSession.js`
- `electron/captureSnapshot.js`
- `electron/dependencyMaintenance.js`
- `electron/filePicker.js`
- `electron/functionAudit.js`
- `electron/functionAutomation.js`
- `electron/functionAutomation.ps1`
- `electron/functionWorkflows.js`
- `electron/gifFiles.js`
- `electron/githubPublisher.js`
- `electron/localFiles.js`
- `electron/logger.js`
- `electron/main.js`
- `electron/maintenance.js`
- `electron/mediaManager.js`
- `electron/meshRepair.js`
- `electron/modelEditor.js`
- `electron/preload.js`
- `electron/redactSecrets.js`
- `electron/repair3D.ps1`
- `electron/security.js`
- `electron/tabCapture.js`
- `electron/viewerBrowser.js`
- `electron/windowRendering.js`
- `media-manager/README.md`
- `media-manager/frontend/actions.js`
- `media-manager/frontend/adapter.js`
- `media-manager/frontend/captures.js`
- `media-manager/frontend/folder-picker.js`
- `media-manager/frontend/image-tools.js`
- `media-manager/frontend/organizer.css`
- `media-manager/frontend/organizer.js`
- `media-manager/frontend/popup-dismissal.js`
- `media-manager/frontend/review.js`
- `media-manager/frontend/selection.js`
- `media-manager/media_organizer/image_tools.py`
- `media-manager/media_organizer/media_actions.py`
- `media-manager/media_organizer/review.py`
- `media-manager/media_organizer/thumbnails.py`
- `media-manager/media_organizer/ui_server.py`
- `media-manager/tests/test_custom_folders.py`
- `media-manager/tests/test_image_tools.py`
- `media-manager/tests/test_media_actions.py`
- `media-manager/tests/test_review.py`
- `media-manager/tests/test_thumbnails.py`
- `media-manager/tests/test_ui_server.py`
- `media-manager/tests/ui_browser_test.mjs`
- `media-manager/tests/ui_button_confirmations_test.mjs`
- `media-manager/tests/ui_catalog_test.mjs`
- `media-manager/tests/ui_custom_folders_test.mjs`
- `media-manager/tests/ui_extended_media_test.mjs`
- `media-manager/tests/ui_image_tools_test.mjs`
- `media-manager/tests/ui_media_actions_test.mjs`
- `package-lock.json`
- `package.json`
- `scripts/build-local-files-qa.mjs`
- `scripts/build-model-editor-qa.mjs`
- `scripts/build-viewer-qa.mjs`
- `scripts/copy-3dbuilder-package.ps1`
- `scripts/publish-github.py`
- `scripts/qa-browser-persistence.cjs`
- `scripts/qa-browser-profile.cjs`
- `scripts/qa-chat-checklists.cjs`
- `scripts/qa-document-editor.mjs`
- `scripts/qa-dual-chat.cjs`
- `scripts/qa-face-names.cjs`
- `scripts/qa-function-sequences.cjs`
- `scripts/qa-function-window.cjs`
- `scripts/qa-function-window.ps1`
- `scripts/qa-image-manager-fixture.py`
- `scripts/qa-image-manager-tags.cjs`
- `scripts/qa-image-manager.cjs`
- `scripts/qa-index-knowledge.cjs`
- `scripts/qa-local-files.cjs`
- `scripts/qa-manager-deletion.cjs`
- `scripts/qa-media-manager.cjs`
- `scripts/qa-model-editor.cjs`
- `scripts/qa-model-repair.cjs`
- `scripts/qa-model-viewer.cjs`
- `scripts/qa-review-tags.cjs`
- `scripts/qa-video-analysis.py`
- `scripts/qa-viewer-browser.cjs`
- `scripts/qa-window-rendering.cjs`
- `scripts/qa-workspace-information.cjs`
- `scripts/qa_document_editor.py`
- `scripts/qa_dual_chat.py`
- `scripts/qa_index_knowledge.py`
- `src/App.jsx`
- `src/ChatPane.jsx`
- `src/ChatWorkspace.jsx`
- `src/ImagePrivacy.jsx`
- `src/api.js`
- `src/appearance.js`
- `src/applicationAwareness.js`
- `src/assets/application-icons/README.md`
- `src/assets/application-icons/access.svg`
- `src/assets/application-icons/excel.svg`
- `src/assets/application-icons/onedrive.svg`
- `src/assets/application-icons/onenote.svg`
- `src/assets/application-icons/outlook.svg`
- `src/assets/application-icons/powerpoint.svg`
- `src/assets/application-icons/teams.svg`
- `src/assets/application-icons/word.svg`
- `src/chatActivity.js`
- `src/chatImages.js`
- `src/chatInfluences.js`
- `src/chatModelChoices.js`
- `src/chatPins.js`
- `src/chatSubmissionQueue.js`
- `src/components/AppLayout.jsx`
- `src/components/AppearanceSettings.css`
- `src/components/AppearanceSettings.jsx`
- `src/components/ApplicationMaintenance.css`
- `src/components/ApplicationMaintenance.jsx`
- `src/components/AudioExtractor.jsx`
- `src/components/AudioWorkspace.css`
- `src/components/AudioWorkspace.jsx`
- `src/components/BulkActions.jsx`
- `src/components/CanvasWorkspace.jsx`
- `src/components/CharacterCreator.jsx`
- `src/components/CharacterFocus.jsx`
- `src/components/CharacterLinks.jsx`
- `src/components/CharacterRegionEditor.jsx`
- `src/components/CharacterResources.jsx`
- `src/components/CharacterSilhouette.jsx`
- `src/components/CharacterStudio.jsx`
- `src/components/ChatActivityNotice.jsx`
- `src/components/ChatChecklistEditor.jsx`
- `src/components/ChatChecklistHistory.jsx`
- `src/components/ChatComposer.css`
- `src/components/ChatHeader.css`
- `src/components/ChatImageControls.jsx`
- `src/components/ChatInfluences.jsx`
- `src/components/ChatListActions.css`
- `src/components/ChatListActions.jsx`
- `src/components/ChatMessageMarkdown.jsx`
- `src/components/ChatSideContent.jsx`
- `src/components/ChatWorkspace.css`
- `src/components/CodeViewer.jsx`
- `src/components/CollectionImages.jsx`
- `src/components/Compatibility.jsx`
- `src/components/Dashboard.jsx`
- `src/components/DashboardReset.jsx`
- `src/components/DisclosurePanel.css`
- `src/components/DisclosurePanel.jsx`
- `src/components/DocumentEditor.css`
- `src/components/DocumentEditor.jsx`
- `src/components/DriveFolderSizes.jsx`
- `src/components/DualChat.css`
- `src/components/EmojiPicker.jsx`
- `src/components/FaceBank.jsx`
- `src/components/FaceClassification.jsx`
- `src/components/FaceStudio.jsx`
- `src/components/FileConverter.jsx`
- `src/components/FilePackager.jsx`
- `src/components/FolderReview.css`
- `src/components/FolderReview.jsx`
- `src/components/FunctionBuilder.jsx`
- `src/components/GenerateReference.jsx`
- `src/components/GeneratedImagePreview.jsx`
- `src/components/GifMaker.jsx`
- `src/components/GifOutputFolder.jsx`
- `src/components/GitHubPublisher.css`
- `src/components/GitHubPublisher.jsx`
- `src/components/HashAuditor.css`
- `src/components/HashAuditor.jsx`
- `src/components/Header.jsx`
- `src/components/HelpSections.jsx`
- `src/components/ImageBatchControls.jsx`
- `src/components/ImageBatchOutput.jsx`
- `src/components/ImageEditor.jsx`
- `src/components/ImageFolderTools.jsx`
- `src/components/ImageGallery.jsx`
- `src/components/ImageGenerationHelp.jsx`
- `src/components/ImageGenerationSizing.jsx`
- `src/components/ImageLibrary.css`
- `src/components/ImageMagic.jsx`
- `src/components/ImageManager.css`
- `src/components/ImageManager.jsx`
- `src/components/ImageManagerTools.jsx`
- `src/components/ImageOutputFolder.jsx`
- `src/components/ImageRemovalControls.jsx`
- `src/components/ImageRequestEditor.jsx`
- `src/components/ImageResolutionControls.jsx`
- `src/components/ImageReview.jsx`
- `src/components/ImageReviewMetadata.jsx`
- `src/components/ImageSettingsControls.jsx`
- `src/components/ImageStudio.jsx`
- `src/components/ImageTagButtons.jsx`
- `src/components/ImageThumbnail.css`
- `src/components/ImageThumbnail.jsx`
- `src/components/ImageWorkflows.jsx`
- `src/components/IndexKnowledgeLinks.css`
- `src/components/IndexKnowledgeLinks.jsx`
- `src/components/InputBar.jsx`
- `src/components/KnowledgeCharacters.jsx`
- `src/components/KnowledgeContext.jsx`
- `src/components/KnowledgeGraph.jsx`
- `src/components/KnowledgeNodeComposer.jsx`
- `src/components/KnowledgeNodeEditor.jsx`
- `src/components/KnowledgeVault.jsx`
- `src/components/LocalDatabase.jsx`
- `src/components/LocalDocument.jsx`
- `src/components/LocalFiles.css`
- `src/components/LocalFiles.jsx`
- `src/components/LocalVideo.jsx`
- `src/components/LockedImages.jsx`
- `src/components/LoraHelp.jsx`
- `src/components/LoraStudio.jsx`
- `src/components/MediaManager.jsx`
- `src/components/MessageList.jsx`
- `src/components/ModelEditor.jsx`
- `src/components/ModelOrder.jsx`
- `src/components/ModelPaint.jsx`
- `src/components/ModelRepair.jsx`
- `src/components/ModelViewer.css`
- `src/components/ModelViewer.jsx`
- `src/components/ModelViewerHelp.jsx`
- `src/components/PCBridge.jsx`
- `src/components/PersonNameEditor.jsx`
- `src/components/PromptIndex.jsx`
- `src/components/PromptIterationDialog.jsx`
- `src/components/PromptPhraseButtons.jsx`
- `src/components/PromptQueue.jsx`
- `src/components/ReferenceAnalysis.jsx`
- `src/components/RegistryApplicationIcon.jsx`
- `src/components/ReviewRecordDetails.jsx`
- `src/components/ReviewTags.jsx`
- `src/components/SaveImagePrompts.jsx`
- `src/components/SceneIterationDialog.jsx`
- `src/components/SceneStudio.jsx`
- `src/components/SecondChat.jsx`
- `src/components/SettingsPanel.jsx`
- `src/components/ShortcutRegistry.css`
- `src/components/ShortcutRegistry.jsx`
- `src/components/Sidebar.jsx`
- `src/components/SidebarNavigation.css`
- `src/components/SidebarNavigation.jsx`
- `src/components/SoftwareSpecs.jsx`
- `src/components/SpreadsheetViewer.jsx`
- `src/components/StorageLibraries.css`
- `src/components/StorageLibraries.jsx`
- `src/components/TabOrderEditor.css`
- `src/components/TabOrderEditor.jsx`
- `src/components/ThinkingTrace.css`
- `src/components/ThinkingTrace.jsx`
- `src/components/ToolRegistry.css`
- `src/components/ToolRegistry.jsx`
- `src/components/Tools.css`
- `src/components/Tools.jsx`
- `src/components/ViewerBrowser.jsx`
- `src/components/VisualReview.css`
- `src/components/VisualReview.jsx`
- `src/components/VoiceCloningPanel.jsx`
- `src/components/VoiceOutputSettings.jsx`
- `src/components/WebAccess.jsx`
- `src/components/WebImageReader.css`
- `src/components/WebImageReader.jsx`
- `src/components/WindowRenderingSettings.jsx`
- `src/components/WorkflowExportControls.jsx`
- `src/components/WorkflowImageLibrary.jsx`
- `src/components/WorkflowRunPanel.jsx`
- `src/components/WorkspaceHelpExtras.jsx`
- `src/components/WorkspaceInfo.css`
- `src/components/WorkspaceInfo.jsx`
- `src/components/WorkstationTime.css`
- `src/components/WorkstationTime.jsx`
- `src/contextMemory.js`
- `src/documentEditor.js`
- `src/fileSelection.js`
- `src/floatingToolBounds.js`
- `src/folderReview.js`
- `src/functionButtons.js`
- `src/functionContract.mjs`
- `src/functionWorkflow.mjs`
- `src/hashAuditor.js`
- `src/help/chat.js`
- `src/help/creative.js`
- `src/help/fileTools.js`
- `src/help/media.js`
- `src/help/model.js`
- `src/help/shared.js`
- `src/help/workflowSettings.js`
- `src/help/workstation.js`
- `src/imageLibraryApi.js`
- `src/imageManagerApi.js`
- `src/imagePrivacyLoader.js`
- `src/imageReview.js`
- `src/imageSources.js`
- `src/index.html`
- `src/indexKnowledgeLinks.js`
- `src/localFiles.js`
- `src/main.jsx`
- `src/modelViewer/archive.js`
- `src/modelViewer/editWorker.js`
- `src/modelViewer/editor.js`
- `src/modelViewer/editorScene.js`
- `src/modelViewer/export.js`
- `src/modelViewer/fonts/helvetiker_regular.typeface.json`
- `src/modelViewer/limits.js`
- `src/modelViewer/materials.js`
- `src/modelViewer/operations.js`
- `src/modelViewer/parse.js`
- `src/modelViewer/projectWorker.js`
- `src/modelViewer/repair.js`
- `src/modelViewer/repairWorker.js`
- `src/modelViewer/scene.js`
- `src/modelViewer/session.js`
- `src/modelViewer/worker.js`
- `src/navigation.js`
- `src/navigationOrder.js`
- `src/popupDismissal.js`
- `src/preferences.js`
- `src/queueNavigation.js`
- `src/registryApplicationIcons.js`
- `src/responseStyle.js`
- `src/serviceStatus.js`
- `src/sessionPersistence.js`
- `src/sidebarNavigationSizing.js`
- `src/storageLibraries.js`
- `src/styles.css`
- `src/thinkingTrace.js`
- `src/toolRegistry.js`
- `src/useDismissiblePopup.js`
- `src/useRangeSelection.js`
- `src/useSelection.js`
- `src/useStore.jsx`
- `src/visualReview.js`
- `src/windowRendering.js`
- `src/workspaceControls.js`
- `src/workspaceHelp.js`
- `src/workspaceInfoContext.js`
- `src/workspaceLayout.js`
- `src/workstationTimer.js`
- `tests/backend/test_application_awareness.py`
- `tests/backend/test_backup_import.py`
- `tests/backend/test_chat_checklists.py`
- `tests/backend/test_chat_influences.py`
- `tests/backend/test_chat_model_runtime.py`
- `tests/backend/test_desktop_control.py`
- `tests/backend/test_document_editor.py`
- `tests/backend/test_folder_review.py`
- `tests/backend/test_github_publication.py`
- `tests/backend/test_hash_auditor.py`
- `tests/backend/test_image_generation_cancel.py`
- `tests/backend/test_image_manager.py`
- `tests/backend/test_image_manager_tools.py`
- `tests/backend/test_image_manager_trash.py`
- `tests/backend/test_image_thumbnails.py`
- `tests/backend/test_index_knowledge_links.py`
- `tests/backend/test_local_files.py`
- `tests/backend/test_maintenance.py`
- `tests/backend/test_request_queue.py`
- `tests/backend/test_scene_analysis.py`
- `tests/backend/test_storage_libraries.py`
- `tests/backend/test_thinking_trace.py`
- `tests/backend/test_video_analysis.py`
- `tests/backend/test_visual_review.py`
- `tests/backend/test_workspace_tools.py`
- `tests/fixtures/appearanceContrast.config.mjs`
- `tests/fixtures/appearanceContrast.html`
- `tests/fixtures/appearanceContrast.jsx`
- `tests/fixtures/applicationAwareness.config.mjs`
- `tests/fixtures/applicationAwareness.html`
- `tests/fixtures/applicationAwareness.jsx`
- `tests/fixtures/chatStartup.config.mjs`
- `tests/fixtures/chatStartup.html`
- `tests/fixtures/chatStartup.jsx`
- `tests/fixtures/documentEditor.html`
- `tests/fixtures/documentEditor.jsx`
- `tests/fixtures/dualChat.jsx`
- `tests/fixtures/dualChatFull.jsx`
- `tests/fixtures/fileSelection.config.mjs`
- `tests/fixtures/fileSelection.html`
- `tests/fixtures/fileSelection.jsx`
- `tests/fixtures/fileSelection.md`
- `tests/fixtures/hashAuditor.config.mjs`
- `tests/fixtures/hashAuditor.html`
- `tests/fixtures/hashAuditor.jsx`
- `tests/fixtures/hashAuditor.md`
- `tests/fixtures/imageThumbnails.config.mjs`
- `tests/fixtures/imageThumbnails.html`
- `tests/fixtures/imageThumbnails.jsx`
- `tests/fixtures/imageThumbnails_backend.py`
- `tests/fixtures/imageThumbnails_media_backend.py`
- `tests/fixtures/indexKnowledge.jsx`
- `tests/fixtures/localFiles.html`
- `tests/fixtures/localFiles.jsx`
- `tests/fixtures/localFiles_backend.py`
- `tests/fixtures/modelViewer.html`
- `tests/fixtures/modelViewer.jsx`
- `tests/fixtures/shortcutRegistry.jsx`
- `tests/fixtures/sidebarNavigationSizing.config.mjs`
- `tests/fixtures/sidebarNavigationSizing.html`
- `tests/fixtures/sidebarNavigationSizing.jsx`
- `tests/fixtures/storageLibraries.config.mjs`
- `tests/fixtures/storageLibraries.html`
- `tests/fixtures/storageLibraries.jsx`
- `tests/fixtures/storageLibraries.md`
- `tests/fixtures/thinkingTrace.config.mjs`
- `tests/fixtures/thinkingTrace.html`
- `tests/fixtures/thinkingTrace.jsx`
- `tests/fixtures/toolRegistry.jsx`
- `tests/fixtures/visualReview.config.mjs`
- `tests/fixtures/visualReview.html`
- `tests/fixtures/visualReview.jsx`
- `tests/fixtures/visualReview.md`
- `tests/fixtures/visualReview_backend.py`
- `tests/fixtures/workspaceInfo.config.mjs`
- `tests/fixtures/workspaceInfo.html`
- `tests/fixtures/workspaceInfo.jsx`
- `tests/fixtures/workspaceInfo.md`
- `tests/fixtures/workstationTime.html`
- `tests/fixtures/workstationTime.jsx`
- `tests/fixtures/zip64.mjs`
- `tests/frontend/appShutdown.test.js`
- `tests/frontend/appearance.test.jsx`
- `tests/frontend/applicationAwareness.test.jsx`
- `tests/frontend/bridge.test.jsx`
- `tests/frontend/browserSession.test.js`
- `tests/frontend/characterLinks.test.jsx`
- `tests/frontend/chatChecklists.test.jsx`
- `tests/frontend/chatRename.test.jsx`
- `tests/frontend/contextMemory.test.js`
- `tests/frontend/dashboard.test.jsx`
- `tests/frontend/documentEditor.test.js`
- `tests/frontend/driveSpace.test.jsx`
- `tests/frontend/dualChat.test.jsx`
- `tests/frontend/fileSelection.test.js`
- `tests/frontend/folderReview.test.jsx`
- `tests/frontend/functionWorkflows.test.js`
- `tests/frontend/galleryAndBulkActions.test.jsx`
- `tests/frontend/generationBatchDimensions.test.jsx`
- `tests/frontend/gifFiles.test.js`
- `tests/frontend/githubPublisher.test.jsx`
- `tests/frontend/hashAuditor.test.jsx`
- `tests/frontend/imageManager.test.jsx`
- `tests/frontend/imageReview.test.jsx`
- `tests/frontend/imageThumbnails.test.jsx`
- `tests/frontend/indexKnowledgeLinks.test.jsx`
- `tests/frontend/knowledge-context.test.jsx`
- `tests/frontend/localFiles.test.js`
- `tests/frontend/lockImageDialog.test.jsx`
- `tests/frontend/mediaManager.test.js`
- `tests/frontend/meshRepair.test.js`
- `tests/frontend/modelEditor.test.js`
- `tests/frontend/modelEditorDesktop.test.js`
- `tests/frontend/modelViewer.test.js`
- `tests/frontend/navigation.test.jsx`
- `tests/frontend/navigationOrder.test.jsx`
- `tests/frontend/popupDismissal.test.js`
- `tests/frontend/sceneState.test.jsx`
- `tests/frontend/shortcutRegistry.test.jsx`
- `tests/frontend/sidebarNavigationSizing.test.js`
- `tests/frontend/startupRecovery.test.js`
- `tests/frontend/storageLibraries.test.jsx`
- `tests/frontend/thinkingTrace.test.js`
- `tests/frontend/toolRegistry.test.jsx`
- `tests/frontend/videoAnalysis.test.jsx`
- `tests/frontend/visualReview.test.jsx`
- `tests/frontend/windowRendering.test.js`
- `tests/frontend/workspaceInfo.test.jsx`
- `tests/frontend/workspaceLayout.test.jsx`
- `tests/frontend/workstationTimer.test.jsx`
- `vite.config.mjs`

</details>
