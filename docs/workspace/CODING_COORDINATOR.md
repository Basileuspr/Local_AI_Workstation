# Coding Coordinator

Open **Design & Programming → Coding Coordinator** in the desktop app. Choose a
local Git repository root, describe a focused change, select an installed Ollama
model, and select checks in **Verification Manager**. Start authorizes source edits;
the separate verification policy controls when checks can execute. The feature
does not commit, push, or deploy.

GPT-OSS 20B is the first target; native tool support is required, rather than a
particular model name. Other installed models can be selected. Capability metadata
does not establish coding quality. The implementer and reviewer use separate
contexts on the selected model, taking turns through the existing GPU queue.

## Verification Manager

Choosing a project inspects its configuration files without executing scripts.
Python, Node.js, TypeScript, Rust and Go projects can supply checks grouped into
tests, lint/static analysis, type checks, build and security. Discovery reads
bounded configuration files in the repository and nested packages. It shows the
command, working directory, source configuration and any npm script definitions,
including pre/post hooks. Missing runners and watch commands cannot be selected.
Recognized Gradle/Maven projects currently need a supported custom or existing
package-script check; there is no direct Java/Android runner recipe.

Review the detected selection before starting. Routine root-level tests, lint and
type checks are preferred; builds and specialized scripts are optional. The final
selection is filtered by changed file language and package directory. This is a
heuristic, not a dependency graph: cross-language effects and integration coverage
still need human judgment. A skipped check is recorded as **Not run**, with its
reason. Custom checks always apply. A run with no applicable checks needs review.

Save a named **verification profile** to reuse the selection, custom commands and
execution policy for this project. Saving a profile does not authorize execution.
Permissions are stored separately:

- **Ask before running checks** asks for each new check definition in a task.
  Approving it permits unchanged repetitions within that task.
- **Automatically run previously approved checks** uses saved grants for this
  project. New or changed definitions still require approval. Approve selected
  detected checks in setup, or choose to remember a grant at an execution prompt.
- **Manual verification only** prevents model-requested execution and waits at the
  end for **Run verification now** or **Finish without verification**. The latter
  records Not run and leaves the task needing review.

Grants include the command, directory, timeout, relevant configuration hashes and
runner identity. The coordinator rechecks them before execution, including after
an approval prompt. Editing a manifest or an explicitly referenced custom script
invalidates its saved grant. These fingerprints are not hashes of all project
code or dependencies. **Forget saved approvals** removes grants for future tasks
without deleting profiles.

**Advanced / custom checks** retains one-command-per-line entry. Examples:
`python -m pytest -q`, `node --test`, or
`node node_modules/vitest/vitest.mjs run`. Quote paths containing spaces. An
absolute virtual-environment Python path selects that environment. Custom checks
accept Python or Node executables from the project root; batch files and shell
pipelines are unsupported. Up to 12 checks can be selected, with a two-minute
timeout per check. Detected Rust/Go checks use fixed runner recipes with dependency
downloads disabled. Dependencies are never installed by the coordinator.

Only run checks in projects you trust. Checks execute project code with your local
account's permissions. Project-path validation is **not an operating-system
sandbox**. Commands have bounded time/output and cancellation; Windows process
descendants are contained in a private Job Object. App/session credentials are
omitted from the environment, and Workstation runtime paths and npm user settings
are redirected to disposable locations. These restrictions do not prevent project
code from reading account-accessible files or using the network. npm scripts may
invoke a shell and arbitrary project code even though the coordinator launches
the Node runner directly. Inspect script definitions and only approve trusted
projects. The model cannot supply a new executable or command.

## Project scope

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

The workspace shows the plan, source diffs, protected files and model review.
**Verification history** distinguishes passed, failed, timed out, cancelled and
not-run checks. Each entry records the command, directory, revision, reason, exit
code, elapsed time and captured output where available. Not run has no exit code
and is never presented as a pass. Applicable selected checks rerun after the last
edits, subject to the selected permission policy.

**Completed** means those final checks passed and the separate reviewer accepted
the change; it does not prove the absence of defects or adequate coverage. Declined
or missing final verification needs review. Inspect the full diff and coverage
before committing or publishing.

Pause and Stop interrupt active work while retaining completed edits and output.
Neither undoes edits. Pause permits Resume. App restart marks unfinished tasks
Interrupted; nothing runs automatically. Resume verifies the commit, index,
protected files and recorded changes, reconciles an interrupted write, and gives
the model a fresh state summary. Uncertain commands are not replayed automatically.

Tasks, source recovery contents, and output stay locally under the configured app
data directory's `coding-coordinator` folder. Profiles and grants live in its
`verification` subfolder. Check runtime scratch directories are retained under the
system temporary directory; their paths are included in command receipts. Treat
these as private project data.
Keep a normal project backup as well. Review budget/context failures before starting
a smaller task; increasing context can substantially increase RAM/VRAM usage.

## Development and acceptance

Services live in `backend/services/coding_coordinator.py`, `coding_project.py`
and `coding_verification.py`.
Native project selection and mutating control use the trusted Electron IPC facade;
the ordinary model tool catalog only advertises the interactive workspace. The
maintenance gate blocks backup/reset while coding is active.

Run `tests/backend/test_coding_coordinator.py` and `test_coding_verification.py`
in isolated runtime directories,
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
