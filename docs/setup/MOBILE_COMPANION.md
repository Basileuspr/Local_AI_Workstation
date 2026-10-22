# Mobile companion

Workstation Companion is a phone PWA with Chat, Create, Gallery and Jobs views.
The desktop owns model execution, the shared GPU queue, conversations and media.
Access stays **off after every desktop restart** until explicitly enabled in
**Dashboard → Mobile companion**. The PC bridge and normal desktop API retain
their existing access rules.

## Build and start

Run `npm run build` to build both desktop and phone clients. `npm run build:mobile`
rebuilds only the phone client. Fully quit and restart Electron after backend or
Dashboard changes. Do not rebuild while a phone is using an old application bundle.

### Update the phone from the desktop

In **Dashboard → Mobile companion**, choose **Show mobile controls**, then
**Update phone app**. The desktop compiles the current phone source with its
installed Node/Vite dependencies and publishes a checked, complete version.
This button can run while phones are connected. A failed build leaves the
previous version available, and the panel reports the outcome.

Open phones see **Update ready from your desktop**. Tap **Update phone app** on
the phone to apply it. If prompts are still on the page, choose to keep editing
or explicitly clear them and update. An unconfirmed submission must be resolved
first. Accepted jobs continue on the desktop; the update does not restart or
cancel them. Disconnected phones receive the latest version when they reconnect.
The desktop shows which recently connected phones report the available version.

Reopen an older phone app once after installing this feature to receive update
support. The current Android APK loads this same phone interface and can use these
updates. Changes to the native Android shell or its permissions still need a new
APK installation. Backend changes require a desktop restart after active work
finishes; the update button detects changed backend source and asks for that
restart first. It never starts phone access or changes connection settings.

Updates are stored as immutable versions under `dist/mobile-releases`, with an
atomic `dist/mobile-current.json` pointer. Previous versions remain available for
open phones. A normal full production build replaces `dist`, so continue to close
phones before that developer workflow. Build diagnostics stay in the desktop's
private `mobile/client-update.log`; update files contain only the application
shell, not chats, images, credentials or desktop paths. The worker caches only
versioned shell files; [worker activation](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerGlobalScope/skipWaiting)
never forces an open page to reload.

A phone needs a browser-trusted HTTPS origin. Plain LAN HTTP does not provide
the secure context needed for installation, service workers and secure cookies.
See [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

### Private remote access using Tailscale Serve

This setup requires explicit approval and your own signed-in private VPN devices.
The application does not install or configure Tailscale. Perform these steps only
as part of an approved setup; the progress log records what has actually been done.

1. Install and sign in to Tailscale on the desktop and phone using your intended
   private tailnet. Review its device-access rules and restrict access to devices
   you control. Enabling HTTPS certificates makes the device's certificate name
   visible in public certificate-transparency logs; choose its name accordingly.
2. On the desktop, configure **Tailscale Serve**, using its current instructions,
   to reverse proxy HTTPS to `http://127.0.0.1:8766`. The usual command is
   `tailscale serve --bg http://127.0.0.1:8766`. Inspect `tailscale serve status`
   and ensure the service is private to your tailnet. Do not enable Funnel.
3. In Dashboard → Mobile companion, enter the exact HTTPS origin reported by
   Serve, such as `https://desktop.your-tailnet.ts.net` (no path). Keep listen
   address `127.0.0.1` and port `8766`; leave certificate paths blank.
4. Choose **Start mobile connection**. Open the HTTPS address on the phone while
   connected to the VPN. Resolve certificate or connectivity errors before pairing.

[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) is designed
to share a local service within the private tailnet. Its separate
[HTTPS guidance](https://tailscale.com/docs/how-to/set-up-https-certificates)
explains certificate-name disclosure. VPN account setup and actual device/network
reachability require verification on your devices.

### Direct private LAN HTTPS

Use a specific private IPv4 address, an unused port, and certificate/private-key
files for that IP address. The phone must already trust the issuing certificate
authority. Enter an exact origin such as `https://192.168.1.20:8766` and the same
address/port in the desktop panel. Broad `0.0.0.0` and public-address binds are
rejected. Any firewall rule or phone certificate-trust installation requires
separate review; the application never performs it.

Do not expose the normal desktop API or Ollama, forward router ports, or bypass
browser certificate warnings to make phone access work. IPv6 and arbitrary
reverse-proxy hostnames are not supported by this first gateway.

## Pair, install and disconnect

Create a phone invitation in the desktop panel and scan its QR with the phone's
camera. The HTTPS page fills the invitation in; choose **Connect to desktop**
for browser use, or **Open Android app to pair** for Companion 0.2.0 and newer.
The Android handoff names the app's exact package and asks before opening the
specified desktop. Browser and Android cookies remain separate. Older APKs can
still use the displayed invitation code manually. Enter a device name and tap
Connect inside the chosen client; scanning alone does not grant access.

QR generation uses the installed local `qrcode` dependency, with no external QR
service. The secret travels in the HTTPS fragment, which is removed from the
current history entry before rendering. It is never sent in an HTTP URL or saved
in local storage. The invitation is single-use and expires after five minutes.
A new invitation invalidates the previous one. The desktop clears used/replaced
invitations on its next four-second status poll and uses the server expiry for
its countdown. Restarting the listener invalidates outstanding invitations.

Connection settings are saved locally after Start and restored after a restart;
phone access still requires explicitly choosing **Start mobile connection**.
The Android app also retains its chosen desktop address across launches.

Phone access uses a secure HttpOnly same-site cookie and lasts up to 30 days.
The desktop retains only a hash of that credential. The PWA does not place
credentials, chats or images in local/session storage or service-worker caches.
Only its application shell is available offline. When disconnected, backgrounded
or revoked, rendered private results and image viewers are cleared. Reconnection
and returning to the foreground trigger fresh requests; cancelled or superseded
responses cannot restore older conversations. Unsent prompts remain in memory
across temporary outages; explicit disconnect/revocation clears them.

While visible, chats/jobs refresh every two seconds, gallery results every five
seconds, and model availability every 30 seconds. Failed reads clear their old
results and retry with bounded backoff (up to 30 seconds); network/foreground
signals retry immediately. Metadata and image APIs use `no-store`, and the worker
caches only the shell. These bounded refresh intervals are not instantaneous
cross-device synchronization. Accepted work stays on the desktop, and an
unconfirmed submission retries with its original ID to prevent duplicate jobs.

Use your browser's **Install app** / **Add to Home screen** on Android. On iPhone,
open the address in Safari and choose **Share → Add to Home Screen**. Install
support and native file sharing depend on the phone/browser; test them on your
device. A browser-to-installed-app transition may require pairing again if it
uses a different cookie store.

**Disconnect this phone** revokes its access. The desktop can revoke any named
phone. Revocation stops future requests and active observation streams; it does
not erase downloaded files or cancel already accepted desktop jobs. Finish or
cancel jobs before stopping the listener. Stop Mobile companion before backup,
reset or import; desktop maintenance enforces this boundary.

## Chat and image generation

Choose an existing conversation or create a new one. Chat uses the chosen
desktop-hosted model, streams response snapshots and appends the result to the
same desktop conversation. Concurrent desktop edits are preserved; a changed
revision requires refreshing before a new chat submission. This first client
passes text conversation history, with no attachment upload, Knowledge retrieval,
durable-memory lookup or desktop tool execution.

In **Create**, choose an installed image model, prompt, optional negative prompt,
compatible LoRA and strength, and long-prompt encoding. Canvas ratios, dimensions,
resolution, steps, guidance and seed reuse the desktop's controls and hardware
limits. The default canvas is 1024 × 1024, with 24 steps and guidance 5.5.
Both prompts and all selected settings remain after each generation so you can
adjust them and run again. Create stays open after submitting an image. Use
**Queue another image** to add more to the same conversation while earlier images
are pending; **View jobs** shows their progress and cancellation controls.
Image prompts append to the latest conversation without replacing arriving
results or desktop edits. The existing desktop queue serializes generation.
Chat requests still wait for that conversation's active jobs to finish, and an
active chat response blocks new image submissions until it finishes.
Reference uploads, batch tools and desktop filesystem destinations remain
desktop workflows.

A successful image is saved to the selected conversation and appears in Gallery
and the desktop Generate output without opening Gallery. Generate also observes
phone job progress and can cancel it. An active desktop batch keeps its output
slots; the phone result joins generation history. Clear suppresses late output
from phone jobs already observed, without deleting saved images or stopping work.
Generation uses the existing image-task service and GPU coordination; no models
are downloaded or copied.

The desktop observes mobile changes approximately every three seconds while
visible. Both chat panes refresh additive results when idle, preserving active
desktop streams and local edits. Reload a conversation explicitly if an edited
local copy prevents an automatic refresh.

Jobs continue after the phone sleeps, reloads or disconnects. On reconnection,
the client fetches authoritative history and job status. If submission delivery
is uncertain, **Retry same submission** keeps the original job ID. Do not create
a replacement job just because a connection was lost. After a page reload, check
Jobs for accepted work before resubmitting a prompt.

The desktop must remain awake and running. A desktop restart retains completed
jobs and marks unfinished ones **interrupted**, preserving saved partial chat
output in the job record. Computation is not checkpointed or automatically replayed.
Cancellation is pending until desktop confirmation. **Dismiss job** removes a
finished entry from the visible job history while retaining a deduplication
receipt; it does not delete the conversation or image. At most eight mobile jobs
may be outstanding and 200 remain visible in history.

## Gallery, originals and sharing

Gallery combines visible chat images and Saved Images and starts with **Newest
first**. Images within the same conversation keep their message/image order,
so a newly generated image appears before older images in that chat. Choose
**Oldest first**, **Name A–Z** or **Name Z–A** to change the order.

Search by image name or conversation title. **Filter images** offers Chat images
or Saved Images, a specific conversation, and the last 24 hours, 7 days or 30 days.
Date filters use the conversation's latest activity date for chat images and the
save date for Saved Images; historical chat images do not have individual dates.
Filtering and sorting apply to the whole gallery before paging. Filters remain
selected when switching phone tabs, until cleared or the app page reloads.
**Clear filters** restores all images and Newest first. **Refresh images** reloads
page one, and page navigation returns to the gallery controls at the top.

Gallery loads thumbnails and excludes hidden, locked and review-only images.
Tap an image in Gallery or a conversation to open its original bytes in the same
full-screen viewer. **Pinch to zoom** up to 8× the fitted view and drag to move
around the enlarged image. **Zoom in**, **Zoom out** and **Fit** also work without
gestures. Opening another image or rotating the phone returns to the fitted view.
**Download original** keeps the full
resolution. **Prepare to share** retrieves the original file; tap **Share image**
once it is ready to invoke the phone's native share sheet. If file sharing is
unsupported, download and share from the phone's file app.

Image authorization is checked again when bytes are requested; an older gallery
page cannot bypass a newly applied vault lock. There is no phone vault-unlock,
arbitrary-file, shell, reset, backup or maintenance endpoint.

## Verification and current limits

### Android device acceptance

Install [Tailscale for Android](https://tailscale.com/docs/install/android), sign
in with the same account as the desktop, and connect the VPN. Use Chrome for the
first phone test. Keep the desktop application running and awake during testing.

1. On home Wi-Fi, open the exact private HTTPS address from the desktop panel.
   Confirm it opens without a certificate warning, then pair using a fresh
   desktop invitation. In Chrome's menu, choose **Add to Home screen** or
   **Install app**, and open the installed companion. Pair again if requested.
2. Open or create a test conversation, choose an installed chat model, and send a
   short message. Confirm streamed text appears and the same completed turn is
   visible on the desktop. Reload the phone page and confirm history remains.
3. In **Create**, choose an installed model and a small supported canvas for a
   test image. Submit once, then lock the phone while it runs. Unlock and reopen
   the companion: the same job should show progress or its completed result,
   with one generated image rather than a duplicate submission.
4. Find that result in **Gallery**, open it, and choose **Download original**.
   Open the downloaded file in the phone's file/gallery app and confirm its pixel
   dimensions match the generation settings. Choose **Prepare to share**, then
   **Share image**, and verify the native share sheet opens; cancel it if no
   actual sharing is intended.
5. Turn phone Wi-Fi off while leaving Tailscale connected. Over cellular data,
   reopen the companion and repeat a short chat and original-image download.
   Restore Wi-Fi afterward. Record Wi-Fi and cellular results separately.
6. Temporarily disconnect the phone's VPN and confirm the companion reports the
   lost connection. Reconnect it and confirm state recovers. Finally revoke the
   test phone from the desktop and confirm further API access requires pairing.

Record each observed result in the roadmap. Do not mark installation, native
sharing, sleep/reconnection or remote access as verified from desktop emulation.

### Automated and local inference checks

See the [roadmap and progress log](../development/MOBILE_COMPANION_ROADMAP.md)
for current evidence and remaining work. Reproducible checks include:

- `npm test -- tests/frontend/mobileApi.test.js`
- `npm run test:backend -- tests/backend/test_mobile_companion.py`
- `npm run test:backend -- tests/backend/test_mobile_updates.py`
- `npm run build:mobile`, then
  `node_modules\.bin\electron.cmd scripts\qa-mobile-companion.cjs`
- Set `LAW_MOBILE_UPDATE_QA=1` for the same Chromium walkthrough plus a real
  desktop-triggered build from temporary source, phone update confirmation,
  version acknowledgment, pairing retention and failed-build recovery.
- Optional real inference, only while the desktop is idle:
  `venv\Scripts\python.exe scripts\qa-mobile-inference.py --chat-model <installed-model> --image-model <installed-image-id>`

The inference script uses temporary app data and installed model weights, opens
no listener, and reports the directory containing results. Chromium QA uses a
temporary HTTPS fixture and synthetic inference. Neither substitutes for actual
phone installation, VPN/LAN connectivity, mobile sleep/reconnect and native sharing.
