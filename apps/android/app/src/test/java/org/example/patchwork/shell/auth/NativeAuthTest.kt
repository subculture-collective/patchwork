package org.example.patchwork.shell.auth

import java.security.MessageDigest
import java.time.Instant
import java.util.Base64
import org.junit.Assert.*
import org.junit.Test

class MemorySessions : SessionStore {
    var value: NativeSession? = null
    override fun read() = value
    override fun write(session: NativeSession) { value = session }
    override fun clear() { value = null }
}

class FixtureAuthApi : NativeAuthApi {
    override val baseUrl = "https://api.example.test"
    val time = Instant.parse("2026-11-16T12:00:00Z")
    var did = "did:plc:account-one"
    var policy = PolicyStatus("2026-07-28", listOf("terms-of-use", "privacy-notice", "community-guidelines",
        "synthetic-data-disclosure", "location-sharing-consent"), true)
    var error: String? = null
    var appState = ""
    var challenge = ""
    var exchanges = 0
    var revocations = 0
    var checks = 0
    var refreshed = false
    override fun start(handle: String, callback: String, state: String, challenge: String): String {
        appState = state; this.challenge = challenge
        return "https://provider.example.test/authorize"
    }
    override fun exchange(code: String, verifier: String, callback: String, state: String): NativeSession {
        exchanges++
        assertEquals(challenge, Base64.getUrlEncoder().withoutPadding().encodeToString(
            MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray())))
        assertEquals(appState, state)
        error?.let { throw AuthFailure(it) }
        return NativeSession("s".repeat(43), time.plusSeconds(3600), baseUrl)
    }
    override fun current(token: String, refresh: Boolean): SessionIdentity {
        checks++; refreshed = refresh
        error?.let { throw AuthFailure(it) }
        return SessionIdentity(did, time.plusSeconds(3600))
    }
    override fun policy(token: String) = policy
    override fun accept(token: String, policy: PolicyStatus): PolicyStatus {
        assertEquals(this.policy.version, policy.version)
        this.policy = this.policy.copy(required = false)
        return this.policy
    }
    override fun logout(token: String) { revocations++; error?.let { throw AuthFailure(it) } }
}

class NativeAuthTest {
    private val api = FixtureAuthApi()
    private val store = MemorySessions()
    private var now = api.time
    private val redirect = "org.example.patchwork.shell.development.oauth://callback"
    private fun engine() = NativeAuth(api, store, redirect) { now }
    private fun callback(state: String = api.appState) = "$redirect?code=${"c".repeat(43)}&state=$state"
    private fun run(engine: NativeAuth, operation: () -> Unit) {
        try { operation() } catch (error: Exception) { engine.failed(error) }
    }
    private fun signedIn(): NativeAuth = engine().also {
        it.begin("member.test"); it.complete(callback())
    }

    @Test fun namedAuthJourneyGatesConsentRestoresRefreshesAndSwitchesAccount() {
        val first = signedIn()
        assertEquals(AuthPhase.CONSENT, first.state.phase)
        assertNotNull(store.value)
        run(first) { first.accept(false, true) }
        assertNotEquals(AuthPhase.READY, first.state.phase)
        first.restore()
        first.accept(true, true)
        assertEquals(AuthPhase.READY, first.state.phase)
        val restored = engine()
        restored.restore()
        assertTrue(api.refreshed)
        assertEquals("did:plc:account-one", restored.state.did)
        restored.logout()
        assertNull(store.value)
        assertNull(restored.state.did)
        assertEquals(1, api.revocations)
        api.did = "did:plc:account-two"
        restored.begin("other.test"); restored.complete(callback())
        assertEquals(api.did, restored.state.did)
    }

    @Test fun randomPkceAndAppStateChangeForEveryAttempt() {
        val auth = engine()
        auth.begin("member.test")
        val first = api.appState to api.challenge
        auth.cancel(); auth.begin("member.test")
        assertNotEquals(first.first, api.appState)
        assertNotEquals(first.second, api.challenge)
        assertEquals(43, api.appState.length)
        assertEquals(43, api.challenge.length)
    }

    @Test fun cancellationAndLateCallbackStaySignedOut() {
        val auth = engine()
        auth.begin("member.test")
        auth.cancel()
        run(auth) { auth.complete(callback()) }
        assertEquals("SIGN_IN_INTERRUPTED", auth.state.code)
        assertEquals(0, api.exchanges)
        assertNull(store.value)
    }

    @Test fun processDeathDoesNotRestorePendingVerifier() {
        engine().begin("member.test")
        val restarted = engine()
        restarted.restore()
        run(restarted) { restarted.complete(callback()) }
        assertEquals(AuthPhase.SIGNED_OUT, restarted.state.phase)
        assertEquals(0, api.exchanges)
    }

    @Test fun mismatchedDuplicateForeignAndExpiredCallbacksNeverExchange() {
        for (bad in listOf<(String) -> String>(
            { callback("wrong") }, { callback() + "&state=${api.appState}" },
            { callback().replace("callback?", "different?") }, { callback() + "#fragment" },
            { callback().replace("code=", "code=short") }
        )) {
            val auth = engine(); auth.begin("member.test")
            run(auth) { auth.complete(bad(api.appState)) }
            assertEquals(AuthPhase.SIGNED_OUT, auth.state.phase)
        }
        val expired = engine(); expired.begin("member.test"); now = now.plusSeconds(600)
        run(expired) { expired.complete(callback()) }
        assertEquals(0, api.exchanges)
    }

    @Test fun callbackCannotBeReplayedEvenWhenExchangeResponseIsLost() {
        val auth = engine(); auth.begin("member.test")
        api.error = "NATIVE_AUTH_FAILED"
        run(auth) { auth.complete(callback()) }
        run(auth) { auth.complete(callback()) }
        assertEquals(1, api.exchanges)
        assertNull(store.value)
    }

    @Test fun expiredAndWrongEnvironmentStoredCredentialsAreClearedWithoutNetwork() {
        for (saved in listOf(NativeSession("s".repeat(43), now, api.baseUrl),
            NativeSession("s".repeat(43), now.plusSeconds(3600), "https://other.test"))) {
            store.value = saved
            val auth = engine(); auth.restore()
            assertNull(store.value)
            assertEquals(AuthPhase.SIGNED_OUT, auth.state.phase)
        }
        assertEquals(0, api.checks)
    }

    @Test fun revokedSessionsClearIdentityWhileTransientFailuresDenyProtectedActions() {
        signedIn()
        api.error = "NATIVE_AUTH_FAILED"
        val transient = engine(); run(transient) { transient.restore() }
        assertEquals(AuthPhase.UNAVAILABLE, transient.state.phase)
        assertNull(transient.state.did)
        assertNotNull(store.value)
        api.error = "SESSION_EXPIRED"
        run(transient) { transient.restore() }
        assertEquals(AuthPhase.SIGNED_OUT, transient.state.phase)
        assertNull(store.value)
    }

    @Test fun logoutAlwaysClearsLocalStateWhenServerIsUnreachable() {
        val auth = signedIn(); api.error = "NATIVE_AUTH_FAILED"
        auth.logout()
        assertNull(store.value)
        assertNull(auth.state.did)
        assertEquals("LOCAL_LOGOUT_ONLY", auth.state.code)
    }

    @Test fun storageFailureRevokesNewSessionAndDoesNotExposeSignedInState() {
        val broken = object : SessionStore {
            override fun read(): NativeSession? = null
            override fun write(session: NativeSession) { error("Unavailable keystore") }
            override fun clear() {}
        }
        val auth = NativeAuth(api, broken, redirect) { now }
        auth.begin("member.test"); run(auth) { auth.complete(callback()) }
        assertEquals("SESSION_STORAGE_UNAVAILABLE", auth.state.code)
        assertNull(auth.state.did)
        assertEquals(1, api.revocations)
    }
}
