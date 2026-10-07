import { appTabLabels } from './navigation';
import { navigationSections } from './navigationOrder';
import { workspaceHelp } from './workspaceHelp';

// Task-oriented examples complement the shared control guides. Keep one entry
// per workspace so the directory cannot silently omit a newly added feature.
export const featureUseCases = {
  chats: ['Summarize an attached report or ask questions about its contents.', 'Draft, rewrite, brainstorm, or compare ideas with a local model.'],
  library: ['Find a saved prompt to reuse for a recurring task.', 'Look up reference material before starting a new conversation.'],
  knowledge: ['Keep project documents and notes connected in one local vault.', 'Choose relevant source material to ground a chat answer.'],
  canvas: ['Sketch a diagram, storyboard, or visual explanation for a chat.', 'Build layered artwork and save an editable project for later.'],
  converter: ['Turn a JPG into PNG for a tool that needs a different image format.', 'Create a converted image copy while keeping the original.'],
  'local-files': ['Make a focused text edit to an existing DOCX and save a copy.', 'Inspect a SQLite table or sample a video for timestamped analysis.'],
  'document-editor': ['Write and format a report with headings, tables, and images.', 'Organize a longer document with contents, notes, citations, and a bibliography.'],
  packager: ['Bundle a project folder and supporting files into one ZIP handoff.', 'Package selected deliverables into a single downloadable archive.'],
  'hash-auditor': ['Compare file hashes to find exact duplicates across selected folders.', 'Create a file inventory to check copies or document an archive.'],
  'folder-review': ['Ask a local model to review a folder of documents file by file.', 'Combine findings into a report and inspect which files were covered.'],
  audio: ['Transcribe a meeting recording and correct its speaker labels.', 'Read a draft aloud or generate speech with an available local voice model.'],
  'sound-mixer': ['Balance speech, video, alerts, and local backing tracks.', 'Record a mix and use solo, EQ, and pan to inspect individual channels.'],
  slicer: ['Prepare an STL for a printer using CuraEngine and a matching profile.', 'Compare layer height, infill, and support settings before exporting G-code.'],
  integrations: ['Record supported Spotify playback and save a local recording.', 'Use the Discord widget or check phone-mirroring readiness.'],
  images: ['Find and revisit an image saved from a previous generation.', 'Choose a gallery image to send to Image Editor for an adjustment.'],
  'image-manager': ['Scan a photo folder, review metadata, and find exact duplicates.', 'Prepare an organization plan or use Image tools for batch sizing and sheet layouts.'],
  generate: ['Create concept art or illustrations from a text prompt with a local model.', 'Compare controlled variations using a fixed seed, references, or a compatible LoRA.'],
  review: ['Add captions, ratings, and tags to make images easier to find.', 'Review face groups and scene classifications before filing images into folders.'],
  'image-editor': ['Adjust contrast, color, or other image settings and compare the preview.', 'Prepare an edited image copy for a document or another workflow.'],
  'gif-maker': ['Turn a sequence of images into an animated demonstration.', 'Adjust frame order and timing to create a short looping animation.'],
  workflows: ['Reuse a sequence of image-processing stages with reference assets.', 'Develop an iterative scene and inspect outputs before the next change.'],
  'media-manager': ['Browse and filter a local media collection.', 'Review an organization plan before applying changes to media files.'],
  characters: ['Collect a character biography, notes, and visual references in one profile.', 'Associate a character with a face dataset and trained LoRA.'],
  faces: ['Extract candidate faces from reference images.', 'Curate a face dataset to associate with a character profile.'],
  'character-parts': ['Crop and label a specific character region, such as an eye.', 'Compare candidate regions by side or view while building a reference dataset.'],
  lora: ['Prepare images and captions for a character or style adapter.', 'Train locally and compare the adapter with its compatible base model in Generate.'],
  university: ['Learn a workstation tool through an offline lesson and guided exercise.', 'Practice with sample files and track notes and knowledge checks.'],
  'agent-university': ['Learn to plan tool workflows with clear inputs and completion checks.', 'Practice supervising handoffs, reviewing results, and recovering from errors.'],
  'neural-network': ['See how input values and weights change a small network’s outputs.', 'Compare activation functions using the same numbers.'],
  'break-room': ['Take a short break with Memory Match.', 'Help correct uncertain face matches from images already analyzed in Review.'],
  browser: ['Read a public web page within the workstation.', 'Inspect available page source and send HTML, CSS, or JavaScript to a viewer.'],
  '3d-viewer': ['Inspect, paint, or repair a local 3D model.', 'Combine or subtract shapes and save an editable 3D project.'],
  markdown: ['Preview a Markdown report before sharing it.', 'Edit headings, lists, and notes while switching between source and preview.'],
  'html-viewer': ['Preview an HTML snippet or a page captured from Browser.', 'Edit a local page example and inspect the result.'],
  'css-viewer': ['Try colors, spacing, and layout rules against sample HTML.', 'Study and adapt a stylesheet inspected from a web page.'],
  'styling-library': ['Find an offline example of a button, form, layout, or animation.', 'Copy an example into CSS / Styling and adapt its appearance.'],
  'js-viewer': ['Read and inspect a script captured from Browser.', 'Edit, copy, or save JavaScript source as text.'],
  spreadsheets: ['Inspect and filter records in a CSV report.', 'Choose relevant rows and columns to use in a focused chat question.'],
  shortcuts: ['Look up a keyboard shortcut while working in another application.', 'Build a personal reference of shortcuts and what each one does.'],
  dashboard: ['Check service and model readiness when a task will not start.', 'Copy system specifications or inspect available tool contracts.'],
  queue: ['See which model requests are waiting, running, or finished.', 'Return to a completed result from its queue entry.'],
  tools: ['Create a shortcut button for a frequently used workspace.', 'Prepare a reusable function sequence and review its results before sending to chat.'],
};

export const featureCategories = navigationSections
  .map(section => ({ id: section.id, label: section.label, items: section.items.filter(item => item.id !== 'info-center') }))
  .filter(section => section.items.length);

export const featureDirectory = featureCategories.flatMap(section => section.items.map(item => ({
  id: item.id,
  title: appTabLabels[item.id],
  category: section.id,
  categoryLabel: section.label,
  useCases: featureUseCases[item.id] || [],
  ...workspaceHelp[item.id],
})));

export function filterFeatures(query = '', category = 'all') {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return featureDirectory.filter(feature => {
    if (category !== 'all' && category !== feature.category) return false;
    const searchable = [feature.title, feature.categoryLabel, feature.purpose, feature.example,
      ...feature.useCases, ...feature.sections.flatMap(([heading, entries]) => [heading, ...entries.flat()])]
      .join(' ').toLocaleLowerCase();
    return terms.every(term => searchable.includes(term));
  });
}
