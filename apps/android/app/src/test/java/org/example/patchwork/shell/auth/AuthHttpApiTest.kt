package org.example.patchwork.shell.auth

import java.io.File
import java.time.Instant
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class AuthHttpApiTest {
    private val server = MockWebServer().apply { start() }
    private val api = AuthHttpApi(server.url("/api").toString())
    private fun fixture(name: String) = File(System.getProperty("patchwork.contracts"), name).readText()
    private fun response(body: String) { server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(body)) }
    @After fun close() { server.shutdown() }

    @Test fun exchangeDecodesServerOwnedFixtureAndNeverCarriesCookies() {
        server.enqueue(MockResponse().addHeader("Set-Cookie", "patchwork_session=browser; Path=/")
            .setBody("{\"authorizationUrl\":\"https://provider.example/authorize\"}"))
        api.start("member.test", "org.example.oauth://callback", "s".repeat(43), "c".repeat(43))
        response(fixture("native-auth-session.json"))
        val session = api.exchange("c".repeat(43), "v".repeat(43), "org.example.oauth://callback", "s".repeat(43))
        assertEquals(Instant.parse("2026-11-16T13:00:00Z"), session.expiresAt)
        assertEquals("/api/auth/native/start", server.takeRequest().path)
        val exchange = server.takeRequest()
        assertEquals("/api/auth/native/exchange", exchange.path)
        assertNull(exchange.getHeader("Cookie"))
        assertNull(exchange.getHeader("Authorization"))
        assertEquals("v".repeat(43), JSONObject(exchange.body.readUtf8()).getString("codeVerifier"))
        assertFalse(session.toString().contains(session.token))
    }

    @Test fun policyConsentAndSessionRequestsUseExplicitBearerAndCurrentServerVersion() {
        response(fixture("native-auth-policy.json"))
        val policy = api.policy("s".repeat(43))
        assertEquals("2026-07-28", policy.version)
        assertEquals(5, policy.documents.size)
        response(fixture("native-auth-policy.json").replace("true", "false"))
        assertFalse(api.accept("s".repeat(43), policy).required)
        assertEquals("Bearer ${"s".repeat(43)}", server.takeRequest().getHeader("Authorization"))
        val request = server.takeRequest()
        assertEquals("/api/account/consent", request.path)
        assertNotNull(request.getHeader("Idempotency-Key"))
        assertNull(request.getHeader("Cookie"))
        assertTrue(JSONObject(request.body.readUtf8()).getBoolean("asserted18OrOlder"))
    }

    @Test fun namedNativeAuthJourneyAgainstDeterministicHttpFixtures() {
        val now = Instant.parse("2026-11-16T12:00:00Z")
        val store = MemorySessions()
        val callback = "org.example.patchwork.shell.development.oauth://callback"
        val engine = NativeAuth(api, store, callback) { now }
        val sessionBody = "{\"session\":{\"did\":\"did:plc:fixture\",\"expiresAt\":\"2026-11-16T13:00:00.000Z\"}}"
        response("{\"authorizationUrl\":\"https://provider.example/authorize\"}")
        engine.begin("member.test")
        val start = JSONObject(server.takeRequest().body.readUtf8())
        response(fixture("native-auth-session.json"))
        response(sessionBody)
        response(fixture("native-auth-policy.json"))
        engine.complete("$callback?code=${"c".repeat(43)}&state=${start.getString("state")}")
        val exchange = server.takeRequest()
        val verifier = JSONObject(exchange.body.readUtf8()).getString("codeVerifier")
        assertEquals(start.getString("codeChallenge"), java.util.Base64.getUrlEncoder().withoutPadding()
            .encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(verifier.toByteArray())))
        assertEquals("/api/auth/session", server.takeRequest().path)
        assertEquals("/api/account/onboarding", server.takeRequest().path)
        assertEquals(AuthPhase.CONSENT, engine.state.phase)
        response(fixture("native-auth-policy.json").replace("true", "false"))
        response(sessionBody)
        response(fixture("native-auth-policy.json").replace("true", "false"))
        engine.accept(true, true)
        assertEquals(AuthPhase.READY, engine.state.phase)
        repeat(3) { assertNull(server.takeRequest().getHeader("Cookie")) }
        response(sessionBody)
        response(fixture("native-auth-policy.json").replace("true", "false"))
        val restarted = NativeAuth(api, store, callback) { now }
        restarted.restore()
        assertEquals("/api/auth/refresh", server.takeRequest().path)
        server.takeRequest()
        assertEquals("did:plc:fixture", restarted.state.did)
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"SESSION_EXPIRED\"}}"))
        try { restarted.restore() } catch (error: Exception) { restarted.failed(error) }
        assertNull(store.value)
        assertNull(restarted.state.did)
        assertEquals(AuthPhase.SIGNED_OUT, restarted.state.phase)
    }

    @Test fun redirectsAreRejectedWithoutForwardingCredentials() {
        server.enqueue(MockResponse().setResponseCode(302).setHeader("Location", "https://other.test/session").setBody("{}"))
        try { api.current("s".repeat(43), false); fail() } catch (error: AuthFailure) {
            assertEquals("NATIVE_AUTH_FAILED", error.code)
        }
        assertEquals(1, server.requestCount)
    }

    @Test fun revokedSessionProducesStableCodeWithoutServerDiagnostics() {
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"UNAUTHORIZED\",\"message\":\"private diagnostic\"}}"))
        try { api.current("s".repeat(43), true); fail() } catch (error: AuthFailure) {
            assertEquals("SESSION_EXPIRED", error.message)
        }
        assertEquals("POST", server.takeRequest().method)
    }
}
