package org.example.patchwork.shell.auth

import java.net.URI
import java.net.URLDecoder
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64

class NativeSession(val token: String, val expiresAt: Instant, val apiBase: String) {
    override fun toString() = "NativeSession(redacted)"
}

interface SessionStore {
    fun read(): NativeSession?
    fun write(session: NativeSession)
    fun clear()
}

data class PolicyStatus(val version: String, val documents: List<String>, val required: Boolean)
data class SessionIdentity(val did: String, val expiresAt: Instant)
class AuthFailure(val code: String) : Exception(code)

interface NativeAuthApi {
    val baseUrl: String
    fun start(handle: String, callback: String, state: String, challenge: String): String
    fun exchange(code: String, verifier: String, callback: String, state: String): NativeSession
    fun current(token: String, refresh: Boolean): SessionIdentity
    fun policy(token: String): PolicyStatus
    fun accept(token: String, policy: PolicyStatus): PolicyStatus
    fun logout(token: String)
}

enum class AuthPhase { SIGNED_OUT, BROWSER, CONSENT, READY, UNAVAILABLE }
data class AuthState(
    val phase: AuthPhase = AuthPhase.SIGNED_OUT,
    val did: String? = null,
    val policy: PolicyStatus? = null,
    val code: String? = null
)

/** Call serially off the UI thread. Pending PKCE material deliberately stays memory-only. */
class NativeAuth(
    private val api: NativeAuthApi,
    private val store: SessionStore,
    private val callback: String,
    private val now: () -> Instant = Instant::now
) {
    private class Pending(val verifier: String, val state: String, val expiresAt: Instant)
    private var pending: Pending? = null
    private var session: NativeSession? = null
    var state = AuthState()
        private set

    private fun random(): String = Base64.getUrlEncoder().withoutPadding()
        .encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })

    fun begin(handle: String): String {
        check(session == null) { "Sign out before changing accounts" }
        pending = null
        state = AuthState()
        if (handle.isBlank() || handle.length > 253) throw AuthFailure("INVALID_HANDLE")
        val verifier = random()
        val appState = random()
        val challenge = Base64.getUrlEncoder().withoutPadding()
            .encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray(Charsets.US_ASCII)))
        val authorization = api.start(handle.trim(), callback, appState, challenge)
        val uri = URI(authorization)
        if (uri.scheme != "https" || uri.host == null || uri.userInfo != null) throw AuthFailure("NATIVE_HANDOFF_INVALID")
        pending = Pending(verifier, appState, now().plusSeconds(600))
        state = AuthState(AuthPhase.BROWSER)
        return authorization
    }

    fun cancel() {
        pending = null
        state = AuthState(code = "SIGN_IN_CANCELLED")
    }

    fun complete(value: String) {
        val binding = pending ?: throw AuthFailure("SIGN_IN_INTERRUPTED")
        // Consume locally even when the callback/exchange fails. Never retry single-use codes.
        pending = null
        state = AuthState()
        val uri = URI(value)
        val target = URI(callback)
        if (uri.scheme != target.scheme || uri.rawAuthority != target.rawAuthority ||
            uri.rawPath != target.rawPath || uri.rawFragment != null || !now().isBefore(binding.expiresAt)) {
            throw AuthFailure("NATIVE_HANDOFF_INVALID")
        }
        val parts = (uri.rawQuery ?: "").split("&").map {
            val pair = it.split("=", limit = 2)
            if (pair.size != 2) throw AuthFailure("NATIVE_HANDOFF_INVALID")
            URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair[1], "UTF-8")
        }
        val parameters = parts.toMap()
        if (parts.size != 2 || parameters.keys != setOf("state", "code") ||
            !MessageDigest.isEqual(parameters.getValue("state").toByteArray(), binding.state.toByteArray()) ||
            !Regex("[A-Za-z0-9_-]{43}").matches(parameters.getValue("code"))) throw AuthFailure("NATIVE_HANDOFF_INVALID")
        val obtained = api.exchange(parameters.getValue("code"), binding.verifier, callback, binding.state)
        if (obtained.apiBase != api.baseUrl || !now().isBefore(obtained.expiresAt) ||
            obtained.expiresAt.isAfter(now().plusSeconds(3600))) throw AuthFailure("NATIVE_HANDOFF_INVALID")
        session = obtained
        try { store.write(obtained) } catch (error: Exception) {
            try { api.logout(obtained.token) } catch (_: Exception) { /* Bounded server expiry still applies. */ }
            clear()
            throw AuthFailure("SESSION_STORAGE_UNAVAILABLE")
        }
        validate(false)
    }

    fun restore(refresh: Boolean = true) {
        pending = null
        state = AuthState()
        session = store.read()
        val saved = session ?: return
        if (saved.apiBase != api.baseUrl || !now().isBefore(saved.expiresAt)) {
            clear()
            state = AuthState(code = "SESSION_EXPIRED")
            return
        }
        validate(refresh)
    }

    private fun validate(refresh: Boolean) {
        val saved = session ?: throw AuthFailure("SESSION_EXPIRED")
        val identity = api.current(saved.token, refresh)
        if (identity.expiresAt != saved.expiresAt || !now().isBefore(identity.expiresAt)) {
            clear()
            throw AuthFailure("SESSION_EXPIRED")
        }
        val policy = api.policy(saved.token)
        state = AuthState(if (policy.required) AuthPhase.CONSENT else AuthPhase.READY, identity.did, policy)
    }

    fun accept(adult: Boolean, documentsAccepted: Boolean) {
        val policy = state.policy ?: throw AuthFailure("CURRENT_POLICY_CONSENT_REQUIRED")
        if (!adult || !documentsAccepted) throw AuthFailure("CURRENT_POLICY_CONSENT_REQUIRED")
        api.accept(session?.token ?: throw AuthFailure("SESSION_EXPIRED"), policy)
        // Re-read authority instead of assuming the POST authorized protected actions.
        validate(false)
    }

    fun logout() {
        val token = session?.token
        clear()
        try { if (token != null) api.logout(token) } catch (_: Exception) {
            state = AuthState(code = "LOCAL_LOGOUT_ONLY")
        }
    }

    fun failed(error: Exception) {
        pending = null
        val code = (error as? AuthFailure)?.code ?: "NATIVE_AUTH_FAILED"
        if (code in setOf("UNAUTHORIZED", "SESSION_EXPIRED", "ACCOUNT_DEACTIVATED", "FORBIDDEN")) clear()
        state = AuthState(if (session == null) AuthPhase.SIGNED_OUT else AuthPhase.UNAVAILABLE, code = code)
    }

    private fun clear() {
        session = null
        pending = null
        state = AuthState()
        store.clear()
    }
}
