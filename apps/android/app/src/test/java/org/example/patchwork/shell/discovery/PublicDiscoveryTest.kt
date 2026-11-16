package org.example.patchwork.shell.discovery

import java.io.File
import java.time.Instant
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class PublicDiscoveryTest {
    @get:Rule val temporary = TemporaryFolder()
    private var now = Instant.parse("2026-11-16T12:00:00Z")
    private val server = MockWebServer().apply { start() }
    private fun fixture(name: String) = File(System.getProperty("patchwork.contracts"), "$name.json").readText()
    private fun geography(): PublicGeography {
        fun file(name: String) = JSONObject(File(System.getProperty("patchwork.geography"), name).readText())
        return PublicGeography(file("postal-index.json"), file("county-index.json"), file("geography-names.json"))
    }
    private fun repository(cache: PublicDiscoveryCache) = PublicDiscoveryRepository(server.url("/api").toString(), geography(), cache) { now }
    private fun page(name: String = "feed-global", kind: DiscoveryKind = DiscoveryKind.OFFERS) =
        PublicDiscoveryDecoder.page(JSONObject(fixture(name)), DiscoveryQuery(kind), now)
    private fun response(name: String) { server.enqueue(MockResponse().setBody(fixture(name))) }
    private fun maintenance() { server.enqueue(MockResponse().setResponseCode(503)
        .setBody("{\"error\":{\"code\":\"MAINTENANCE_MODE_ACTIVE\",\"message\":\"Ignored diagnostic\"}}")) }
    @After fun close() { server.shutdown() }

    @Test fun feedGoldensDecodeOptionalsEmptyLegacyAndUnknownStates() {
        assertEquals("synthetic", page().cards.single().origin)
        assertTrue(page("feed-empty").cards.isEmpty())
        assertEquals("request", page("feed-legacy").cards.single().postType)
        assertEquals("visitor-created", page("feed-legacy").cards.single().origin)
        assertEquals("future-state", page("feed-additive").cards.single().status)
        assertEquals("synthetic", page("feed-area").cards.single().origin)
    }

    @Test fun publicDirectoryVolunteerAndOrganizationGoldensRetainProvenanceAndDetails() {
        val resource = page("discovery-resources", DiscoveryKind.RESOURCES).cards.single()
        assertEquals("Fictional source", resource.sourceName)
        assertEquals("https://resources.example.test/info", resource.sourceUrl)
        assertEquals("+1-202-555-0100", resource.phone)
        assertEquals("sourced-public", resource.origin)
        val volunteer = page("discovery-volunteers", DiscoveryKind.VOLUNTEERS).cards.single()
        assertEquals(listOf("en", "es"), volunteer.languages)
        assertEquals("Cook County, Illinois", volunteer.area)
        val organization = PublicDiscoveryDecoder.organization(JSONObject(fixture("discovery-organization-profile")))
        assertEquals(1, organization.resourceUris.size)
        assertTrue(organization.nonEndorsement.contains("does not imply"))
        assertTrue(organization.verifiedAt.isNotEmpty())
    }

    @Test fun cacheAllowlistDropsPrivateAndCoordinateFieldsFromAdditiveServerResponses() {
        val body = JSONObject(fixture("feed-global"))
        body.getJSONArray("results").getJSONObject(0).put("chatBody", "PRIVATE_CHAT_CANARY")
            .put("application", "PRIVATE_APPLICATION_CANARY").put("coordinates", "PRIVATE_COORDINATE_CANARY")
        val decoded = PublicDiscoveryDecoder.page(body, DiscoveryQuery(), now)
        val directory = temporary.newFolder()
        val cache = PublicDiscoveryCache(directory) { now }
        cache.write("public-key", decoded)
        val stored = directory.listFiles()!!.single().readText()
        assertFalse(stored.contains("PRIVATE_"))
        assertFalse(stored.contains("coordinates"))
        assertEquals(decoded, cache.read("public-key"))
    }

    @Test fun cacheExpiresAtTwentyFourHoursAndRejectsFutureOrCorruptEntries() {
        val directory = temporary.newFolder()
        val cache = PublicDiscoveryCache(directory) { now }
        cache.write("key", page())
        now = now.plusSeconds(86_399)
        assertNotNull(cache.read("key"))
        now = now.plusSeconds(1)
        assertNull(cache.read("key"))
        cache.write("future", page().copy(fetchedAt = now.plusSeconds(1)))
        assertNull(cache.read("future"))
        cache.write("corrupt", page())
        directory.listFiles()!!.single().writeText("invalid JSON")
        assertNull(cache.read("corrupt"))
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun cacheHasHardEntryAndPayloadBoundsAndKeepsTheNewestWrite() {
        val directory = temporary.newFolder()
        val cache = PublicDiscoveryCache(directory) { now }
        repeat(25) { cache.write("key-$it", page()) }
        assertEquals(PublicDiscoveryCache.MAX_ENTRIES, directory.listFiles()!!.size)
        assertNotNull(cache.read("key-24"))
        cache.write("oversized", page().copy(cards = listOf(page().cards.single().copy(summary = "x".repeat(300_000)))))
        assertNull(cache.read("oversized"))
        assertTrue(directory.listFiles()!!.all { it.length() <= PublicDiscoveryCache.MAX_ENTRY_BYTES })
    }

    @Test fun zipAndCountyQueriesNeedNoGpsAndPreserveLeadingZeroZip() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        val zip = repository.url(DiscoveryQuery(postalCode = "01001", category = "food", status = "open"))
        assertEquals("01001", zip.queryParameter("postalCode"))
        assertNull(zip.queryParameter("latitude"))
        assertEquals("request", zip.queryParameter("postType"))
        assertEquals("open", zip.queryParameter("status"))
        val county = repository.url(DiscoveryQuery(countyId = "Cook County, Illinois"))
        assertNotNull(county.queryParameter("latitude"))
        assertEquals("20", county.queryParameter("pageSize"))
        val resource = repository.url(DiscoveryQuery(kind = DiscoveryKind.RESOURCES, postalCode = "01001"))
        assertNull(resource.queryParameter("postalCode"))
        assertNotNull(resource.queryParameter("latitude"))
    }

    @Test fun invalidOrAmbiguousAreasFailBeforeMakingAnyRequest() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        for (query in listOf(DiscoveryQuery(postalCode = "invalid"), DiscoveryQuery(countyId = "Cook County"),
            DiscoveryQuery(postalCode = "01001", countyId = "17031"))) {
            try { repository.load(query); fail() } catch (error: DiscoveryFailure) { assertEquals("INVALID_QUERY", error.code) }
        }
        assertEquals(0, server.requestCount)
    }

    @Test fun namedDiscoveryJourneyUsesAnonymousHttpAndBoundedStaleFallback() {
        val directory = temporary.newFolder()
        val cache = PublicDiscoveryCache(directory) { now }
        val repository = repository(cache)
        server.enqueue(MockResponse().addHeader("Set-Cookie", "patchwork_session=browser; Path=/").setBody(fixture("feed-global")))
        val first = repository.load(DiscoveryQuery(kind = DiscoveryKind.OFFERS))
        assertFalse(first.stale)
        assertEquals("Share spare groceries", first.value.cards.single().title)
        val request = server.takeRequest()
        assertEquals("offer", request.requestUrl!!.queryParameter("postType"))
        assertNull(request.getHeader("Authorization"))
        assertNull(request.getHeader("Cookie"))
        maintenance()
        val cached = repository.load(DiscoveryQuery(kind = DiscoveryKind.OFFERS))
        assertTrue(cached.stale)
        assertEquals("MAINTENANCE", cached.code)
        assertEquals(first.value.fetchedAt, cached.value.fetchedAt)
        assertNull(server.takeRequest().getHeader("Cookie"))
        now = now.plusSeconds(86_400)
        maintenance()
        try { repository.load(DiscoveryQuery(kind = DiscoveryKind.OFFERS)); fail() }
        catch (error: DiscoveryFailure) { assertEquals("MAINTENANCE", error.code) }
        assertTrue(directory.listFiles()!!.isEmpty())
    }

    @Test fun queryPagesAndDatasetsNeverBorrowEachOthersCachedRows() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        response("feed-global")
        repository.load(DiscoveryQuery(kind = DiscoveryKind.OFFERS))
        maintenance()
        try { repository.load(DiscoveryQuery(kind = DiscoveryKind.REQUESTS)); fail() }
        catch (error: DiscoveryFailure) { assertEquals("MAINTENANCE", error.code) }
        maintenance()
        try { repository.load(DiscoveryQuery(kind = DiscoveryKind.OFFERS, dataset = "community")); fail() }
        catch (error: DiscoveryFailure) { assertEquals("MAINTENANCE", error.code) }
    }

    @Test fun organizationPaginationUsesTheBoundedServerPageContract() {
        val original = JSONObject(fixture("discovery-organizations")).getJSONArray("organizations").getJSONObject(0)
        val rows = org.json.JSONArray(listOf(JSONObject(original.toString()).put("id", "org-20")))
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        server.enqueue(MockResponse().setBody(JSONObject().put("organizations", rows).put("page", 2).put("pageSize", 20)
            .put("total", 21).put("hasNextPage", false).toString()))
        val second = repository.load(DiscoveryQuery(kind = DiscoveryKind.ORGANIZATIONS, page = 2))
        assertEquals(21, second.value.total)
        assertEquals("org-20", second.value.cards.single().id)
        assertFalse(second.value.hasNext)
        val request = server.takeRequest().requestUrl!!
        assertEquals("2", request.queryParameter("page"))
        assertEquals("20", request.queryParameter("pageSize"))
        assertEquals("all", request.queryParameter("dataset"))
        assertEquals(1, page("discovery-organizations-page", DiscoveryKind.ORGANIZATIONS).cards.size)
    }

    @Test fun publicOrganizationAndLinkedResourceDetailsUseOnlyAnonymousPublicRoutes() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        response("discovery-organization-profile")
        val detail = repository.organization("11111111-1111-4111-8111-111111111111")
        val request = server.takeRequest()
        assertEquals("/api/organizations/profile", request.requestUrl!!.encodedPath)
        assertNull(request.getHeader("Authorization"))
        response("discovery-resources")
        assertEquals("Fictional Community Kitchen", repository.resource(detail.resourceUris.single(), "community").title)
        val resource = server.takeRequest().requestUrl!!
        assertEquals("/api/query/directory-resource", resource.encodedPath)
        assertEquals("community", resource.queryParameter("dataset"))
    }

    @Test fun malformedAndOversizedResponsesNeverBecomeSuccessfulEmptyPages() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        for (body in listOf("not JSON", "x".repeat(512 * 1024 + 1))) {
            server.enqueue(MockResponse().setBody(body))
            try { repository.load(DiscoveryQuery()); fail() }
            catch (error: DiscoveryFailure) { assertEquals("INVALID_RESPONSE", error.code) }
        }
    }

    @Test fun upstreamInvalidBodyCanOnlyFallBackToAnExplicitStalePublicSnapshot() {
        val repository = repository(PublicDiscoveryCache(temporary.newFolder()) { now })
        response("feed-global")
        val live = repository.load(DiscoveryQuery())
        server.enqueue(MockResponse().setResponseCode(502).setBody("<html>Bad gateway</html>"))
        val cached = repository.load(DiscoveryQuery())
        assertTrue(cached.stale)
        assertEquals("INVALID_RESPONSE", cached.code)
        assertEquals(live.value, cached.value)
    }
}
