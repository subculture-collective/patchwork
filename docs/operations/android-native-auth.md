# Android native sign-in

Implements the code portion of #258. Provider login remains in the system
browser; the app never collects a provider password or receives a PDS token.
The HTTP contract is [the native handoff](native-auth-handoff.md).

## Callback and environment setup

The callback is the installed application ID followed by `.oauth://callback`:

- Debug: `org.example.patchwork.shell.development.oauth://callback`.
- Staging with the reserved test ID: `org.example.patchwork.shell.staging.oauth://callback`.
- Release: the explicitly owned `patchworkApplicationId` followed by `.oauth://callback`.

Configure the corresponding exact callback in the server's
`API_NATIVE_CALLBACK_URLS` before testing an authorized environment. Empty
configuration intentionally returns `NATIVE_AUTH_UNAVAILABLE`. The reserved
test IDs do not establish ownership of a distribution identity. No server
allowlist, production service or signing configuration was changed here.
Release continues to require an explicit HTTPS API URL. Loopback HTTP is for
the development fixture environment only, without real accounts.

The activity handles both cold-start and existing-task callbacks. It removes
callback data from its retained intent immediately. Exact callback authority,
path, state, parameter uniqueness and ten-minute initiation expiry are checked
before exchanging the single-use code. Pending verifier/state stay in the
ViewModel's memory across activity recreation. Process death, cancellation,
an invalid callback or a failed exchange require starting sign-in again.
Returning from a closed browser shows an explicit pending state with Cancel;
it never infers successful login from an activity resume.

## Storage and authority

Only the bounded Patchwork session and its expiry/API-base binding are stored.
Android Keystore supplies a non-exportable AES key; AES-GCM protects an atomic
record in `noBackupFilesDir`. Decryption failure clears that record. There is
no plaintext preference, backup copy, cookie jar, HTTP cache or logging
interceptor. The token's string representation is redacted. This is platform
protection, not evidence of hardware-backed storage on every supported phone.

Restoration refreshes the provider-backed server session and reads current
versioned policy consent before exposing signed-in actions. HTTP uses explicit
bearer authorization without browser cookies, redirects or automatic exchange
retries. Expired/revoked sessions clear local credentials and identity. A
transient validation failure retains the encrypted credential but exposes an
unavailable state with no protected actions or old-account identity.

Consent requires all five known policy acknowledgements and a separate 18+
confirmation. Policy/document changes are read from the server, unfamiliar
document sets require an app update, and acceptance is followed by an authority
re-read. All acknowledgement state is keyed by account and policy version.
The server remains the authorization authority for every later member command.

Logout clears local state before attempting server revocation. A failed remote
logout explicitly says that only local logout was confirmed and that the old
bounded session expires within one hour. Nothing queues a later write. The
next account starts without the previous handle, consent selection or identity.

## Verification and remaining gates

On Kvant, 2026-11-16 UTC:

- Debug and Staging each passed 15 auth/HTTP unit tests plus the configuration
  test. `namedNativeAuthJourneyAgainstDeterministicHttpFixtures` exercises the
  real HTTP client and auth coordinator through PKCE handoff, consent, refresh,
  restoration and revocation against a local fake API.
- Debug lint, the app APK, and the instrumentation APK compiled successfully.
- Four server handoff/wire tests, the API typecheck, 20 localization checks,
  maintained-resource validation and `git diff --check` passed. The new fixtures
  are bound to the production handoff and onboarding services.
- Read-only auth implementation review identified no actionable defect.

The shared emulator failed to start with SIGSEGV. Following the device tool's
diagnostic command once produced a boot, then hung QEMU threads and exit signal
11. The instrumented runner saw offline/no connected devices; no UI test or
interactive deep-link journey passed for this change. The compiled UI suite
adds consent/cancellation/fallback cases and an encrypted-record tamper check.

The PR remains draft pending a stable acquired-device run, interactive callback
and restoration checks, and the security-review checkpoint in #258. Physical
phones and real-provider evidence remain private-beta qualification. No real
member account, deployment or store submission was used.

Reproduce the non-device checks from the repository root:

```sh
rtk proxy env JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 \
  ANDROID_HOME=/home/onnwee/Android/Sdk apps/android/gradlew -p apps/android \
  --no-daemon --max-workers=1 -Dorg.gradle.jvmargs=-Xmx768m \
  :app:testDebugUnitTest :app:testStagingUnitTest :app:lintDebug \
  :app:assembleDebug :app:assembleDebugAndroidTest
rtk proxy npx vitest run services/api/src/native-auth-wire-contracts.test.ts \
  services/api/src/auth/native-handoff.test.ts
rtk proxy npm run typecheck -w @patchwork/api
rtk proxy python3 -B scripts/check_android_localization.py
```

Acquire the emulator through the device tools before running
`:app:connectedDebugAndroidTest` with its current `ANDROID_SERIAL`. Launches,
callbacks, input and screenshots use the `agent-device` command returned by
that session. Do not replace missing device evidence with an HTTP fixture pass.
