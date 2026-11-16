# Native build environment decision

Date: 2026-11-15. Addresses [#244](https://github.com/subculture-collective/patchwork/issues/244)
in [roadmap #210](https://github.com/subculture-collective/patchwork/issues/210).

## Host choice

The owner confirmed that Soyuz is their only Mac and Android can run on any
host. Use **Soyuz for iOS** and **Kvant for Android**. Keep source changes in
the Patchwork repository; do not turn a shared host's primary checkout into a
disposable build directory. Existing web/service CI remains independent.

This spike inventories tools and establishes the build contract for the next
issues. There is no native app project yet, so this is not a successful app
build, simulator journey, signing check or supported-device certification.

## Observed tools and capacity

| Boundary | Observation on 2026-11-15 | Consequence |
| --- | --- | --- |
| Soyuz | SSH host identifies as `soyuz.local`, arm64, macOS 26.6.2 | The selected remote build host is reachable |
| Xcode | `/Applications/Xcode.app/Contents/Developer`, Xcode 27.2 build 27B52 | Use this selected Xcode for the first shell; record version changes before comparing builds |
| Swift | Apple Swift 6.4.2 | Native Swift toolchain is available |
| iOS SDK | Device and simulator SDK 27.2 | SDK availability is established; installed simulator destinations are not established |
| Soyuz storage | `df -h /` reported about 5.8 GiB available | Capacity is constrained; no large SDK downloads, full builds or unrelated cleanup were attempted |
| Kvant | Linux, JDK 21.0.13, about 1.5 TiB free on the workspace filesystem | Use Kvant for Android; observe memory before starting builds on the shared host |
| Kvant memory | About 7.2 GiB available, 4 GiB swap in use at observation | Avoid adding a second emulator or competing large builds; this is a point-in-time observation |
| Android SDK | `/home/onnwee/Android/Sdk`, platforms 35 and 36; build tools 34.0.0 and 35.0.0 | The next shell can target the installed platform without a new SDK download |
| Android tools | Command-line tools revision 22.0; platform-tools 37.0.1 | `sdkmanager --list_installed` reports deprecation in favor of Android CLI; do not upgrade tools as part of this spike |
| Cached build dependencies | Gradle 8.14.3; AGP 8.13.0 and 8.7.3; Kotlin Gradle plugin 2.1.20 | Start by validating the cached combination below, rather than assuming these caches prove a Patchwork build |

Read-only probes: `hostname`, `sw_vers`, `uname -m`, `xcode-select -p`,
`xcodebuild -version`, `xcodebuild -showsdks`, `swift --version`, `df -h`,
`java -version`, and SDK/cache directory metadata. No credential values,
signing identities or private runtime configuration were read or recorded.

## Device discovery and access limits

T3 device discovery lists the local Android device `emulator-5554`, named
`T3_Pixel_API_35`, running Android 15.0. It is a booted emulator, not a physical
phone. Listing it does not acquire its interactive session or prove app behavior.
Call `device_open` for host `local` and the current device ID before interacting,
and use the returned `agent-device` command. Respect an occupied session.

Soyuz is reachable as a linked T3 environment, but it is not configured as a
device host in this thread's device service. The service reported:

> No device host soyuz. Known hosts: This machine (local).

Remote iOS simulator interaction therefore remains unavailable through the
required shared device tools. No SSH/simctl UI fallback was attempted. Register
Soyuz with the device service before claiming an interactive simulator result;
linking a T3 environment alone does not perform that registration.

No physical iPhone or Android phone, Apple developer team, signing certificate,
provisioning profile, APNs/FCM project or store account was qualified. These
remain explicit private-beta/release inputs, not reasons to invent device proof.

## Initial platform and project contract

- iOS shell: `apps/ios/Patchwork.xcodeproj`, shared scheme `Patchwork`, SwiftUI,
  proposed deployment target iOS 17.0. Build with Soyuz's selected Xcode 27.2.
- Android shell: `apps/android`, module `app`, Gradle wrapper 8.14.3,
  proposed AGP 8.13.0/Kotlin 2.1.20, JDK 21, compile/target SDK 36 and
  proposed minimum API 29 (Android 10).
- These are starting choices for #249/#250. Confirm Gradle/AGP/Kotlin and
  Compose compatibility during the shell build; caches are not compatibility
  evidence. The map/WebRTC spikes #252/#251 may require a documented change.
- A deployment minimum is not a tested support claim. The observed Android
  runtime is API 35; no minimum-version physical device or iOS runtime has
  been qualified. Do not copy the old release checklist's device matrix.
- Keep signing credentials out of source. Establish distinct development,
  staging and release application identities with the owner before signed
  installs. No bundle/package identifier ownership is inferred here.

## Build and test commands for the shell issues

Run these after #249/#250 create the named projects; they were **not run** in
this spike. Work from the repository root on the selected host. Paths under
`.build` are task-owned artifacts, not permission to remove another checkout's
or host's caches.

On Soyuz, unsigned simulator compilation has a generic destination and does
not need a signing identity or an interactive simulator:

```sh
rtk proxy xcodebuild -project apps/ios/Patchwork.xcodeproj \
  -scheme Patchwork -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath .build/ios-simulator CODE_SIGNING_ALLOWED=NO build
```

For iOS tests, first acquire a simulator with the device tools and take its
actual UDID from that session. The required `PATCHWORK_IOS_SIMULATOR_UDID`
environment variable is an input, not a guessed simulator name. No valid UDID
is available from this thread's current device service, so a concrete test
destination remains unqualified:

```sh
rtk proxy xcodebuild -project apps/ios/Patchwork.xcodeproj \
  -scheme Patchwork -configuration Debug \
  -destination "platform=iOS Simulator,id=${PATCHWORK_IOS_SIMULATOR_UDID:?acquire an iOS device session first}" \
  -derivedDataPath .build/ios-simulator CODE_SIGNING_ALLOWED=NO test
```

On Kvant, use the checked-in wrapper rather than a host-global Gradle:

```sh
rtk proxy env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ANDROID_HOME=/home/onnwee/Android/Sdk \
  apps/android/gradlew -p apps/android --no-daemon \
  :app:lintDebug :app:testDebugUnitTest :app:assembleDebug
```

After acquiring the Android device session, the currently enumerated serial
would select the connected-test target as follows. Re-enumerate if it changes;
do not reuse or close someone else's session:

```sh
rtk proxy env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ANDROID_HOME=/home/onnwee/Android/Sdk ANDROID_SERIAL=emulator-5554 \
  apps/android/gradlew -p apps/android --no-daemon :app:connectedDebugAndroidTest
```

Use the returned `agent-device` command for launches, input and screenshots;
these build/test commands do not authorize a separate adb/simctl UI workflow.

## Follow-up gates

#249/#250 establish actual clean-build and test results. Before large Soyuz
builds, recheck free space and resolve capacity without deleting unrelated
data. Before interactive iOS tests, establish Soyuz device-host integration.
Before beta acceptance, identify consented physical phones, signing access,
push environments and private distribution. This spike does not configure CI
runners, buy accounts, deploy services or clean host storage.
