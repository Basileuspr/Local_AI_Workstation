export const foundationPractice = {
  university: {
    'clear-requests': {
      workspaces: ['chats', 'library'],
      steps: ['Write the revised request in your lesson notes, then Copy practice prompt if you want a local tutor.', 'Paste your own task into a new practice chat, review its goal and constraints, and choose Send when ready.', 'Compare the answer with your stated checks. Save a useful request as an Index entry for later reuse.'],
      checkpoint: 'You can point to a goal, a relevant source, an output format and a verification rule in the request.',
    },
    'tokens-context': {
      workspaces: ['chats', 'dashboard'],
      steps: ['Open Chat options and compare two Response length choices. Inspect the context estimate and budget details.', 'Identify system instructions, recent messages, a rolling summary and Knowledge excerpts in the available breakdown.', 'Return here and calculate the exercise budget before checking your answer.'],
      checkpoint: 'Your 6,656-token input budget accounts for reply and safety reserves. You can distinguish saved history from the context used for one request.',
    },
    'data-types': {
      workspaces: ['spreadsheets', 'local-files'],
      steps: ['Write the book record with a string title, numeric page count and boolean read flag in your notes.', 'Inspect a practice CSV in Spreadsheets and name what one row represents.', 'Compare that flat table with a nested record or a SQLite table in Local Files if you have a practice database.'],
      checkpoint: 'Types, missing values, row meaning and units are explicit before any calculation.',
    },
    retrieval: {
      workspaces: ['knowledge', 'chats'],
      steps: ['Open a practice Knowledge document and inspect its indexed text.', 'In a new practice chat, choose Knowledge → Selected and ask a question the document can answer.', 'Check the response against the exact passage and record what the source leaves unknown.'],
      checkpoint: 'You have a supported passage and understand that retrieval changes supplied context rather than model weights.',
    },
    networks: {
      workspaces: ['neural-network'],
      steps: ['Open Neural Network and its Info & examples guide. Identify inputs, weights, biases and the hidden activation.', 'Reset network, inspect Hidden 1’s weighted sum of 0.750, and compare tanh, ReLU and sigmoid while keeping the other settings fixed.', 'Use Start at inputs and Next layer to follow the values into the output layer. Return here to solve the separate exercise numbers.'],
      checkpoint: 'You distinguish the demo’s default calculation from this lesson’s exercise and can explain why ReLU returns zero for a negative sum.',
    },
    experiments: {
      workspaces: ['chats', 'generate', 'review'],
      steps: ['Pick one supported chat or image setting and write the fixed conditions before running anything.', 'Prepare three neutral questions or image prompts and a scoring rule in your notes.', 'If the runtime is ready, compare the two settings and inspect available settings metadata. Record failures and uncertainty too.'],
      checkpoint: 'Your comparison changes one factor, uses the same cases and retains observations for every attempted run.',
    },
  },
  'agent-university': {
    'agent-loop': {
      workspaces: ['dashboard', 'tools', 'queue'],
      steps: ['Choose a real app capability from Dashboard’s Tool registry and identify its requirements and effects.', 'Write a manual plan → act → observe loop with the exact completion evidence for that tool.', 'Inspect a practice result or queue status before deciding whether to stop or revise the plan.'],
      checkpoint: 'You report observed outcomes rather than equating a started operation with a completed task.',
    },
    permission: {
      workspaces: ['hash-auditor', 'image-manager', 'media-manager'],
      steps: ['Write the exact practice-folder scope and a review-only boundary.', 'Inspect audit or media-plan controls and classify which actions read, prepare or modify.', 'Draft a proposal with candidates and evidence. Keep applying a transfer or deletion as a separate decision.'],
      checkpoint: 'The final deliverable respects the requested effect boundary and identifies what any later operation would need.',
    },
    'tool-contracts': {
      workspaces: ['dashboard', 'tools'],
      steps: ['Read one tool’s actual input schema, output description and prerequisites in Tool registry.', 'List valid inputs, bounded limits and explicit error states in your notes.', 'Map the contract to a real workspace action or Function step; copying a description alone does not enable model execution.'],
      checkpoint: 'Your contract describes a narrow, inspectable action and keeps secrets out of model context and logs.',
    },
    'untrusted-input': {
      workspaces: ['browser', 'knowledge', 'chats'],
      steps: ['Write a fictional source passage containing the hostile instruction from the exercise in your notes.', 'Separate the user’s summarization objective from the source’s embedded command.', 'Draft a response that summarizes the source while retaining the original permissions and data scope.'],
      checkpoint: 'You extract source facts without allowing source text to redefine permissions or request private files.',
    },
    recovery: {
      workspaces: ['queue', 'workflows', 'packager'],
      steps: ['Choose a hypothetical export or workflow timeout and name its output location.', 'Write how to inspect completed outputs and recorded run state before retrying.', 'Define one bounded recovery step and the evidence needed to declare completion.'],
      checkpoint: 'Your plan preserves source data and completed results while distinguishing processing, saving and display failures.',
    },
    evaluation: {
      workspaces: ['image-manager', 'media-manager', 'workflows', 'dashboard'],
      steps: ['Choose one supported workflow and write its normal expected outcome.', 'Add missing-input, unavailable-runtime, cancellation and misleading-source cases.', 'Record which cases you merely designed, simulated or ran against the actual local service.'],
      checkpoint: 'Your evaluation names the tested conditions and does not label a paper exercise as a real runtime validation.',
    },
  },
};
