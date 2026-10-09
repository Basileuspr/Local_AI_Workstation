import {workspaceControls} from './workspaceControls';
// Every workspace has an explicit guide. New routes must add one here too.
// Keep instructions out of the work surface; WorkspaceInfo owns their presentation.
const overview = {
  'info-center': {
    purpose: 'Find practical use cases, examples, and detailed control guides for every workspace in one central directory.',
    example: 'Search for duplicates to compare Image Manager and Hash Auditor, read their use cases, then choose Open on the feature that fits your task.',
  },
  university: {
    purpose: 'Learn computing, local AI and the workstation’s tools through offline lessons with guided app practice, sample files, working notes and knowledge checks.',
    example: 'Find Read a table and verify its totals, save the practice CSV, open Spreadsheets from the lesson and filter to stationery. Verify the 28-credit subtotal, return to your notes and complete the knowledge check.',
  },
  'agent-university': {
    purpose: 'Learn to plan, supervise and evaluate workflows using the app’s actual tools, source boundaries, handoffs, result checks and recovery controls.',
    example: 'Study Discover tools before planning, inspect a Dashboard tool contract, then draft its inputs, outputs, prerequisites and completion evidence. Work through the capstone to turn the practice brief into a checked summary, diagram and delivery package.',
  },
  'neural-network': {
    purpose: 'Explore how a tiny neural network turns two input numbers into two output shares. Use the explanations and worked example below to understand each slider and activation option.',
    example: 'Reset network, select Input 1 → Hidden 1, and change Weight from 0.8 to 0. Hidden 1’s weighted sum falls from 0.750 to 0.350 because Input 1’s contribution is removed. Reset again, then compare tanh, ReLU, and sigmoid with the same numbers.',
  },
  'break-room': {
    purpose: 'Play Mini Piano, practice ready-made music lessons, save your own piano templates, convert local audio to estimated notes and MIDI, attach Spotify track references, take a break with Memory Match, or help identify faces in analyzed REVIEW / Image Manager images.',
    example: 'Choose C major scale and Practice: watch the falling-note guide and press the letters it shows. Practice waits for you. Try Play along for a four-beat count-in and timed hits at the line. Use New template to save your own notes, chords and rests; the same live guide works with them. For a recording, open Audio → notes, select a short local audio clip, convert and Review as piano template. Correct the estimate before saving. Add an optional Spotify track reference and open it in Linked Applications to listen separately. Explore enharmonic equivalents, play Memory Match or help identify faces.',
  },
  'document-editor': {
    purpose: 'Write and edit rich documents with a Word-style ribbon and local Python DOCX import/export.',
    example: 'Use Home → Styles for named paragraph formatting, or click a table for Table Layout and Table Design. References provides captions, live cross-references, contents, bookmarks, footnotes/endnotes and citations: Manage sources, Insert citation, choose a basic style and add a bibliography. Caption edits update reference text and numbering; source edits update citations and bibliography together. Export .docx, then Download DOCX. The editing view is continuous; opening an existing file creates a supported editable copy after a conversion notice.',
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
    purpose: "Paint with brushes, shapes and text, edit selections and layers, and save images or editable projects locally.",
    example: "Choose Rectangle, draw a shape, then Text to add a label. Enable Layers in View to add another layer. Save project preserves layers; Use in chat stages a removable PNG attachment for your next message.",
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
  'sound-mixer': {
    purpose: 'Mix the app’s speech, audio, video and alerts with local tracks and an explicitly enabled microphone. Record processed app channels into a local audio file.',
    example: 'Add two local audio tracks, play them, lower one fader, and use Solo to hear a single channel. Expand EQ & pan to shape its sound. Enable a microphone only when needed; monitoring starts off. Press Record mix, perform your mix, then Stop and Save recording. Settings stay linked across tabs.',
  },
  slicer: {
    purpose: 'Prepare a G-code file from a local STL using the installed CuraEngine and a matching printer profile, with local progress and cancellation controls.',
    example: 'Refresh Cura readiness, choose an STL under 50 MiB and select the profile for your printer. Check the material, nozzle, layer height, infill and support settings, then Slice model. Download the completed G-code and inspect it in your printer software before printing.',
  },
  integrations: {
    purpose: 'Use the Discord widget and explicit message sending, record Windows or embedded Spotify playback, and inspect phone-mirroring readiness.',
    example: 'Open a Spotify link and press Play in its embedded player. Choose Embedded Spotify player as the recording source, start recording and confirm Audio signal received. Stop, listen to the preview, then save the recording locally. Use shared Sound output controls to adjust preview volume and its playback device.',
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
    purpose: "Classify images with ratings, tags, captions, local face grouping, and optional scene analysis, then file them into Gallery folders.",
    example: "Upload images, choose Review image, save a caption and tags, then use Add to folder. For face or scene grouping, open Review & classify and select available local models.",
  },
  "image-editor": {
    purpose: "Crop, rotate and adjust an image locally, then save an edited copy.",
    example: "Open an image, choose Crop, draw or fine-tune a selection, and press Apply crop. Adjust contrast, compare with the original, then export the edited PNG. Undo restores an applied crop.",
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
    purpose: "Browse public pages in tabs, manage bookmarks, and inspect available HTML, CSS, and JavaScript source.",
    example: "Open a page, use New tab for another, and adjust the default 2-minute suspension timeout in Tab settings. Selecting a suspended tab reloads its page.",
  },
  'web-system': {
    purpose: 'Research a current question with public-page evidence, or deliberately configure recurring public sources with separate retention controls.',
    example: 'Choose a local text model, ask a focused question, and optionally enter a public source URL. Use Research now, inspect citations and Coverage, then choose one source to Save to Knowledge. For recurring checks, add a source and explicitly enable background monitoring.',
  },
  'reels-analyzer': {
    purpose: 'Acquire supported reels from a manually signed-in account browser and analyze verified media with local models while keeping brief saved summaries.',
    example: 'Open account browser, select the original account profile, log in and Check account. Open a conversation, choose Use this conversation, select installed models, and Analyze discovered reels. Review saved summaries; unsupported acquisition remains a reported failure.',
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
    example: "Enter ‘<main><h1>Hello</h1><p>A local preview.</p></main>’, choose Preview, then Edit source to revise it. File actions contains Open and Copy; Save source stays on the toolbar.",
  },
  "css-viewer": {
    purpose: "Read and edit CSS with a local HTML preview.",
    example: "Add ‘h1 { color: teal; }’, open HTML to style to check the sample heading, and choose Preview to see the result.",
  },
  "js-viewer": {
    purpose: "Read, edit, copy, or save JavaScript source as text.",
    example: "Open a script from Browser inspection, search or read its source, edit a copy, and save it as a JavaScript file.",
  },
  'styling-library': {
    purpose: 'Browse offline HTML and CSS examples for buttons, form controls, layouts, effects, typography and animations.',
    example: 'Choose Buttons, open Button essentials with View code, and compare its HTML structure with its CSS styles. Copy or save the full example, or choose Edit in CSS / Styling, change the button colors, and click Preview. Choose Animations to compare loading patterns and pause their motion.',
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
