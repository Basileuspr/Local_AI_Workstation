# PC bridge: manual delegation

The first bridge release connects two running copies of Local AI Workstation.
Either PC can delegate a standalone chat prompt or base-model image generation
to the other, while continuing its own local work. It does not combine GPU
memory or split one inference across machines. Automatic routing, batch splitting,
training delegation and synchronized workspaces are not implemented in this release.

## Update both PCs

Fully quit the app from its system tray. In the GitHub checkout on the laptop:

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
npm start
```

For an already configured development checkout containing this update, use
`npm run build` and then `npm start`. Rebuild and fully restart both apps after
updating; closing a window can leave its previous backend in the tray.
The bridge's HTTPS support uses the cryptography package already in the core
requirements. No extra networking service or cloud account is needed on a LAN.

## Pair once

1. Connect both PCs to the same private network. On each PC, run `ipconfig` in
   PowerShell and find the active Wi-Fi/Ethernet adapter's IPv4 address.
2. Open **Dashboard > PC bridge** on each PC. Give each a recognizable name,
   enter its own private IPv4 address, leave port **8765**, and click **Start bridge**.
   Both PCs can use the same port because they have different addresses.
3. If Windows Firewall asks, permit this app's Python environment on the
   private network. The app does not change firewall rules or require public
   internet exposure. If no prompt appears and pairing times out, check that
   Windows Defender Firewall allows this Python environment/TCP port on the
   private profile, scoped to your other PC. Guest Wi-Fi may block peer traffic.
4. On one PC click **Create pairing invitation**, then **Copy invitation**.
   Transfer it privately to the other PC and paste it under **Pair with another PC**.
   Click **Pair PCs**. This authorizes task delegation in both directions.

Invitations expire after five minutes and approve only one peer identity.
Creating another invitation invalidates the previous invitation. Paired credentials
persist, but the listener starts **off on every app launch**. Start it explicitly
on each PC when needed. Keep the same addresses/ports, or pair again after they
change. A private VPN address can also be entered; this release accepts private
IPv4 literals, including the 100.64.0.0/10 range. No router port forwarding is needed.

## First test

On the submitting PC, choose the paired PC under **Run on**, click
**Check models and availability**, select **Chat prompt**, choose an exact model
from the worker, enter a short prompt, and click **Send task to selected PC**.
Ollama must be running on the worker with that chat model installed.

The request appears under **Bridge jobs** on both PCs. The worker uses the same
local Prompt Queue and GPU handoff as its own requests. The submitting PC
retrieves the completed result automatically while its bridge is running.
Click **View result**, then **Save result to Chats** to create a separate local
chat. Saving the same result again never overwrites later edits in that chat.
Image results can also be downloaded as PNGs. Repeat in the opposite direction
to verify both PCs can act as workers.

For **Generate image**, the worker must have a working CUDA image runtime and a
compatible local base model. Choose size and steps explicitly. Models are neither
downloaded nor copied, and the bridge never substitutes another model. Catalog
IDs identify the worker's models; this release does not certify matching model
weights between machines. Availability and RAM/VRAM readings are snapshots, not
guarantees that a workload fits.

Only the submitted prompt and generation settings are sent. Existing chat
history, attachments, knowledge collections, memories, LoRAs and datasets are
not transferred. Remote chat does not use the worker's memories or knowledge
base. Prompts/results are private app data retained on both PCs until cleared;
the worker may also retain generated PNGs and its normal thinking/log output.

## Failure and recovery

- Network loss displays an unknown execution status. It does not start a
  replacement job. Reconnect/start the bridge to retrieve the original job.
- **Retry delivery with same ID** safely resends an uncertain submission; the
  worker deduplicates it. It cannot restart a completed, failed or interrupted job.
- Cancellation is a request until the worker confirms its computation has
  stopped. A cancellation received before a delayed submission also prevents
  that submission from executing.
- A worker restart marks unfinished incoming jobs **interrupted**. It does not
  replay them. A sender restart preserves its job IDs and saved results.
- Closing the app/PC during generation can still interrupt computation. Keep
  both PCs awake and apps running. This release has no checkpoint migration.
- Model absence, runtime failure or insufficient memory produces a failed job;
  check the worker's local logs and correct the cause before submitting a new job.
- **Revoke access** blocks that peer's new requests. Finish/cancel incoming work
  first. Re-pair to restore access. Revocation does not erase previously transferred data.
- Clear completed worker results only after retrieving them. The worker retains
  small request receipts to prevent duplicate execution. Each direction allows
  eight outstanding jobs and 200 uncleared history entries; clear finished
  results when that limit is reached. Individual requests/results are bounded.
- Stop the bridge before backup, reset or import. A private app backup includes
  bridge credentials and job content. Do not restore the same identity onto a
  second concurrently running PC; pair independent installations instead.

## Security and verification

The normal desktop API remains loopback-only with its per-launch session token.
A separate HTTPS listener accepts only pairing, capability discovery, bounded
job submission/status and cancellation. It has no file-browser, arbitrary
command, generic API proxy, reset or update interface. Certificate trust is
pinned through the invitation, and each peer has its own revocable credentials.
Browser origins, URL credentials and public/DNS endpoints are rejected. Image
results are checked as bounded PNGs; locked-image access remains enforced.

Automated coverage includes two real HTTPS listeners, bidirectional pairing and
jobs, wrong-certificate rejection, lost acknowledgments, deduplication, restart
records, cancellation, peer ownership, request limits and saving results once.
Chat/image adapters are exercised through the real local routes and shared
queue with inference mocked. Headless UI QA exercises the Dashboard controls
with mocked network responses. This does not establish actual two-PC firewall,
Wi-Fi or GPU performance; run the short chat test above on your machines first.
