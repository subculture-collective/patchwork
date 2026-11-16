package org.example.patchwork.shell

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import java.time.Instant
import org.example.patchwork.shell.discovery.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class DiscoveryJourneyTest {
    @get:Rule val compose = createComposeRule()
    private val now = Instant.parse("2026-11-16T12:00:00Z")
    private val card = PublicCard("at://did:example:fixture/post/one", "Fictional groceries", "A fictional public example.", "synthetic",
        status = "future-state", postType = "offer")

    @Test fun publicListJourneyShowsDemoStaleAndUnknownStateDetails() {
        var state by mutableStateOf(DiscoveryState(result = DiscoveryResult(PublicPage(listOf(card), 1, 1, false, now), true)))
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    DiscoveryPanel(state, {}, { state = state.copy(selected = it) }, { state = state.copy(selected = null) }, {})
                }
            }
        }
        compose.onNodeWithTag("discovery.stale").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Fictional demo listing").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("discovery.card").performScrollTo().performClick()
        compose.onNodeWithText("Status unavailable").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("discovery.back").performScrollTo().performClick()
        compose.onNodeWithTag("discovery.card").assertExists()
    }

    @Test fun zipSearchAndPaginationRemainAvailableWithoutLocationPermission() {
        var state by mutableStateOf(DiscoveryState(result = DiscoveryResult(PublicPage(listOf(card), 1, 21, true, now), false)))
        var submitted: DiscoveryQuery? = null
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    DiscoveryPanel(state, { submitted = it; state = state.copy(query = it) }, {}, {}, {})
                }
            }
        }
        compose.onNodeWithTag("discovery.zip").performTextInput("01001")
        compose.onNodeWithTag("discovery.apply").performScrollTo().performClick()
        assertEquals("01001", submitted?.postalCode)
        compose.onNodeWithTag("discovery.next").performScrollTo().assertIsEnabled().performClick()
        assertEquals(2, submitted?.page)
    }

    @Test fun loadingEmptyErrorAndMaintenanceAreDistinct() {
        var state by mutableStateOf(DiscoveryState(busy = true))
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) { DiscoveryPanel(state, {}, {}, {}, {}) }
            }
        }
        compose.onNodeWithTag("discovery.loading").performScrollTo().assertIsDisplayed()
        compose.runOnIdle { state = DiscoveryState(code = "MAINTENANCE") }
        compose.onNodeWithTag("discovery.error").performScrollTo().assertTextContains("maintenance", substring = true)
        compose.onNodeWithTag("discovery.empty").assertDoesNotExist()
        compose.runOnIdle { state = DiscoveryState(result = DiscoveryResult(PublicPage(emptyList(), 1, 0, false, now), false)) }
        compose.onNodeWithTag("discovery.empty").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("discovery.error").assertDoesNotExist()
    }
}
