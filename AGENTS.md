# Local AI Workstation development

Read [ARCHITECTURE.md](ARCHITECTURE.md) and the relevant existing source and
[development guidance](docs/development/DEVELOPMENT.md) before implementation.

## Shared main branch: desktop and laptop

- Use one computer/Codex session at a time to change this project. Use each
  computer's normal local checkout with `main` checked out.
- Before implementation, verify the actual project directory, repository root,
  branch, upstream, working tree, and effective fetch/push destinations (including
  redirects). The expected repository is
  `https://github.com/Basileuspr/Local_AI_Workstation.git`; `main` must track
  `origin/main`. Keep repository-local `pull.ff=only` and `push.default=simple`.
- Preserve unexpected existing work and report it before proceeding. Do not
  silently stash, overwrite, discard, or publish another task's changes. Keep
  recovery backups outside the repository and recovery branches/stashes local
  and retained. Fetch `origin`, then fast-forward `main` with
  `git merge --ff-only origin/main` before making new edits. Stop and report
  divergence or synchronization failures without forcing or rewriting history.
- After completing an implementation request, run relevant available tests,
  review every outgoing commit/file, stage only intended task files, commit, and
  normally push `main` unless the user explicitly says not to publish. Never
  publish credentials, private app data, browser sessions, model weights,
  generated media, or runtime databases.
- Questions, audits, incomplete work, and failing changes do not automatically
  get committed or pushed. If the remote advances during a task or synchronization
  fails, preserve the work and report the blocker; never force-push.
- After pushing, fetch again, verify local `main` against `origin/main`, and check
  for remaining uncommitted or unpublished work. Finish with the commit, test
  results (including skips/unavailable checks), push status, and whether the other
  computer can safely continue after fetching and fast-forwarding its own
  checkout. Do not claim the other computer is verified without inspecting it.
- Keep dependencies and runtime data local to each computer. Do not use the other
  computer's GPU/services, a shared network checkout, background synchronization,
  or automatic committers.
