# Workspace Info preview

Run `node node_modules/vite/bin/vite.js --config tests/fixtures/workspaceInfo.config.mjs`, then open `http://127.0.0.1:5283/tests/fixtures/workspaceInfo.html`.

This preview uses the real AppLayout, Info guides, store, and Shortcut Registry. Other workspace bodies are draft fields; the LoRA field exercises the live learning-rate hook. It does not test local inference or Electron native browser surfaces.

Browser checks completed on 2026-10-02:

- All 31 registered workspaces opened their matching guide from the header Info button. Every guide contained controls/settings and an example; Close returned focus to the correct trigger.
- Escape closed Chats and pinned Shortcut Registry help and restored focus.
- A chat draft survived opening help and switching tabs.
- A learning rate changed to 0.0002 appeared as `2e-4 · 2× the default` in LoRA help.
- The existing modal context covered the simulated embedded Media Manager surface while its guide was open.
- Pinned Shortcut Registry had its own working Info button; Unpin continued working.
- The header button appeared at the far right. The guide was centered and scrollable with a visible sticky Close control.

Automated checks additionally cover every registered route, migrated guides, detailed Generate and LoRA settings, and retained functional disclosures.
