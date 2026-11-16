package org.example.patchwork.shell.discovery

import java.io.File
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.util.concurrent.TimeUnit
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject

class DiscoveryFailure(val code: String) : Exception(code)
data class DiscoveryResult(val value: PublicPage, val stale: Boolean, val code: String? = null)

/** Only public DTOs enter this bounded cache, never raw HTTP bodies or authentication state. */
class PublicDiscoveryCache(private val directory: File, private val now: () -> Instant = Instant::now) {
    companion object { const val MAX_ENTRY_BYTES = 256 * 1024; const val MAX_ENTRIES = 20 }
    private fun path(key: String): File {
        val hash = MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(directory, "$hash.json")
    }
    @Synchronized fun read(key: String): PublicPage? {
        val file = path(key)
        if (!file.exists()) return null
        return try {
            require(file.length() <= MAX_ENTRY_BYTES)
            PublicPage.cached(JSONObject(file.readText())).also { page ->
                val age = Duration.between(page.fetchedAt, now())
                require(!age.isNegative && age < Duration.ofHours(24))
            }
        } catch (_: Exception) { file.delete(); null }
    }
    @Synchronized fun write(key: String, page: PublicPage) {
        val content = page.json().toString().toByteArray()
        if (content.size > MAX_ENTRY_BYTES) return
        directory.mkdirs()
        val target = path(key)
        val temporary = File(directory, target.name + ".tmp")
        try {
            temporary.writeBytes(content)
            check(temporary.renameTo(target))
            // Only task-owned cache files are eligible; snapshots are oldest-fetch-first.
            directory.listFiles { file -> file.name.matches(Regex("[a-f0-9]{64}[.]json")) }
                ?.filter { it != target }?.sortedByDescending { it.lastModified() }
                ?.drop(MAX_ENTRIES - 1)?.forEach { it.delete() }
        } finally { temporary.delete() }
    }
}

class PublicDiscoveryRepository(
    private val baseUrl: String, private val geography: PublicGeography,
    private val cache: PublicDiscoveryCache, private val now: () -> Instant = Instant::now
) {
    private val client = OkHttpClient.Builder().cookieJar(CookieJar.NO_COOKIES).followRedirects(false)
        .followSslRedirects(false).callTimeout(20, TimeUnit.SECONDS).build()

    fun url(query: DiscoveryQuery): HttpUrl {
        require(query.page in 1..100_000 && query.dataset in setOf("all", "community", "demo"))
        require(query.search.length <= if (query.kind == DiscoveryKind.ORGANIZATIONS) 120 else 200)
        val area = geography.selected(query.postalCode, query.countyId)
        val url = (baseUrl.trimEnd('/') + query.kind.path).toHttpUrl().newBuilder()
        url.addQueryParameter("searchText", query.search)
        url.addQueryParameter("page", query.page.toString()).addQueryParameter("pageSize", "20")
            .addQueryParameter("dataset", query.dataset)
        if (query.kind != DiscoveryKind.ORGANIZATIONS) {
            if (query.status.isNotEmpty()) url.addQueryParameter(
                if (query.kind == DiscoveryKind.VOLUNTEERS) "availability" else "status", query.status)
        }
        if (query.kind == DiscoveryKind.REQUESTS || query.kind == DiscoveryKind.OFFERS) {
            url.addQueryParameter("postType", if (query.kind == DiscoveryKind.OFFERS) "offer" else "request")
            if (query.postalCode.isNotEmpty()) url.addQueryParameter("postalCode", query.postalCode)
        }
        if (query.kind in setOf(DiscoveryKind.REQUESTS, DiscoveryKind.OFFERS, DiscoveryKind.RESOURCES)) {
            if (query.category.isNotEmpty()) url.addQueryParameter("category", query.category)
            if (area != null && (query.kind == DiscoveryKind.RESOURCES || query.postalCode.isEmpty())) {
                url.addQueryParameter("latitude", area.latitude.toString()).addQueryParameter("longitude", area.longitude.toString())
                    .addQueryParameter("radiusKm", maxOf(25.0, area.radiusKm).toString())
            }
        }
        return url.build()
    }

    private fun get(url: HttpUrl): JSONObject {
        val request = Request.Builder().url(url).header("Accept", "application/json")
            .header("Cache-Control", "no-store").build()
        client.newCall(request).execute().use { response ->
            val source = response.body?.source() ?: throw DiscoveryFailure("INVALID_RESPONSE")
            if (source.request(512 * 1024L + 1)) throw DiscoveryFailure("INVALID_RESPONSE")
            val raw = source.readUtf8()
            val body = try { JSONObject(raw) } catch (_: Exception) { throw DiscoveryFailure("INVALID_RESPONSE") }
            if (!response.isSuccessful) throw DiscoveryFailure(when {
                response.code == 400 -> "INVALID_QUERY"
                response.code == 404 -> "NOT_FOUND"
                response.code == 503 && body.optJSONObject("error")?.optString("code") == "MAINTENANCE_MODE_ACTIVE" -> "MAINTENANCE"
                else -> "REQUEST_FAILED"
            })
            return body
        }
    }

    fun load(query: DiscoveryQuery): DiscoveryResult {
        val url = try { url(query) } catch (_: Exception) { throw DiscoveryFailure("INVALID_QUERY") }
        val key = url.toString()
        return try {
            val page = PublicDiscoveryDecoder.page(get(url), query, now())
            try { cache.write(key, page) } catch (_: Exception) { /* Online discovery does not depend on writable cache storage. */ }
            DiscoveryResult(page, false)
        } catch (error: Exception) {
            val code = (error as? DiscoveryFailure)?.code ?: "REQUEST_FAILED"
            if (code in setOf("INVALID_QUERY", "NOT_FOUND")) throw DiscoveryFailure(code)
            cache.read(key)?.let { return DiscoveryResult(it, true, code) }
            throw DiscoveryFailure(code)
        }
    }

    fun organization(id: String): PublicCard = PublicDiscoveryDecoder.organization(get(
        (baseUrl.trimEnd('/') + "/organizations/profile").toHttpUrl().newBuilder().addQueryParameter("id", id).build()))

    fun resource(uri: String, dataset: String): PublicCard = PublicDiscoveryDecoder.resource(get(
        (baseUrl.trimEnd('/') + "/query/directory-resource").toHttpUrl().newBuilder()
            .addQueryParameter("uri", uri).addQueryParameter("dataset", dataset).build()))
}
