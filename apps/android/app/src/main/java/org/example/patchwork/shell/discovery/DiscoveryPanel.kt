package org.example.patchwork.shell.discovery

import android.app.Application
import android.app.LocaleManager
import android.content.res.Resources
import android.os.Build
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import java.io.File
import java.text.DateFormat
import java.util.Date
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.example.patchwork.shell.BuildConfig
import org.example.patchwork.shell.R
import org.json.JSONObject

data class DiscoveryState(val query: DiscoveryQuery = DiscoveryQuery(), val result: DiscoveryResult? = null,
    val selected: PublicCard? = null, val code: String? = null, val busy: Boolean = false, val detailFresh: Boolean = false)

class DiscoveryViewModel(application: Application) : AndroidViewModel(application) {
    private val repository by lazy {
        fun asset(name: String) = application.assets.open(name).bufferedReader().use { JSONObject(it.readText()) }
        PublicDiscoveryRepository(BuildConfig.API_BASE_URL,
            PublicGeography(asset("postal-index.json"), asset("county-index.json"), asset("geography-names.json")),
            PublicDiscoveryCache(File(application.cacheDir, "public-discovery-v1")))
    }
    var state by mutableStateOf(DiscoveryState())
        private set
    private var generation = 0
    init { load(DiscoveryQuery()) }

    fun load(query: DiscoveryQuery) {
        val ticket = ++generation
        state = DiscoveryState(query, busy = true)
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { repository.load(query) } }
            if (ticket != generation) return@launch
            state = result.fold({ DiscoveryState(query, result = it) }, {
                DiscoveryState(query, code = (it as? DiscoveryFailure)?.code ?: "REQUEST_FAILED")
            })
        }
    }

    fun select(card: PublicCard) {
        val ticket = ++generation
        val organization = state.query.kind == DiscoveryKind.ORGANIZATIONS
        state = state.copy(selected = card, code = null, busy = organization, detailFresh = false)
        if (!organization) return
        detail(ticket) { repository.organization(card.id) }
    }
    fun resource(uri: String) {
        val ticket = ++generation
        val dataset = state.query.dataset
        state = state.copy(code = null, busy = true)
        detail(ticket) { repository.resource(uri, dataset) }
    }
    private fun detail(ticket: Int, fetch: () -> PublicCard) {
        viewModelScope.launch {
            val result = withContext(Dispatchers.IO) { runCatching { fetch() } }
            if (ticket != generation) return@launch
            state = result.fold({ state.copy(selected = it, busy = false, detailFresh = true) }, {
                state.copy(code = "DETAIL_UNAVAILABLE", busy = false)
            })
        }
    }
    fun back() { ++generation; state = state.copy(selected = null, busy = false, code = null, detailFresh = false) }
}

private val kindLabels = mapOf(DiscoveryKind.REQUESTS to R.string.discovery_requests, DiscoveryKind.OFFERS to R.string.discovery_offers,
    DiscoveryKind.RESOURCES to R.string.discovery_resources, DiscoveryKind.VOLUNTEERS to R.string.discovery_volunteers,
    DiscoveryKind.ORGANIZATIONS to R.string.discovery_organizations)
private val categoryLabels = mapOf(
    "" to R.string.discovery_all_categories, "food" to R.string.category_food,
    "shelter" to R.string.category_shelter, "medical" to R.string.category_medical,
    "transport" to R.string.category_transport, "childcare" to R.string.category_childcare, "other" to R.string.category_other,
    "food-bank" to R.string.category_food_bank, "clinic" to R.string.category_clinic,
    "legal-aid" to R.string.category_legal_aid, "hotline" to R.string.category_hotline, "library" to R.string.category_library)
private val statusLabels = mapOf(
    "open" to R.string.status_open, "in-progress" to R.string.status_in_progress, "resolved" to R.string.status_resolved,
    "closed" to R.string.status_closed, "unverified" to R.string.status_unverified,
    "community-verified" to R.string.status_community_verified, "partner-verified" to R.string.status_partner_verified,
    "immediate" to R.string.status_immediate, "within-24h" to R.string.status_within_day,
    "scheduled" to R.string.status_scheduled, "unavailable" to R.string.status_unavailable)

@Composable
fun NativeDiscoveryPanel(model: DiscoveryViewModel = viewModel()) {
    androidx.activity.compose.BackHandler(enabled = model.state.selected != null) { model.back() }
    DiscoveryPanel(model.state, model::load, model::select, model::back, model::resource)
}

@Composable
fun DiscoveryPanel(state: DiscoveryState, load: (DiscoveryQuery) -> Unit, select: (PublicCard) -> Unit,
    back: () -> Unit, resource: (String) -> Unit) {
    if (state.selected != null) {
        TextButton(onClick = back, modifier = Modifier.testTag("discovery.back")) { Text(stringResource(R.string.discovery_back)) }
        state.result?.takeIf { it.stale && !state.detailFresh }?.let { Text(stringResource(R.string.discovery_cached)) }
        PublicCardDetail(state.selected, resource, !state.busy)
        if (state.busy) Text(stringResource(R.string.discovery_loading))
        if (state.code != null) Text(stringResource(R.string.discovery_detail_unavailable), Modifier.testTag("discovery.error"))
        return
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        KindMenu(state.query.kind, state.busy) { load(DiscoveryQuery(kind = it)) }
    }
    key(state.query.kind) {
        var search by rememberSaveable { mutableStateOf(state.query.search) }
        var postal by rememberSaveable { mutableStateOf(state.query.postalCode) }
        var county by rememberSaveable { mutableStateOf(state.query.countyId) }
        var category by rememberSaveable { mutableStateOf(state.query.category) }
        var dataset by rememberSaveable { mutableStateOf(state.query.dataset) }
        var status by rememberSaveable { mutableStateOf(state.query.status) }
        OutlinedTextField(search, { search = it }, enabled = !state.busy, singleLine = true,
            label = { Text(stringResource(R.string.discovery_search)) }, modifier = Modifier.fillMaxWidth().testTag("discovery.search"))
        if (state.query.kind in setOf(DiscoveryKind.REQUESTS, DiscoveryKind.OFFERS, DiscoveryKind.RESOURCES)) {
            Text(stringResource(R.string.discovery_area_help))
            OutlinedTextField(postal, { postal = it }, enabled = !state.busy, singleLine = true,
                label = { Text(stringResource(R.string.discovery_zip)) }, modifier = Modifier.fillMaxWidth().testTag("discovery.zip"))
            OutlinedTextField(county, { county = it }, enabled = !state.busy, singleLine = true,
                label = { Text(stringResource(R.string.discovery_county)) }, modifier = Modifier.fillMaxWidth().testTag("discovery.county"))
            val categories = if (state.query.kind == DiscoveryKind.RESOURCES)
                listOf("", "food-bank", "shelter", "clinic", "legal-aid", "hotline", "library", "other")
                else listOf("", "food", "shelter", "medical", "transport", "childcare", "other")
            ChoiceMenu(category, categories, { stringResource(categoryLabels.getValue(it)) }, !state.busy, "discovery.category") { category = it }
        }
        if (state.query.kind != DiscoveryKind.ORGANIZATIONS) {
            val statuses = when (state.query.kind) {
                DiscoveryKind.RESOURCES -> listOf("", "unverified", "community-verified", "partner-verified")
                DiscoveryKind.VOLUNTEERS -> listOf("", "immediate", "within-24h", "scheduled", "unavailable")
                else -> listOf("", "open", "in-progress", "resolved", "closed")
            }
            ChoiceMenu(status, statuses, { stringResource(if (it.isEmpty()) R.string.discovery_all_statuses else statusLabels.getValue(it)) },
                !state.busy, "discovery.status") { status = it }
        }
        ChoiceMenu(dataset, listOf("all", "community", "demo"), {
            stringResource(when (it) { "community" -> R.string.discovery_community; "demo" -> R.string.discovery_demo_only; else -> R.string.discovery_all_data })
        }, !state.busy, "discovery.dataset") { dataset = it }
        Button(enabled = !state.busy, onClick = {
            load(DiscoveryQuery(state.query.kind, search.trim(), postal.trim(), county.trim(), category, dataset, status = status))
        }, modifier = Modifier.testTag("discovery.apply")) { Text(stringResource(R.string.discovery_find)) }
    }
    if (state.busy) {
        Text(stringResource(R.string.discovery_loading), Modifier.testTag("discovery.loading"))
        return
    }
    state.code?.let {
        Text(stringResource(when (it) { "INVALID_QUERY" -> R.string.discovery_invalid_query
            "MAINTENANCE" -> R.string.discovery_maintenance; else -> R.string.discovery_failed }), Modifier.testTag("discovery.error"))
    }
    state.result?.let { result ->
        if (result.stale) Text(stringResource(if (result.code == "MAINTENANCE") R.string.discovery_maintenance_cached else R.string.discovery_cached),
            Modifier.testTag("discovery.stale"))
        val time = displayTime(result.value.fetchedAt.toString())
        Text(stringResource(R.string.discovery_fetched, time))
        if (result.value.projectedAt.isNotEmpty()) Text(stringResource(R.string.discovery_projected, displayTime(result.value.projectedAt)))
        if (result.value.cards.isEmpty()) Text(stringResource(R.string.discovery_empty), Modifier.testTag("discovery.empty"))
        result.value.cards.forEach { card ->
            OutlinedCard(onClick = { select(card) }, modifier = Modifier.fillMaxWidth().testTag("discovery.card")) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(card.title, style = MaterialTheme.typography.titleMedium)
                    Provenance(card)
                    if (card.summary.isNotEmpty()) Text(card.summary, maxLines = 3)
                    Text(stringResource(R.string.discovery_details))
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(enabled = state.query.page > 1, onClick = { load(state.query.copy(page = state.query.page - 1)) },
                modifier = Modifier.testTag("discovery.previous")) { Text(stringResource(R.string.discovery_previous)) }
            TextButton(enabled = result.value.hasNext, onClick = { load(state.query.copy(page = state.query.page + 1)) },
                modifier = Modifier.testTag("discovery.next")) { Text(stringResource(R.string.discovery_next)) }
        }
        Text(stringResource(R.string.discovery_page, result.value.page, result.value.total))
    }
}

@Composable
private fun KindMenu(kind: DiscoveryKind, busy: Boolean, select: (DiscoveryKind) -> Unit) {
    ChoiceMenu(kind, DiscoveryKind.entries, { stringResource(kindLabels.getValue(it)) }, !busy, "discovery.kind", select)
}

@Composable
private fun <T> ChoiceMenu(selected: T, choices: List<T>, label: @Composable (T) -> String,
    enabled: Boolean, tag: String, select: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, enabled = enabled, modifier = Modifier.testTag(tag)) { Text(label(selected)) }
        DropdownMenu(expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { choice -> DropdownMenuItem(text = { Text(label(choice)) },
                onClick = { expanded = false; select(choice) }, modifier = Modifier.testTag("$tag.$choice")) }
        }
    }
}

@Composable
private fun Provenance(card: PublicCard) {
    Text(stringResource(when (card.origin) {
        "synthetic" -> R.string.discovery_demo
        "sourced-public" -> R.string.discovery_sourced
        "visitor-created", "member-created" -> R.string.discovery_member
        else -> R.string.discovery_origin_unknown
    }))
    if (card.origin == "sourced-public") Text(stringResource(R.string.discovery_non_participation))
    if (card.nonEndorsement.isNotEmpty()) Text(card.nonEndorsement)
}

@Composable
private fun PublicCardDetail(card: PublicCard, resource: (String) -> Unit, enabled: Boolean) {
    Text(card.title, style = MaterialTheme.typography.headlineSmall)
    Provenance(card)
    if (card.postType.isNotEmpty()) Text(stringResource(when (card.postType) {
        "request" -> R.string.discovery_requests; "offer" -> R.string.discovery_offers; else -> R.string.discovery_type_unknown
    }))
    if (card.status.isNotEmpty()) Text(stringResource(statusLabels[card.status] ?: R.string.status_unknown))
    if (card.category.isNotEmpty()) Text(stringResource(categoryLabels[card.category] ?: R.string.category_unknown))
    if (card.summary.isNotEmpty()) Text(card.summary)
    if (card.area.isNotEmpty()) Text(stringResource(R.string.discovery_service_area, card.area))
    if (card.hours.isNotEmpty()) Text(stringResource(R.string.discovery_hours, card.hours))
    if (card.eligibility.isNotEmpty()) Text(stringResource(R.string.discovery_eligibility, card.eligibility))
    if (card.phone.isNotEmpty()) Text(stringResource(R.string.discovery_phone, card.phone))
    if (card.contactUrl.isNotEmpty()) Text(stringResource(R.string.discovery_website, card.contactUrl))
    if (card.sourceName.isNotEmpty()) Text(stringResource(R.string.discovery_source, card.sourceName))
    if (card.sourceUrl.isNotEmpty()) Text(stringResource(R.string.discovery_source_url, card.sourceUrl))
    if (card.retrievedAt.isNotEmpty()) Text(stringResource(R.string.discovery_retrieved, displayTime(card.retrievedAt)))
    if (card.verifiedAt.isNotEmpty()) Text(stringResource(R.string.discovery_verified, displayTime(card.verifiedAt)))
    if (card.capabilities.isNotEmpty()) Text(stringResource(R.string.discovery_capabilities,
        card.capabilities.map { stringResource(categoryLabels[it] ?: R.string.category_other) }.joinToString(", ")))
    if (card.languages.isNotEmpty()) Text(stringResource(R.string.discovery_languages,
        card.languages.joinToString(", ") { Locale.forLanguageTag(it).let { language -> language.getDisplayName(language) } }))
    card.resourceUris.forEachIndexed { index, uri ->
        TextButton(onClick = { resource(uri) }, enabled = enabled) { Text(stringResource(R.string.discovery_linked_resource, index + 1)) }
    }
}

@Composable
private fun displayTime(value: String): String {
    val context = LocalContext.current
    val locale = if (Build.VERSION.SDK_INT >= 33) context.getSystemService(LocaleManager::class.java).systemLocales[0]
        else Resources.getSystem().configuration.locales[0]
    return runCatching {
        DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT, locale).format(Date.from(java.time.Instant.parse(value)))
    }.getOrNull() ?: stringResource(R.string.discovery_time_unknown)
}
