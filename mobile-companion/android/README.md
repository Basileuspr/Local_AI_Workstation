# Workstation Companion for Android

This is the native source for Companion **0.3.0** (version code **3**), now kept
with the desktop and phone web application. It requires Android 10 or newer,
targets API 36, and contains no native ABI-specific libraries. The application ID
is `com.localai.workstation.companion`.

The APK opens the desktop-hosted phone interface in Android WebView. Chat,
Create, Gallery and Jobs follow that interface; inference and saved work stay on
the desktop. Native features include QR pairing handoff, original-image saving
and sharing, back navigation, and the Tailscale connection helper.

## Install or update in the right order

1. On the desktop, finish active jobs before any required app restart. Open
   **Dashboard → Mobile companion** and start its connection. Keep the desktop
   awake. Its normal API must remain on loopback.
2. Keep Tailscale signed in and connected on both devices when using the private
   `.ts.net` address. Use the exact HTTPS address displayed by the desktop.
3. Transfer the signed APK to the phone and open it. **Install over the existing
   Companion; do not uninstall or clear its data.** Android requires the same
   application ID and signing identity for an update. If Android reports a
   signature conflict, stop and obtain the correctly signed APK. Do not solve
   that conflict by deleting the existing installation.
4. Open Companion. Its saved address and pairing should remain after an upgrade.
   For a fresh installation, enter the desktop HTTPS address, create a fresh
   invitation on the desktop, scan its QR with the phone camera and choose
   **Open Android app to pair**. Confirm the address, then connect inside the app.
   Pairing in Chrome does not pair the APK's separate cookie store.
5. After a hosted-interface update is published through **Update phone app** on
   the desktop, accept it inside the phone interface when your draft is ready.
   This updates web code only. Native shell changes require a new APK.

Normal installation does not need USB debugging. Android may ask whether your
chosen file-transfer application may install the APK. Respect device policy and
do not bypass certificate errors. There is no private desktop address, pairing
code, credential, model or user data embedded in this source or APK.

## Tailscale and native controls

**Connect Tailscale automatically** defaults to on and persists on the phone.
For a `.ts.net` desktop with no active VPN, opening/returning to Companion opens
Tailscale and requests a connection through its explicit exported receiver.
Sign-in and initial Android VPN approval still happen in Tailscale. Return to
Companion afterward. An active or unknown VPN is left alone; Android does not
tell Companion which application owns it.

The native connection menu and setup/error screens also offer **Connect
Tailscale**. Older Tailscale versions fall back to opening its own controls.
Missing Tailscale offers installation help. Automatic requests have a cooldown
and do not repeatedly reopen Tailscale after an unsuccessful attempt. Recovery
retries only a failed main page, at most three times in twenty seconds. A loaded
page retains its draft and refreshes on returning to the foreground.

**Download original** writes to Downloads / Workstation without general storage
permission. **Prepare to share / Share image** opens Android's share sheet with
temporary read access to one app-owned image. Transfers keep TLS checks, reject
redirects, accept only validated original-image routes and PNG/JPEG/WebP/GIF, and
stop at 64 MB. Temporary share files expire after 24 hours on a later app launch.
Android Back closes the image viewer before navigating or backgrounding the app.

Connection settings and reload discard unsent text; accepted desktop jobs keep
running. **Forget this desktop** clears local address and pairing. Revoke the
device in the desktop panel to revoke its server authorization too. App backup
and device transfer are disabled for pairing data.

## Build and validate on Windows

From the repository root, with the local toolchain already prepared:

```powershell
npm run test:android
npm run qa:android
npm run build:android
```

The first command runs JVM tests and release lint without accessing signing
material. Adapter QA uses the repository Electron runtime with synthetic data.
The build repeats native checks, compiles, aligns and signs the APK, verifies the
signature and alignment, and writes `output/SHA256SUMS.txt`. The output filename
comes from `app/build.gradle`. Output and Gradle caches are ignored by Git.

For a new local build environment, review and run:

```powershell
python mobile-companion/android/tools/prepare-toolchain.py
```

This downloads checksum-pinned JDK, Gradle and Android command-line tools under
`%LOCALAPPDATA%\LocalAIWorkstation\AndroidToolchain`, installs API 36/build-tools
36.0.0/platform-tools and accepts the SDK licenses. It requires Python 3.11+ and
Windows curl. It does not change global PATH or Java. The build script uses that
local Gradle directly; no binary wrapper JAR is included in Git.

The persistent release key stays in
`%LOCALAPPDATA%\LocalAIWorkstation\AndroidSigning\companion-release.p12` with a
Windows DPAPI-protected password. Preserve this private key and a recoverable
backup; never publish it or generate a replacement for an existing installation.
A different PC's fresh key cannot update an APK signed on this PC. Increment
`versionCode` for a new native release. SDKs, caches, keys and device settings are
local to each computer.

## Verification boundary

Native unit tests, release lint, APK signature/manifest/alignment checks and
synthetic browser checks do not establish physical-phone installation, Android
intent delivery, VPN consent, sharing, sleep/resume or Wi-Fi/cellular behavior.
The October 22 review intentionally had no device access. See the
[combined review](../../docs/development/VERIFICATION.md#october-22-android-and-controls-evidence) and the
[mobile setup guide](../docs/SETUP.md).

References: [Android signing](https://developer.android.com/studio/publish/app-signing),
[Tailscale connection receiver](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/IPNReceiver.java),
[Tailscale consent checks](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/StartVPNWorker.java).
