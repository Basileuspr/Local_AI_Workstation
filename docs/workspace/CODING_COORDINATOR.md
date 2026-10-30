# Coding Coordinator

Open **Design & Programming → Coding Coordinator** in the desktop app. Choose a
local Git repository root, describe a focused change, select an installed Ollama
model, and configure one or more checks. Start authorizes source edits and those
checks in the selected project. The feature does not commit, push, or deploy.

GPT-OSS 20B is the first target; native tool support is required, rather than a
particular model name. Other installed models can be selected. Capability metadata
does not establish coding quality. The implementer and reviewer use separate
contexts on the selected model, taking turns through the existing GPU queue.

## Checks and project scope

Enter one command per line, quoting executable or argument paths containing spaces.
Examples: `python -m pytest -q`, `node --test`, or
`node node_modules/vitest/vitest.mjs run`. An absolute virtual-environment Python
path can select a project's installed dependencies. This milestone supports Python
and Node executables. Checks run from the project
root, without a shell, with a two-minute timeout. Batch files and shell pipelines
are unsupported. Dependencies are not installed automatically.

Only run checks in projects you trust. Checks execute project code with your local
account's permissions. Project-path validation is **not an operating-system
sandbox**. App/session credentials are omitted from the command environment, but
that does not prevent trusted project code from reading files available to your
account. The model cannot supply a new executable or command.

The coordinator reads applicable `AGENTS.md` instructions, keeps a task plan,
applies exact text replacements with file-hash preconditions, and records original
contents before edits. Existing modified, staged, and untracked files are protected.
Links, junctions, hard-linked edit targets, credentials, runtime/model folders,
binary files, deletion, and edits to `AGENTS.md` are outside this milestone.
Source files are limited to 128 KB, with at most 20 edited files per task.

A process lock permits one coordinator writer per project. Changes made by other
editors are detected before further writes/checks; stop other writers before
starting. This cannot prevent an unrelated editor from racing an operation.
Project Git instructions still govern later publication; for this repository,
use the normal `main` checkout and its one-writer workflow.

## Results and recovery

The workspace shows the plan, source diffs, actual command output and exit status,
protected files, and model review. Final checks rerun after the last edits.
**Completed** means the configured checks passed and the separate reviewer accepted
the change; it does not prove the absence of defects. Inspect test coverage and the
full diff before committing or publishing.

Pause and Stop interrupt active work while retaining completed edits and output.
Neither undoes edits. Pause permits Resume. App restart marks unfinished tasks
Interrupted; nothing runs automatically. Resume verifies the commit, index,
protected files and recorded changes, reconciles an interrupted write, and gives
the model a fresh state summary. Uncertain commands are not replayed automatically.

Tasks, source recovery contents, and output stay locally under the configured app
data directory's `coding-coordinator` folder. Treat these as private project data.
Keep a normal project backup as well. Review budget/context failures before starting
a smaller task; increasing context can substantially increase RAM/VRAM usage.

## Development and acceptance

Services live in `backend/services/coding_coordinator.py` and `coding_project.py`.
Native project selection and mutating control use the trusted Electron IPC facade;
the ordinary model tool catalog only advertises the interactive workspace. The
maintenance gate blocks backup/reset while coding is active.

Run `tests/backend/test_coding_coordinator.py` in isolated runtime directories,
the frontend coding and navigation tests, and
`node scripts/qa-coding-coordinator.cjs` for an isolated Electron fixture.
For an explicitly requested real-model run, use:

```powershell
python scripts/qa-coding-coordinator.py --live --compare --output <new-outside-repository-folder>
```

The live harness creates disposable Git projects, verifies actual checks and
preservation of a pre-existing edit, and optionally compares the same task without
the separate reviewer. It never targets the workstation source checkout. This
small acceptance task establishes the tool workflow, not broad coding proficiency.

See [development](../development/DEVELOPMENT.md) for shared-checkout rules and
[verification](../development/VERIFICATION.md) for observed results.
