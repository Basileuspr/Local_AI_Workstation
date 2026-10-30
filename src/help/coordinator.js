import { codingHelp } from './coding';
export const coordinatorOverview = {
  purpose: 'Coordinate local tasks with interchangeable Coding, Research & Knowledge, and Media Librarian harnesses. Each harness supplies its own tools, workflow and completion checks.',
  example: 'Choose Research & Knowledge, ask a question, inspect its cited answer, then save a selected captured source to Knowledge. Switch to Coding to continue a project task without losing either result.',
};
export const coordinatorHelp = [['Coordinator', [
  ['Harness', 'Choose Coding, Research & Knowledge or Media Librarian independently of the local model. Switching keeps drafts and tasks. Each saved task retains its harness and version.'],
  ['All saved tasks', 'Open a saved task across harnesses. Coding retains its existing history and project protections; research and media keep up to 100 local runs, including captured evidence and receipts. Remove saved task frees its history without undoing applied actions.'],
  ['Run controls', 'Coding supports Pause and Resume with project validation. Research and media planning support Stop; after interruption, start a new task rather than replaying uncertain work. All local inference shares the existing queue.'],
  ['Model and drafts', 'Models are selected per harness. Coding requires native tool support; research and media use structured responses. Drafts are saved in this browser. Rechoose the Coding project after restarting to restore its native project authorization; profiles and permissions remain in Verification Manager.'],
]], ['Research & Knowledge', [
  ['Start research', 'Uses the configured Web search provider and up to six public sources. Optional URLs seed research. The local model checks source IDs, quotes and answer support; partial coverage and failures remain visible.'],
  ['Captured evidence', 'The answer, source provenance and captured source text stay in the saved Coordinator task. Evidence reflects its retrieval time, not a guarantee of current accuracy. Removing the task removes this capture.'],
  ['Save to Knowledge', 'Explicitly index one selected captured source through the existing local embedding queue. This saves source text with provenance, not the generated answer. A receipt confirms indexing or deduplication.'],
]], ['Media Librarian', [
  ['Browse and plan', 'Choose up to 24 registered media items and describe your organization goal. The text model sees metadata, not pixels or video. Suggestions do not modify reviews until you apply selected proposals.'],
  ['Apply selected metadata', 'Review tags, categories and reasons. Applying adds tags and sets the proposed category while preserving other metadata. Changed records reject stale proposals. Inspect receipts after partial failures.'],
  ['Duplicate candidates', 'Lists items in the selection with matching recorded content hashes. This is not a fresh whole-library scan, and no duplicate is deleted.'],
  ['File organization', 'Select task items and an existing configured destination preset, then prepare and inspect the exact copy/move plan. Confirming uses the existing single-use review workflow, collision handling and source checks. Media Manager video transfers stay in Media Manager.'],
  ['Recovery', 'Use Review for transfer receipts and eligible move undo. Stop does not undo completed actions; interrupted writes are not replayed automatically.'],
]], ...codingHelp];
