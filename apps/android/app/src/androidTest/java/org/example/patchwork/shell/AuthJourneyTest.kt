package org.example.patchwork.shell

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.runtime.*
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.example.patchwork.shell.auth.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.Instant

class AuthJourneyTest {
    @get:Rule val compose = createComposeRule()

    @Test fun consentJourneyRequiresEveryDocumentAndAdultConfirmation() {
        val documents = listOf("terms-of-use", "privacy-notice", "community-guidelines", "synthetic-data-disclosure", "location-sharing-consent")
        var accepted = false
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    AuthPanel(AuthState(AuthPhase.CONSENT, "did:plc:fixture", PolicyStatus("2026-07-28", documents, true)),
                        false, {}, {}, { adult, all -> accepted = adult && all }, {}, {})
                }
            }
        }
        compose.onNodeWithTag("auth.accept").assertIsNotEnabled()
        documents.forEach { compose.onNodeWithTag("consent.$it").performScrollTo().performClick() }
        compose.onNodeWithTag("auth.accept").assertIsNotEnabled()
        compose.onNodeWithTag("consent.adult").performScrollTo().performClick()
        compose.onNodeWithTag("auth.accept").performScrollTo().assertIsEnabled().performClick()
        assertTrue(accepted)
    }

    @Test fun browserCancellationAndUnknownErrorsHaveExplicitNativeStates() {
        var current by mutableStateOf(AuthState(AuthPhase.BROWSER))
        compose.setContent {
            MaterialTheme {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    AuthPanel(current, false, {}, { current = AuthState(code = "SIGN_IN_CANCELLED") }, { _, _ -> }, {}, {})
                }
            }
        }
        compose.onNodeWithTag("auth.cancel").performClick()
        compose.onNodeWithTag("auth.start").assertExists()
        compose.onNodeWithTag("auth.message").assertTextEquals("Sign-in cancelled.")
        compose.runOnIdle { current = AuthState(code = "UNKNOWN_FUTURE_ERROR") }
        compose.onNodeWithTag("auth.message").assertTextEquals("Sign-in could not be completed. Check your connection and try again.")
    }

    @Test fun keystoreRecordIsEncryptedRestorableAndTamperFailsClosed() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = ProtectedSessionStore(context)
        // Only this reserved shell's disposable session file is touched by the fixture.
        val path = File(context.noBackupFilesDir, "native-session-v1")
        store.clear()
        try {
            val fixture = NativeSession("s".repeat(43), Instant.parse("2026-11-16T13:00:00Z"), "https://api.example.test")
            store.write(fixture)
            assertFalse(path.readBytes().toString(Charsets.ISO_8859_1).contains(fixture.token))
            assertEquals(fixture.token, ProtectedSessionStore(context).read()?.token)
            val bytes = path.readBytes()
            bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte()
            path.writeBytes(bytes)
            assertNull(store.read())
            assertFalse(path.exists())
        } finally { store.clear() }
    }
}
