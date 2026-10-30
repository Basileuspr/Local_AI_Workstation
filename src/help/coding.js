export const codingOverview = {
  purpose: 'Use a local tool-capable model to inspect a Git project, plan a focused change, edit source, run configured checks, and review the resulting diff.',
  example: 'Choose a trusted Python project, request a small bug fix, configure python -m pytest -q, and start. Inspect the changed files, actual check output, and separate model review before publishing.',
};
export const codingHelp = [['Coding task', [
  ['Choose project', 'Select the Git repository root through the desktop dialog. Pre-existing modified, staged and untracked files are protected. One coordinator writes at a time; an external change stops the task for review.'],
  ['Local model', 'GPT-OSS 20B is the initial target. Other installed Ollama models with native tool support can be selected. Reported capabilities are not a successful coding benchmark. Implementer and reviewer use separate contexts with sequential inference.'],
  ['Check commands', 'Enter one to six commands, one per line. Quote paths containing spaces. Commands run directly without a shell, for up to two minutes each. Use Python or Node executables, not batch files or shell pipelines. Checks run project code with your local account permissions; this is not an OS sandbox.'],
  ['Start coding task', 'Authorizes source edits and the configured checks in this project. Each edit requires the current file hash. The model cannot choose commands, install packages, commit, push, delete files, or edit project instructions. Text files up to 128 KB and at most 20 edited files are supported.'],
  ['Pause / Stop / Resume', 'Pause or Stop cancels active inference/check work and keeps completed changes and output. Resume is available after pause or app interruption, rechecks project state and never replays an uncertain command automatically. Stopping does not undo edits.'],
  ['Results', 'Completed requires all configured checks on the final edits and acceptance by a separate model review. Both can miss defects. Review the diff and test coverage yourself. Git publication remains a separate action following the project instructions.'],
  ['Run limits', 'Keep context modest on smaller GPUs. GPT-OSS 20B may use CPU/RAM offload. Exhausted context or model-round budgets stop the task with its existing evidence retained.'],
]]];
