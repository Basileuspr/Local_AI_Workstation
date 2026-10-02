import {workspaceControls} from './workspaceControls';
// Every workspace has an explicit guide. New routes must add one here too.
// Keep instructions out of the work surface; WorkspaceInfo owns their presentation.
const overview = {
  'document-editor': {
    purpose: 'Write and edit rich documents with a Word-style ribbon and local Python DOCX import/export.',
    example: 'Create a heading, write a paragraph, insert a table, choose A4 in Layout and Export .docx. To edit an existing file, use File → Open .docx, review the conversion limits and open the editable copy.',
  },
  'local-files': {
    purpose: 'Edit existing DOCX text, inspect SQLite databases, and sample or analyze videos locally.',
    example: 'Open a DOCX, change a text run, acknowledge preservation limits and Save As a copy. Or open a DB, preview a table and export the current page. For video, choose an installed vision model, optionally enter an analysis focus, then click Analyze video. Sampling runs automatically and produces a summary with timestamped descriptions. Extract frames only remains available without AI.',
  },
  chats: {
    purpose: "Talk to a local model and work with text, files, images, audio, and documents.",
    example: "Attach a document, ask ‘Summarize this in five bullet points,’ review the attachments, then Send. A blank chat becomes a saved conversation after your first prompt.",
  },
  library: {
    purpose: "Browse the Index of saved prompts and reference material.",
    example: "Search for a reusable writing prompt, inspect its text, then copy it into chat and adapt it to your current document.",
  },
  knowledge: {
    purpose: "Keep documents and authored notes in a local Knowledge vault with explicit connections.",
    example: "Import two project documents, connect them in the inspector, then select the relevant Knowledge scope when asking a question in chat.",
  },
  canvas: {
    purpose: "Draw a whiteboard or ask chat to create and edit a diagram on the canvas.",
    example: "Draw two rectangles and an arrow, add labels with Text, select the objects, then Use in chat to ask the model to revise your diagram.",
  },
  converter: {
    purpose: "Convert still images into another file format on this computer.",
    example: "Choose a JPG, select PNG, click Convert, and download the new image. The source file stays in place.",
  },
  packager: {
    purpose: "Collect files and folders into one downloadable ZIP.",
    example: "Add a project folder and a separate readme, name the archive ‘Project handoff,’ create the package, then Save ZIP.",
  },
  audio: {
    purpose: "Record, transcribe, extract audio, read text aloud, or generate speech with a local voice model.",
    example: "Upload a meeting recording, enable Separate speakers, transcribe it, correct the speaker labels and text, then save the reviewed transcript.",
  },
  images: {
    purpose: "Browse images saved in the app’s gallery.",
    example: "Find a generated image, open its preview, then send it to Editor to make a local adjustment.",
  },
  generate: {
    purpose: "Generate images with a local image model, with optional references and a compatible LoRA adapter.",
    example: "Use a fixed seed such as 42 and keep the model, prompt, dimensions, and steps the same while comparing two guidance values. The detailed scales below explain each setting.",
  },
  review: {
    purpose: "Review image requests and their generated results.",
    example: "Open a completed request, compare its images, and send the selected result to Editor for finishing.",
  },
  "image-editor": {
    purpose: "Edit an image locally and preview the changes.",
    example: "Open an image, adjust its contrast slightly, compare the preview, then save the edited copy.",
  },
  "gif-maker": {
    purpose: "Build an animated GIF from ordered image frames.",
    example: "Add three images, order them as beginning, middle, and end, adjust the frame timing, preview the loop, then save the GIF.",
  },
  workflows: {
    purpose: "Arrange reference assets and processing stages for an image workflow or an iterative scene.",
    example: "Create a workflow, add a source image, add a resizing stage, validate it, prepare a snapshot, and run it. Inspect the completed output before branching the next scene.",
  },
  "media-manager": {
    purpose: "Browse and organize media in the integrated Media Manager.",
    example: "Select a media folder, scan it, filter the library to a date range, and review an organization plan before applying it.",
  },
  "image-manager": {
    purpose: "Browse and organize still images in folders on this computer.",
    example: "Scan a selected folder, find exact duplicates, then prepare and inspect a Copy plan to a chosen output folder.",
  },
  characters: {
    purpose: "Keep a character’s biography, notes, media, documents, and related datasets together in one profile.",
    example: "Create a character profile, add a reference image and biography, then link the matching face dataset and trained LoRA.",
  },
  faces: {
    purpose: "Extract and curate face images for a dataset.",
    example: "Add a reference image, review the extracted faces, and keep the examples you want to associate with a character profile.",
  },
  "character-parts": {
    purpose: "Curate character regions and reference crops in a dataset.",
    example: "Add a reference image, draw a crop around an eye, label its side and view, and use it as the focus for reviewing other candidate regions.",
  },
  lora: {
    purpose: "Prepare a dataset and train a local LoRA adapter for a character or visual style.",
    example: "Create an identity project with a trigger token, add varied reference images, review captions, train, and compare the saved adapter in Generate with its matching base model.",
  },
  browser: {
    purpose: "Browse public pages and inspect their available HTML, CSS, and JavaScript source.",
    example: "Open a public page, choose Inspect page, and open a stylesheet in CSS / Styling to study its rules.",
  },
  "3d-viewer": {
    purpose: "View, build, edit, paint, and repair local 3D models without sending them to AI.",
    example: "Insert a cube and cylinder, move them to overlap, select the cube first and cylinder second, then Edit → Subtract. Undo if needed, paint the result, and save a .law3d project. To fix a damaged source first, open Repair source mesh with Windows and review the repaired preview.",
  },
  markdown: {
    purpose: "Read, edit, and preview Markdown text.",
    example: "Paste ‘# Meeting notes’ followed by a short list, choose Show Markdown, then return to Plain Text to revise the list.",
  },
  "html-viewer": {
    purpose: "Read, edit, and preview HTML source.",
    example: "Enter ‘<main><h1>Hello</h1><p>A local preview.</p></main>’, choose Preview, then return to Source to edit it.",
  },
  "css-viewer": {
    purpose: "Read and edit CSS with a local HTML preview.",
    example: "Add ‘h1 { color: teal; }’, open HTML to style to check the sample heading, and choose Preview to see the result.",
  },
  "js-viewer": {
    purpose: "Read, edit, copy, or save JavaScript source as text.",
    example: "Open a script from Browser inspection, search or read its source, edit a copy, and save it as a JavaScript file.",
  },
  spreadsheets: {
    purpose: "Inspect tabular data in the spreadsheet viewer.",
    example: "Open a CSV report, filter to the relevant records, choose the columns to include, then Use filtered rows to ask a focused question in chat.",
  },
  shortcuts: {
    purpose: "Keep application shortcuts, behaviors, and functions in a searchable local reference.",
    example: "Create a Microsoft Excel folder, add a shortcut with its behavior, then filter to Excel when working with a workbook.",
  },
  tools: {
    purpose: "Keep custom navigation buttons, fixed desktop actions, and reusable function sequences together.",
    example: "Create a button that opens Shortcut Registry, or prepare a folder-audit function and review its staged results before sending them to chat.",
  },
  "hash-auditor": {
    purpose: "Inventory files using SHA-256 and filesystem metadata without modifying them.",
    example: "Audit two selected folders, inspect identical-hash groups, and export the recorded results for review.",
  },
  "folder-review": {
    purpose: "Review a local folder one file at a time and combine the findings into a report.",
    example: "Choose a project folder, select a text model, start a review, inspect the per-file findings and coverage, then download the combined Markdown report.",
  },
  dashboard: {
    purpose: "Check application, model-runtime, and system status.",
    example: "Check service readiness and copy your system specs when documenting a model or generation issue.",
  },
  queue: {
    purpose: "Track requests waiting for or using the local model runtime.",
    example: "Submit an image request, open Prompt Queue to check its state, then open the completed result from its request card.",
  },
};

export const workspaceHelp = Object.fromEntries(Object.entries(overview).map(([tab, guide]) => [tab, {...guide, sections: workspaceControls[tab]}]));
