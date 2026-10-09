# Development workflow

## Shared main branch: desktop and laptop

- Use one computer/Codex session at a time for implementation. The shared repository is https://github.com/Basileuspr/Local_AI_Workstation.git; use a normal local checkout with `main` checked out and tracking `origin/main`.
- Before implementation, verify repository identity, effective fetch/push URLs, actual branch, upstream, and working-tree state. Fetch and fast-forward to `origin/main` before new edits. Use repository-local `pull.ff=only` and `push.default=simple`.
- Preserve unexpected existing work and report it; do not silently stash, overwrite, or publish another task's changes. Keep recovery backups outside the repository and recovery branches/stashes local.
- After completing an implementation request, run relevant available tests, review all outgoing commits and files, stage only intended task files, commit, and normally push `main` unless the user explicitly said not to publish. Never upload credentials, private app data, browser sessions, model weights, generated media, or runtime databases.
- Questions, audits, incomplete work, and failing changes do not automatically get committed or pushed. If the remote advances or synchronization fails, preserve work and report the blocker; never force-push.
- After pushing, fetch again and verify local `main` against `origin/main`, including pending uncommitted and unpublished work. Finish with the commit, test results, push status, and whether it is safe to continue on the other computer. That computer must fetch and fast-forward before its next task; do not claim it is verified without checking it.
- Keep dependencies and runtime data local to each computer. Do not use the other computer's GPU/services, a shared network checkout, background synchronization, or automatic committers.
