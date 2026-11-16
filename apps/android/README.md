# Native Android shell

Independent Kotlin/Compose phone shell for #250, minimum API 29 and target API
36. It uses native Material navigation, system text sizing, light/dark colors
and external English/Spanish XML resources. Browse and Settings link to About;
Android back dismisses About. Feature screens and authentication follow in
separate issues. It makes no API calls or simulated successful member actions.

Settings includes a persisted system-default/English/Spanish language choice.
See [Android localization](../../docs/localization/android.md) for native
resource validation, translator export/import and large-text pseudolocale tests.

Browse includes the anonymous public-discovery and bounded cache implementation
for #261. [Android public discovery](../../docs/operations/android-public-discovery.md)
records the contract, offline limits, checks and pending device gate.

Build with JDK 21 and Android SDK platform 36/build tools 35.0.0:

```sh
apps/android/gradlew -p apps/android --no-daemon \
  :app:lintDebug :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
```

The checked-in Gradle 8.14.3 wrapper pins the distribution SHA-256. AGP 8.13.0,
Kotlin/Compose compiler 2.1.20 and Compose BOM 2024.12.01 are fixed to the
foundation host's available versions. The compiler plugin follows
[Android's Kotlin/Compose setup](https://developer.android.com/develop/ui/compose/setup-compose-dependencies-and-compiler).

`debug` uses reserved `org.example.patchwork.shell.development` and emulator
loopback `http://10.0.2.2:4000`. `staging` uses
`org.example.patchwork.shell.staging` and reserved
`https://staging.patchwork.invalid/api`. Override `-PpatchworkApiBaseUrl` for an
authorized environment. These test identities make no ownership claim.

Release tasks require an explicit owned `-PpatchworkApplicationId` and HTTPS
`-PpatchworkApiBaseUrl`. No release signing configuration or credentials are
included. Development permits loopback cleartext; staging/release disable it.
App/build identity is 0.1.0 (1), visible with environment in About. The source
namespace remains separate from a future owned distribution application ID.

## Device verification

Use `device_list` and `device_open` before any interaction. On the acquired
Kvant emulator, install the debug APK and launch through the returned
`agent-device` command. Use that command for taps, back, settings and screenshots.
Run `:app:connectedDebugAndroidTest` with `ANDROID_SERIAL` set to that acquired
device; the project test runner may install/run its test APK. Do not start a
second emulator or reuse another session. Compilation and device-test evidence
are recorded separately in the PR.

The app is not an npm workspace. Root npm commands continue to cover only the
existing JavaScript/TypeScript workspaces.

On 2026-11-15, Kvant JDK 21/SDK 36 passed Debug lint, the configuration unit
test, Debug and Staging APK builds, instrumentation APK build, and the
launch/navigation instrumentation smoke on the acquired `T3_Pixel_API_35`
Android 15 (API 35) emulator. The checks were repeated after adapting system
bar icons with `enableEdgeToEdge()`. Test runner installation is disposable;
install the app APK separately for interactive review. No physical phone,
minimum-API device, release signing or store distribution was qualified.

Interactive shared-device review also confirmed launch, About navigation and
readable system-bar icons in light and dark appearance. The device was returned
to light appearance and the task's Device panel session was closed.
