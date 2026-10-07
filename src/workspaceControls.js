import {chatHelp} from './help/chat';
import {fileToolHelp} from './help/fileTools';
import {mediaHelp} from './help/media';
import {creativeHelp} from './help/creative';
import {workstationHelp} from './help/workstation';
import {modelHelp} from './help/model';
import {workflowSettingsHelp,imageAdjustmentHelp} from './help/workflowSettings';
import {neuralNetworkHelp} from './help/neuralNetwork';
import {linkedToolHelp} from './help/linkedTools';

export const workspaceControls = {
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
  'break-room': [['Help identify faces', [
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
  workflows: [...creativeHelp.workflows,...workflowSettingsHelp],
  'image-editor': [...creativeHelp['image-editor'],imageAdjustmentHelp],
  chats: chatHelp,
  '3d-viewer': modelHelp,
};
