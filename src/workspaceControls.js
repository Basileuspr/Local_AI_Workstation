import {chatHelp} from './help/chat';
import {fileToolHelp} from './help/fileTools';
import {mediaHelp} from './help/media';
import {creativeHelp} from './help/creative';
import {workstationHelp} from './help/workstation';
import {modelHelp} from './help/model';
import {workflowSettingsHelp,imageAdjustmentHelp} from './help/workflowSettings';
import {neuralNetworkHelp} from './help/neuralNetwork';
import {linkedToolHelp} from './help/linkedTools';
import {webHelp} from './help/web';

export const workspaceControls = {
  'design-programming': [['Design & Programming', [
    ['UI Playground / code viewers', 'Use the tabs inside this main workspace to open the playground, Styling Library, HTML, CSS, JavaScript, or Markdown. Viewer drafts stay mounted when you switch. Browser source actions and existing Functions or pin destinations still open the same viewers here.'],
    ['Starting templates', 'Load one of six combinations of the existing themes and fonts. Templates replace the preview appearance; component choices, sample layout, and preview width remain independent.'],
    ['Color & type / Shape & rhythm', 'Mix every app palette, accent, interface font, code font, and contrast setting with corner, density, surface, button, and motion treatments. Original preserves each existing app control’s treatment. Changes stay in the preview until Apply to app.'],
    ['Live preview', 'Compare generation, dashboard, or chat samples at fluid, tablet, or phone widths. Fixed widths shrink to fit the available pane. Sample buttons and fields never submit model requests.'],
    ['Apply to app / Undo application', 'Apply the palette, fonts, contrast, and supported shared control treatments to this desktop. Shared buttons, fields, navigation spacing, and cards adopt the selected treatments; embedded apps, native surfaces, and preview-only layouts retain their own design. Undo restores the previous app appearance unless it has since changed elsewhere.'],
    ['Save, load & export designs', 'Drafts save on this device. Keep up to 30 named presets, replace one by name, export/import a versioned JSON design, or save the sample preview as HTML. Import and Load only update the draft.'],
    ['Comparison board', 'Add any of the 20 offline library examples, reorder or remove them, and compare them with your current colors and fonts. Each component has an isolated preview. Motion respects the device preference and the Reduced choice.'],
    ['Open preview CSS / HTML', 'Send the generated sample source to its viewer. Edit component CSS sends that component and its HTML. HTML/CSS previews block scripts and network access; JavaScript remains a text viewer.'],
  ]], ['UI Design Mirror (desktop menu)', [
    ['Open mirror / Add current app view', 'Choose Design → UI Design Mirror… or press Ctrl+Alt+D. The separate window restores its saved draft, or captures the current app on first use. Add current app view takes another copy while retaining earlier requests, with up to eight captures.'],
    ['Select and edit', 'Click an element in the copy, or use Find an element and the element list. Change its font, colors, border, spacing or dimensions; edit display text and placeholders where offered. Select parent targets a containing section. UX request records ideas for behavior or layout. All changes belong to that element in that capture.'],
    ['Reset / Undo last edit', 'Use a property’s reset arrow to restore its captured value, Reset this element to clear its requests, or Undo last edit to step back through edits made in this window.'],
    ['Review requested edits / Apply to app', 'After an edit, Review shows original and proposed views with linked scrolling, requested values and an application check. Compare target locates an edit. Apply to app saves only ready changes to the live app on this device, including after restarts. Missing, ambiguous or conflicting targets remain unapplied; open the relevant view, capture again or resolve the requests.'],
    ['Undo last application / Export requests', 'Undo last application restores the design before the most recent Apply, even after restarting. Resetting draft edits or removing captures does not undo an applied design. Export requests (JSON) is an optional record, not a required step. Editing, reviewing and exporting leave the live app unchanged. Written UX notes and native menu styling remain request-only.'],
    ['Workspace in copy / preview limits', 'Choose a workspace already loaded when captured. Double-click copied menus or disclosures, or use Open / close section, to inspect their existing contents. Open a missing view or dialog in the main app, then Add current app view. Embedded apps and browser pages use placeholders; native menu styling is a visual proposal.'],
    ['Saved drafts / Remove capture', 'Captures and requests save automatically on this device, separately from app appearance settings. Copies include on-screen text and available image previews. If saving fails, keep the window open and use Retry saving. Remove capture asks before deleting that capture and its requests; export first to retain a request record.'],
  ]]],
  'info-center': [['Explore features', [
    ['Search features and use cases', 'Search by a task, feature name, example, or control. Multiple words narrow the results together. Escape clears the search text.'],
    ['Category / Clear filters', 'Limit the directory to one navigation category or clear the filters to see every feature again.'],
    ['Use it to / Try this', 'Read practical reasons to use each feature and a concrete example to help you get started.'],
    ['Show controls & detailed guide', 'Expand the same control guide available inside that workspace without leaving the Info Center.'],
    ['Open', 'Switch to the selected workspace. Returning to Info Center keeps your current search and category.'],
  ]]],
  university: [['Learning controls', [
    ['Lessons', 'Choose a lesson and work through its concepts and exercise. Lesson notes and passed checks are saved on this device.'],
    ['Find a lesson / Topic', 'Search titles, concepts and workspace names, or select a topic group. Filtering keeps your current lesson and notes in place. Clear filters restores the whole list.'],
    ['Practice in the app', 'Follow the numbered steps using the linked workspaces, then return to this course. Opening a workspace does not execute the exercise. Check your result gives concrete completion evidence.'],
    ['Copy sample / Save practice file', 'Copies authored practice material or downloads its named TXT, CSV, Markdown, HTML or STL sample. Use these small examples to learn without needing your own source data.'],
    ['Check answer', 'Choose an answer and check it. A correct answer records a passed knowledge check; you can revisit lessons at any time.'],
    ['Copy practice prompt', 'Copies a coaching prompt for you to paste into chat. Copying does not submit a model request.'],
    ['Export notes & progress', 'Downloads the course notes and passed checks as a JSON file. This also keeps a copy when browser storage is unavailable.'],
  ]]],
  'agent-university': [['Agent workflow practice', [
    ['Lessons', 'Study planning, permissions, tool contracts, untrusted content, recovery, and evaluation with written exercises.'],
    ['Find a lesson / Topic', 'Find app workflows by workspace, concept or topic. Foundations stay available alongside planning, supervised actions, media, delivery and the capstone.'],
    ['Practice in the app', 'Open the named workspaces and follow the supervised exercise. Each lesson gives evidence to check; saving a plan or copying a prompt does not run an agent or grant tools to chat.'],
    ['Practice samples / Capstone', 'Use the supplied project brief and data examples to plan, build, verify and package a bounded result. External sends and training are separate explicit actions, not course completion requirements.'],
    ['Your working notes', 'Keep your plan or evaluation design locally. These exercises do not run tools or train an installed model.'],
    ['Check answer', 'Use the knowledge check and explanation to assess your understanding; correct answers record progress.'],
    ['Copy practice prompt / Export notes & progress', 'Copy a lesson prompt for manual use in chat or download a JSON copy of this course’s notes and progress.'],
  ]]],
  'neural-network': neuralNetworkHelp,
  'break-room': [['Mini Piano', [
    ['Piano keys', 'Hold a key with your mouse or touch to play; hold several for a chord. Focus a piano key and use Space or Enter, or click the piano and use the letter shortcuts shown on its keys. Shortcuts work while focus stays inside the piano.'],
    ['Audio → notes', 'Select a local audio file up to 32 MB / ten minutes, choose a 1–30 second excerpt, tempo, timing grid and detection threshold, then Convert audio to notes. The local Basic Pitch model estimates pitches and chords. Review as piano template opens an editable draft; Save template adds it to the live practice guide. Download MIDI preserves detected timing. Update timing re-snaps existing notes at the chosen BPM and grid. Cancel or leaving Break Room ends conversion.'],
    ['Spotify track reference', 'Attach an official Spotify track link or URI to a template. Listen on Spotify opens the track; Open in Linked Applications selects its Spotify tab and fills the track link. Open Spotify player and press Play there to listen. Return to piano comes back to Break Room. Spotify streams are not downloaded, synchronized with the guide, or analyzed.'],
    ['Sound & effects', 'Choose Clean, Warm, Dreamy or Retro, or adjust waveform, brightness, reverb, echo, tremolo and sustain. Reset effects returns to Clean.'],
    ['Lower / Higher octave', 'Shift the visible keyboard from C1 upward. Choose 2, 3, or 4 octaves, or the full A0–C8 88-key range. Changing the range releases held notes.'],
    ['Volume', 'Adjust the piano’s volume. Playback also follows Sound output and the Sound Mixer Audio channel. Notes stop when you leave Break Room, move focus outside the piano, or leave the app.'],
    ['Lesson / template · Listen / Practice / Stop', 'Choose one of 29 ready-made lessons or your saved templates. Listen plays the sequence at its BPM and highlights keys. Repeat loops the demonstration. Practice highlights the next note or chord and advances when you play exactly those keys; release between steps. For a rest, count its beats then choose Next step. Stop ends the activity.'],
    ['Live note guide / Play along', 'Falling bars line up with the actual piano keys and show computer-key shortcuts. The prompt names the current chord and the next three steps appear underneath. Practice waits at the line until you play the right keys. Play along gives a four-beat count-in, moves notes at the selected BPM, and scores note/chord attacks as hits or misses. Release and press again for repeated notes. Rest steps are not scored. Leaving the piano or app stops the run. Hide Live note guide when you want to play freely.'],
    ['New template / Use as template / Edit template', 'Create a sequence or adapt an existing lesson. Name it, add instructions and a default tempo, then enter notes such as C4 Db4, chords such as [C4 E4 G4], and rests such as R. A suffix such as :2 sets the beat length. Or play a note/chord, release it, then Add played keys. Save template remembers it locally. Download template keeps a JSON copy; Delete template offers Undo delete.'],
    ['Note names / Enharmonic equivalents', 'Show sharp names, flat names, or both on black keys. The selected-key line, tooltips and expandable reference include white-key equivalents and optional double accidentals. Spellings use the written octave, so B♯3 = C4 and C♭5 = B4. Templates accept #, b, ##, bb, x and the corresponding musical symbols.'],
  ]], ['Help identify faces', [
    ['Photos from', 'Choose all analyzed images, Image Library, or Image Manager. First use Group faces and classify in REVIEW / Image Manager. Questions reuse saved crops without scanning or loading a model.'],
    ['Name / Yes', 'Confirm the proposed name, choose an existing person, or enter a new name. Yes updates this face in the existing REVIEW people groups; a new name labels only this face.'],
    ['No / Skip', 'No records a rejected match and separates this face from a mistaken group when needed. Skip saves no answer and leaves the face available on a later visit.'],
    ['Single face / Compare / Show photo context', 'Small crops, low detail, and uncertain matches open beside an existing reference when available. Switch the view or show the original photo to check its setting. Similarity suggests a match; your answer confirms it.'],
    ['Undo / Not a face', 'Undo restores the last saved answer unless another REVIEW correction changed it. Not a face removes the crop from people grouping and can also be undone. Source images are preserved.'],
    ['Availability', 'Hidden, locked, changed, missing, and unavailable images are left out of questions and references. Names and answers remain local in the REVIEW catalog and survive restarting the app.'],
  ]], ['Memory Match', [
    ['Cards', 'Reveal two cards per move. Matching pairs stay visible; other cards turn face down after a short delay.'],
    ['Pause game', 'Hide the cards and pause pair resolution. Resume returns to the same game; hidden workspaces also pause resolution.'],
    ['New game / Play again', 'Shuffle a new board and reset its move count. Your lowest completed move count remains saved on this device.'],
  ]]],
  ...fileToolHelp,
  ...mediaHelp,
  ...creativeHelp,
  ...workstationHelp,
  ...linkedToolHelp,
  ...webHelp,
  workflows: [...creativeHelp.workflows,...workflowSettingsHelp],
  'image-editor': [...creativeHelp['image-editor'],imageAdjustmentHelp],
  chats: chatHelp,
  '3d-viewer': modelHelp,
};
