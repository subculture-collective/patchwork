package org.example.patchwork.shell.auth

import okhttp3.CookieJar
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit

class AuthHttpApi(override val baseUrl: String) : NativeAuthApi {
    // No shared/browser cookies, redirect forwarding, HTTP cache, body logging or automatic code retries.
    private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .callTimeout(20, TimeUnit.SECONDS).build()

    private fun request(path: String, method: String = "GET", token: String? = null, body: JSONObject? = null): JSONObject {
        val builder = Request.Builder().url(baseUrl.trimEnd('/') + path)
            .header("Accept", "application/json").header("Cache-Control", "no-store")
        if (token != null) builder.header("Authorization", "Bearer $token")
        if (method == "POST" && path == "/account/consent") builder.header("Idempotency-Key", UUID.randomUUID().toString())
        builder.method(method, if (method == "POST") (body ?: JSONObject()).toString()
            .toRequestBody("application/json".toMediaType()) else null)
        client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.source()?.let { source ->
                if (source.request(65_537)) throw AuthFailure("NATIVE_AUTH_FAILED")
                source.readUtf8()
            } ?: throw AuthFailure("NATIVE_AUTH_FAILED")
            val json = try { JSONObject(raw) } catch (_: Exception) { throw AuthFailure("NATIVE_AUTH_FAILED") }
            if (!response.isSuccessful) {
                val code = if (response.code == 401) "SESSION_EXPIRED" else
                    json.optJSONObject("error")?.optString("code", "NATIVE_AUTH_FAILED") ?: "NATIVE_AUTH_FAILED"
                throw AuthFailure(code)
            }
            return json
        }
    }

    override fun start(handle: String, callback: String, state: String, challenge: String): String =
        request("/auth/native/start", "POST", body = JSONObject().put("handle", handle).put("redirectUri", callback)
            .put("state", state).put("codeChallenge", challenge)).getString("authorizationUrl")

    override fun exchange(code: String, verifier: String, callback: String, state: String): NativeSession {
        val result = request("/auth/native/exchange", "POST", body = JSONObject().put("code", code)
            .put("codeVerifier", verifier).put("redirectUri", callback).put("state", state))
        if (result.getString("tokenType") != "Bearer") throw AuthFailure("NATIVE_HANDOFF_INVALID")
        return NativeSession(result.getString("sessionToken").also {
            if (!Regex("[A-Za-z0-9_-]{32,256}").matches(it)) throw AuthFailure("NATIVE_HANDOFF_INVALID")
        }, Instant.parse(result.getString("expiresAt")), baseUrl)
    }

    override fun current(token: String, refresh: Boolean): SessionIdentity {
        val result = request(if (refresh) "/auth/refresh" else "/auth/session", if (refresh) "POST" else "GET", token)
            .getJSONObject("session")
        return SessionIdentity(result.getString("did"), Instant.parse(result.getString("expiresAt")))
    }

    private fun policy(json: JSONObject): PolicyStatus {
        val documents = json.getJSONArray("requiredDocuments")
        return PolicyStatus(json.getString("policyVersion"), (0 until documents.length()).map { documents.getString(it) },
            json.getBoolean("consentRequired"))
    }
    override fun policy(token: String) = policy(request("/account/onboarding", token = token))
    override fun accept(token: String, policy: PolicyStatus) = policy(request("/account/consent", "POST", token,
        JSONObject().put("policyVersion", policy.version).put("asserted18OrOlder", true)
            .put("acceptedDocuments", JSONArray(policy.documents))))
    override fun logout(token: String) { request("/auth/session", "DELETE", token) }
}
