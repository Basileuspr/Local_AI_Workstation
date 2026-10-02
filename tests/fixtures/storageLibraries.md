# Storage libraries verification

The fixture renders the production Dashboard storage component and calls a real,
authenticated backend. It does not mock the storage API or the desktop bridge.

Run Vite with `tests/fixtures/storageLibraries.config.mjs` (port 5186). Start an
isolated backend on port 8140 with `LAW_DATA_DIR` and `LAW_MODELS_DIR` pointing at
temporary folders, `LAW_ALLOWED_ORIGINS=http://127.0.0.1:5186`, and a disposable
`LAW_SESSION_TOKEN`. Open `/tests/fixtures/storageLibraries.html` with matching
`apiPort` and `apiToken` query values. Use only temporary parent folders.

Verified on 2026-10-02:

- Creating two real library folders leaves the original default selected.
- The explicit Use for new files action changes the persisted default.
- Real image-library upload writes image bytes into the selected library while
  the primary app-data folder retains the index.
- Renaming only a synthetic library folder simulates disconnection. Refresh
  shows it unavailable; a new import reports reconnect and creates no fallback.
- Restoring that synthetic folder makes the saved image readable again, including
  after choosing the other library as default.
- The expanded interface was visually inspected at 1280 x 720.

Both synthetic libraries were on the same physical volume. Native Electron
dialogs and actual unplug/replug of physical drives were not exercised. Backend
tests cover path confinement, changed identity, backup staging without the
original library, multiple stores, and PNG generation using a simulated pipeline.
