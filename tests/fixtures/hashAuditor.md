# Hash Auditor browser check

Use only temporary fixture files and an isolated application data directory.
The preview calls the real backend. It does not mock scans or start them on load.

Start a backend with `LAW_DATA_DIR` set to a scratch folder, a test-only
`LAW_SESSION_TOKEN`, and `LAW_ALLOWED_ORIGINS=http://127.0.0.1:5187`:

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8139 --lifespan off
npx vite --config tests/fixtures/hashAuditor.config.mjs
```

Open `http://127.0.0.1:5187/tests/fixtures/hashAuditor.html?apiPort=8139&apiToken=YOUR_TEST_TOKEN`.

Create two temporary source folders containing one identical-content pair,
one same-name/size/modified-time pair with different content, and a hard link
when the filesystem supports it. Scan each folder separately. Confirm the
combined SHA-256 group, physical-file count, separate metadata candidates,
literal path search, exclusions, export controls, and saved results after a
page reload. Switching the fixture workspace retains the component and lets
its polling pause while scans continue on the backend.

Native folder selection and streaming download use the desktop preload bridge;
the browser preview accepts pasted paths and uses a browser download fallback.
