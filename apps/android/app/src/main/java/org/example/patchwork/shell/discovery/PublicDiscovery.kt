package org.example.patchwork.shell.discovery

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

enum class DiscoveryKind(val path: String) {
    REQUESTS("/query/feed"), OFFERS("/query/feed"), RESOURCES("/query/directory"),
    VOLUNTEERS("/query/volunteers"), ORGANIZATIONS("/organizations")
}

data class DiscoveryQuery(
    val kind: DiscoveryKind = DiscoveryKind.REQUESTS,
    val search: String = "", val postalCode: String = "", val countyId: String = "",
    val category: String = "", val dataset: String = "all", val page: Int = 1, val status: String = ""
)

data class PublicCard(
    val id: String, val title: String, val summary: String,
    val origin: String, val status: String = "", val category: String = "",
    val area: String = "", val hours: String = "", val eligibility: String = "",
    val phone: String = "", val contactUrl: String = "", val sourceName: String = "",
    val sourceUrl: String = "", val retrievedAt: String = "", val verifiedAt: String = "",
    val nonEndorsement: String = "", val capabilities: List<String> = emptyList(),
    val languages: List<String> = emptyList(), val resourceUris: List<String> = emptyList(), val postType: String = ""
) {
    /** Explicit public-field allowlist: unknown server additions can never enter the cache. */
    fun json(): JSONObject = JSONObject().put("id", id).put("title", title).put("summary", summary)
        .put("origin", origin).put("status", status).put("category", category).put("area", area)
        .put("hours", hours).put("eligibility", eligibility).put("phone", phone).put("contactUrl", contactUrl)
        .put("sourceName", sourceName).put("sourceUrl", sourceUrl).put("retrievedAt", retrievedAt)
        .put("verifiedAt", verifiedAt).put("nonEndorsement", nonEndorsement)
        .put("capabilities", JSONArray(capabilities)).put("languages", JSONArray(languages))
        .put("resourceUris", JSONArray(resourceUris)).put("postType", postType)

    companion object {
        fun cached(row: JSONObject) = PublicCard(row.getString("id"), row.getString("title"), row.getString("summary"),
            row.getString("origin"), row.getString("status"), row.getString("category"), row.getString("area"),
            row.getString("hours"), row.getString("eligibility"), row.getString("phone"), row.getString("contactUrl"),
            row.getString("sourceName"), row.getString("sourceUrl"), row.getString("retrievedAt"), row.getString("verifiedAt"),
            row.getString("nonEndorsement"), row.strings("capabilities"), row.strings("languages"), row.strings("resourceUris"), row.getString("postType"))
    }
}

private fun JSONObject.text(key: String) = if (isNull(key)) "" else optString(key, "")
private fun JSONObject.strings(key: String): List<String> = optJSONArray(key)?.let { array ->
    (0 until minOf(array.length(), 100)).map { array.getString(it).take(500) }
} ?: emptyList()

data class PublicPage(val cards: List<PublicCard>, val page: Int, val total: Int, val hasNext: Boolean,
    val fetchedAt: Instant, val projectedAt: String = "") {
    fun json() = JSONObject().put("cards", JSONArray(cards.map { it.json() })).put("page", page)
        .put("total", total).put("hasNext", hasNext).put("fetchedAt", fetchedAt.toString()).put("projectedAt", projectedAt)
    companion object {
        fun cached(json: JSONObject): PublicPage {
            val cards = json.getJSONArray("cards")
            require(cards.length() <= 20)
            return PublicPage((0 until cards.length()).map { PublicCard.cached(cards.getJSONObject(it)) },
                json.getInt("page"), json.getInt("total"), json.getBoolean("hasNext"),
                Instant.parse(json.getString("fetchedAt")), json.getString("projectedAt"))
        }
    }
}

object PublicDiscoveryDecoder {
    private fun card(row: JSONObject, kind: DiscoveryKind): PublicCard {
        val listing = row.optJSONObject("publicListing")
        val provenance = row.optJSONObject("provenance")
        val contact = row.optJSONObject("contact")
        return PublicCard(
            id = row.getString(if (kind == DiscoveryKind.ORGANIZATIONS) "id" else "uri"),
            title = row.getString(when (kind) {
                DiscoveryKind.RESOURCES, DiscoveryKind.ORGANIZATIONS -> "name"
                DiscoveryKind.VOLUNTEERS -> "displayName"
                else -> "title"
            }).take(300),
            summary = row.text(when (kind) {
                DiscoveryKind.ORGANIZATIONS -> "description"
                DiscoveryKind.VOLUNTEERS -> "bio"
                else -> "summary"
            }).take(5000),
            origin = row.text(if (kind == DiscoveryKind.ORGANIZATIONS) "origin" else "recordOrigin").ifEmpty { "visitor-created" },
            status = row.text(if (kind == DiscoveryKind.VOLUNTEERS) "availability" else "status"),
            category = row.text("category"),
            area = if (kind == DiscoveryKind.VOLUNTEERS) row.optJSONObject("serviceArea")?.text("areaLabel").orEmpty()
                else row.text("serviceArea"),
            hours = row.text("openHours"), eligibility = row.text("eligibilityNotes"),
            phone = contact?.text("phone").orEmpty(), contactUrl = contact?.text("url").orEmpty(),
            sourceName = listing?.text("sourceName").orEmpty(),
            sourceUrl = listing?.text("sourceUrl") ?: provenance?.text("sourceUrl").orEmpty(),
            retrievedAt = listing?.text("sourceRetrievedAt") ?: provenance?.text("retrievedAt").orEmpty(),
            verifiedAt = provenance?.text("lastVerifiedAt").orEmpty(),
            nonEndorsement = row.text("nonEndorsementLabel"),
            capabilities = row.strings("capabilities"), languages = row.strings("languages"),
            postType = if (kind in setOf(DiscoveryKind.REQUESTS, DiscoveryKind.OFFERS)) row.text("postType").ifEmpty { "request" } else ""
        )
    }

    fun page(json: JSONObject, query: DiscoveryQuery, fetchedAt: Instant): PublicPage {
        if (query.kind == DiscoveryKind.ORGANIZATIONS) {
            val rows = json.getJSONArray("organizations")
            require(rows.length() <= 20 && json.getInt("page") == query.page && json.getInt("total") >= 0)
            return PublicPage((0 until rows.length()).map { card(rows.getJSONObject(it), query.kind) }, query.page,
                json.getInt("total"), json.getBoolean("hasNextPage"), fetchedAt)
        }
        val rows = json.getJSONArray("results")
        require(rows.length() <= 20 && json.getInt("page") == query.page && json.getInt("total") >= 0)
        return PublicPage((0 until rows.length()).map { card(rows.getJSONObject(it), query.kind) },
            json.getInt("page"), json.getInt("total"), json.getBoolean("hasNextPage"), fetchedAt,
            json.optJSONObject("projectionFreshness")?.text("projectedAt").orEmpty())
    }

    fun organization(json: JSONObject): PublicCard {
        val base = card(json.getJSONObject("organization"), DiscoveryKind.ORGANIZATIONS)
        val resources = json.optJSONArray("resources") ?: JSONArray()
        return base.copy(resourceUris = (0 until minOf(resources.length(), 100))
            .map { resources.getJSONObject(it).getString("resourceUri") })
    }

    fun resource(json: JSONObject): PublicCard = card(json.getJSONArray("results").getJSONObject(0), DiscoveryKind.RESOURCES)
}

data class PublicArea(val latitude: Double, val longitude: Double, val radiusKm: Double, val label: String)

class PublicGeography(private val postal: JSONObject, private val counties: JSONObject, private val names: JSONObject) {
    fun selected(postalCode: String, countyId: String): PublicArea? {
        if (postalCode.isEmpty() && countyId.isEmpty()) return null
        require(postalCode.isEmpty() || countyId.isEmpty())
        val county = countyId.isNotEmpty()
        val id = if (!county) postalCode else if (Regex("[0-9]{5}").matches(countyId)) countyId else {
            counties.keys().asSequence().filter { key ->
                (names.getString(key) + ", " + names.getString(counties.getJSONArray(key).getString(2)))
                    .equals(countyId, ignoreCase = true)
            }.singleOrNull() ?: throw IllegalArgumentException("Choose a supported county and state")
        }
        require(Regex("[0-9]{5}").matches(id))
        val values = (if (county) counties else postal).getJSONArray(id)
        val area = values.getDouble(if (county) 3 else 4)
        val countyKey = if (county) id else values.getString(2)
        val stateKey = values.getString(if (county) 2 else 3)
        return PublicArea(values.getDouble(0), values.getDouble(1),
            maxOf(1.0, kotlin.math.sqrt(area / Math.PI) / 1000).coerceAtMost(250.0),
            names.getString(countyKey) + ", " + names.getString(stateKey))
    }
}
