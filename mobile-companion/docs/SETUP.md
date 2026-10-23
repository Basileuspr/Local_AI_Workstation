# Mobile companion

The phone interface uses the desktop’s models, queue, sessions and gallery.
The desktop must be running and phone access explicitly started. The gateway is
separate from the ordinary desktop API and starts off after a desktop restart.

## Connect over trusted HTTPS

A phone needs a browser-trusted HTTPS origin. Plain LAN HTTP does not provide
the secure context required for installation/service workers/cookies.

For private Tailscale access:

1. Install/sign in to Tailscale on your intended private desktop and phone devices.
2. Configure private Serve to proxy HTTPS to `http://127.0.0.1:8766`, typically
   `tailscale serve --bg http://127.0.0.1:8766`. Inspect `tailscale serve status`;
   do not enable Funnel.
3. In Dashboard → Mobile companion, enter the exact HTTPS origin reported by
   Serve, leave listen address 127.0.0.1 / port 8766 and certificate paths blank.
4. Start mobile connection and open that address from the phone on the VPN.

The app does not install/configure Tailscale or change firewall rules.
[Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) and its
[HTTPS guidance](https://tailscale.com/docs/how-to/set-up-https-certificates)
cover host setup and public certificate-name disclosure. Use your actual origin.

Direct private LAN HTTPS instead requires a specific private IPv4 address and
certificate/key trusted by the phone. Broad 0.0.0.0/public binds are rejected.
Do not expose Ollama/the ordinary API or bypass certificate errors. IPv6 and
arbitrary proxy hostnames are outside this gateway’s supported configuration.

## Pair and disconnect

Create a desktop invitation and scan its QR or enter the displayed code.
Choose browser connection or **Open Android app to pair**, then supply a device
name and Connect in that client. Scanning alone does not authorize access.
Browser and Android cookies are separate.

Invitations are single-use, expire after five minutes and are replaced by a new
invitation. QR generation is local; the invitation fragment is removed before
rendering and is not an HTTP query parameter.

Use the desktop’s device controls to revoke access or stop the connection.
A revoked/disconnected client must reconnect through the supported flow.
Phone access does not grant arbitrary desktop filesystem access.

## Chat, images and gallery

Select saved/new chats, an installed chat model and response controls. Exact
response limits and thinking follow the [shared chat contract](../../docs/chat/CHAT_GUIDE.md).
Code blocks provide touch-friendly Copy code.

**New** asks for a conversation name. **Rename** updates the selected conversation's
name on both phone and desktop, preserving its messages and images. A stale rename
asks you to reload/retry rather than overwriting newer work.

You can queue more chat or image jobs in the same conversation. Jobs in that
conversation run in acceptance order; each chat turn uses the completed history
when it starts. Prompts for waiting turns remain in Jobs until their turn begins.
The composer becomes available after acceptance. Text typed while an earlier
submission is being acknowledged stays in the draft.

Choose an image model and supported settings separately. Accepted image jobs
continue on the desktop after a phone disconnect or hosted-interface update.
A pending/unconfirmed submission is different from an accepted job; resolve it
before retrying to avoid ambiguity. Desktop/backend restart interrupts active work.

**Batch requests** reuses the desktop image count, seed, steps and guidance controls.
Preview up to 32 images, then choose **Queue batch**. The batch is accepted together
as one job; its prompts and settings stay available. The phone queue accepts up to
eight outstanding jobs and 32 pending images across paired phones. An oversized
batch is rejected before any of its images start.

Jobs shows each image's progress and offers **Cancel image** or **Cancel batch**.
Cancelling a waiting turn prevents it from starting. Completed images remain saved
when another image fails or is cancelled. Disconnects do not cancel accepted work;
after an interruption, inspect the conversation and Gallery before submitting anew.

Gallery supports original-image viewing, gestures, download and supported sharing.
The native Android viewer and a browser have different platform capabilities.
Private API responses/media are excluded from the shell’s offline cache; pairing
does not mean private work is available offline.

## Character intake

Open **More tools → Character profiles**, choose **New character** or a saved
profile, and edit its name, biography, notes and tags. **Save character** writes
explicitly to the desktop's character store. Drafts stay in memory while moving
between the four core tabs. Save or discard edits before choosing another profile.

Desktop changes are checked before saving. A conflict preserves your phone draft;
copy any text you want to keep, then use **Discard edits and reload** to load the
current saved values before editing again.

Under **Image references**, link visible Saved Images from the desktop library.
Tap a linked image for the shared pinch/zoom viewer. **Unlink reference** removes
the association and keeps the original file. Hidden, locked or missing images
become unavailable placeholders; their associations are retained. Use the desktop
library to make additional reference images available.

Profile intake is separate from generation and training. Existing desktop-only
references stay in their owning workspaces. Raw phone uploads and LoRA management
are outside this intake screen.

## Hosted interface updates

Dashboard → Mobile companion → **Update phone app** builds the current hosted
interface and publishes an immutable checked version. It can run while phones
are connected. A failed build retains the previous version.

Phones see Update ready and apply it explicitly. Drafts require keep-editing or
clear-and-update confirmation; unresolved submissions must be resolved first.
Accepted jobs continue. The desktop reports connected clients’ acknowledged
versions. This button does not start access, change settings or install an APK.

Backend changes require a desktop restart first. Native shell changes require a
new APK. A normal `npm run build` replaces dist, including phone releases, so
finish active work and close connected phones before that developer workflow.
`npm run build:mobile` builds only the hosted client.

## Android installation and Tailscale helper

Native source and build/install instructions are in
[mobile-companion/android/README.md](../android/README.md).
Install a newly signed APK over the existing app to retain pairing/address; use
the same signing identity and do not uninstall first. Then update/start the
desktop connection and update the hosted interface as needed.

Companion 0.3.0 provides **Connect Tailscale automatically** for saved .ts.net
addresses. Opening/returning can request Tailscale connection when no VPN is
active. Initial sign-in and Android VPN consent still happen in Tailscale.
An active VPN is left alone; the shell cannot establish who owns it.

Manual Connect Tailscale is available in connection settings and failure controls.
Missing Tailscale offers installation help. Disable automatic connection to manage
it manually. This is a foreground helper, not an always-on VPN.

After returning, network-failed pages retry within a bounded interval/count while
VPN is present. A loaded page retains drafts and refreshes through its ordinary
foreground behavior. A VPN transport does not prove desktop reachability.

## Acceptance boundary

Automated browser/native checks are recorded in
[verification](../../docs/development/VERIFICATION.md). They do not prove a physical phone’s
APK upgrade, VPN intent delivery, certificate trust, sharing/storage behavior or
real provider/GPU inference. Test those on the intended device after installation.
