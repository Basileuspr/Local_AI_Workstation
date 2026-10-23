# Application and Android installation review — 2026-10-22

This review followed completion of the Android Tailscale task at `47a99a9`.
It includes the desktop/phone code controls (`0649f1d`), guarded web search
(`947c358`), and Android Companion 0.3.0. The user explicitly chose review without
device access. No physical-phone installation or emulator acceptance is claimed.

## Findings and completed changes

- Native Android source was outside the shared application repository. Reviewed
  source, resources, tests and build tools now live in `mobile/android`. The
  original standalone project and previous delivery files were preserved.
- Source capture and GitHub publication previously omitted Java/XML/Gradle
  files. Both now explicitly include the native project while excluding APKs,
  SDKs, Gradle caches, binary wrappers, private configuration and signing keys.
  Selected native updates run unit/lint/adapter validation before publication.
- The Windows APK build failed under npm when a PowerShell 7 environment leaked
  its module paths into Windows PowerShell. The script now explicitly loads its
  host's security module for DPAPI and uses .NET for hashing. The standard npm
  build path passed with the existing private signing identity.
- The desktop bundle identified itself as an earlier dirty source snapshot.
  The release procedure rebuilds from the final clean commit and copies the
  desktop assets without deleting immutable phone releases. An already running
  window loads that refreshed renderer/build identity on its next restart.
- Phone browser QA could treat an empty job list during refresh as all jobs
  completed. It now requires the expected three jobs. Update QA copies only web
  source and install assets, excluding the newly integrated native build caches.
- Dashboard information and setup/development guides now distinguish native APK
  installation from hosted phone-interface updates and explain their order.

## Verified results

| Check | Result |
|---|---|
| Full frontend suite | 1,525 passed; 3 existing skips |
| Full backend suite | 2,196 passed; 2 existing skips |
| Media Manager suite | 21 passed |
| Android JVM tests | 15 passed |
| Android release lint | 0 errors, 6 warnings |
| Native image adapter | 8 synthetic Chromium checks passed |
| Response controls | 11 Chromium checks passed at desktop and phone widths |
| Desktop control actions | 26 behavior checks and 33 menu layouts passed |
| Phone HTTPS walkthrough | Passed pairing, chat, queued image jobs, saved results, gallery gestures, original download hash, private-cache isolation and revocation |
| Phone update walkthrough | Passed draft confirmation, version acknowledgment, preserved pairing and failed-build recovery |
| Production builds | Desktop, hosted phone interface and signed Android APK passed |
| Publication/capture regression checks | 62 focused checks passed; included in full backend suite |

The six Android warnings concern available dependency updates, an unnecessary
resource API qualifier and hardcoded strings. There were also existing Gradle
and backend-library deprecation warnings. Dependencies were not upgraded as part
of this integration review.

The prior [45-workspace controls review](2026-10-22-controls-review.md) remains
the detailed source/control inventory. The current control walkthroughs were
rerun against the integrated source. Fixtures do not certify every conditional
native action, screen reader, canvas gesture, real model or GPU workload.

Read-only live checks confirmed a healthy desktop backend, loopback-only backend
and companion listeners, Tailscale running without Funnel, HTTPS shell status
200, and private API status 401 without authentication. During a desktop restart,
HTTPS briefly returned 502 until the mobile connection was started again. Phone
access is intentionally off after a restart. The published eight-file phone
release passed hash verification and matched the current web-source identity at
review time. No private hostnames, invitations, credentials or user content are
included in this report.

## APK identity and upgrade compatibility

- Package: `com.localai.workstation.companion`
- Version: `0.3.0`, code `3`; minimum Android API 29, target/compile API 36.
- Rebuilt APK SHA-256:
  `4146998459ba8ff5d1c80200ac556031b0b2f482a01877adf6f49c1c47036d25`
- Signing certificate SHA-256:
  `d642cb971be0a6cf31eebb0a706ea8aef3b7561dcf74856b230f9d9a47fa898f`
- v3 signature and 16 KB ZIP alignment verified. Package name, certificate and
  permission list match the prior 0.2.0 and standalone 0.3.0 artifacts. The
  permission list is Internet, network state and AndroidX's app-private signature
  permission. There are no native ABI libraries, camera/storage/VPN permissions
  or embedded private desktop settings.

These checks establish artifact compatibility, not the identity of an APK
currently installed on the phone. Preserve the existing app and install the
signed update over it; a signature conflict requires the matching signing key,
not uninstalling the app. Android's [signing guidance](https://developer.android.com/studio/publish/app-signing)
explains why that identity must be retained.

## Installation sequence and remaining device checks

1. Finish active desktop work before a required restart. Start the desktop mobile
   connection afterward and keep the desktop awake.
2. Connect Tailscale on the desktop and phone when using the private `.ts.net`
   origin. The APK can request connection; first-use sign-in and VPN consent stay
   in Tailscale. Existing/unknown VPNs are not automatically replaced.
3. Install the signed APK over Companion without uninstalling or clearing data.
4. Reuse retained pairing on an upgrade. A fresh installation uses the exact
   desktop HTTPS origin and a new invitation confirmed inside the Android app.
5. Publish hosted web changes with the desktop **Update phone app** control and
   accept them on the phone when its draft is ready. This does not install native
   APK features.

On-device installation, retained pairing, actual Tailscale intent delivery,
initial consent, downloads/sharing, sleep/resume and Wi-Fi/cellular behavior
remain unverified by explicit user choice. Native connection code was checked
against Tailscale's [receiver](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/IPNReceiver.java)
and [VPN consent checks](https://github.com/tailscale/tailscale-android/blob/main/android/src/main/java/com/tailscale/ipn/StartVPNWorker.java).
It sends no credentials or desktop address to Tailscale and does not bypass TLS.

See the [native guide](../../mobile/android/README.md) for repeatable build,
signing and installation instructions. Another computer must retain its own
dependencies/runtime data; building an update for this installation also requires
the original signing identity through a private transfer. That computer was not
inspected.
