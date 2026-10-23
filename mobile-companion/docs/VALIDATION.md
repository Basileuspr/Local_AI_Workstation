# Companion folder consolidation validation

Checked on October 23, 2026, with the published image-scan refresh fix included.
The move groups 74 existing source files under `mobile-companion/` and keeps
shared workstation dependencies at their existing locations.

| Check | Result |
|---|---|
| Full frontend suite | 1,566 passed; 3 existing skips |
| Full backend suite, temporary data/model/log/catalog paths | 2,201 passed; 2 directory-symlink checks skipped on this Windows account |
| Final source-capture/native publication checks | 23 passed, including historical paths and private-file exclusions |
| Production desktop and phone builds | Passed in an isolated source copy with a fresh lockfile install |
| Phone development serving | Moved entry point and shared desktop component both returned HTTP 200 |
| Android JVM tests and release lint | 15 tests passed; lint completed with 6 warnings and no errors |
| Native adapter Chromium QA | 8 synthetic checks passed |
| Hosted phone-update Chromium QA | Passed pairing, version acknowledgment, draft confirmation, update application and failed-build recovery |
| Documentation | Local links, anchors and relocation map passed |
| Outgoing source/privacy review | Passed; existing Android output files retained matching SHA-256 hashes |

The full backend run initially failed because its temporary log folder had a
custom basename while an existing test expects `logs`. Using the documented
temporary-root layout resolved it without changing application logging. The
relocated tests also share the workstation fixture constants so full-suite
collection works regardless of which test root pytest loads first.

Builds retained existing large-chunk/browser-externalization notices. Backend
checks retained dependency deprecation warnings; Android checks retained SDK and
Gradle/deprecated-API warnings. These checks did not install a new APK, exercise
physical-phone APIs or verify real-provider/GPU inference.

The live desktop, deployed `dist`, installed dependencies, VPN/network settings,
private signing identity and runtime pairing/job databases were not changed for
validation. Runtime activation remains a separately coordinated step. After that
activation, follow the [phone acceptance steps](../README.md#phone-acceptance-after-coordinated-activation).
