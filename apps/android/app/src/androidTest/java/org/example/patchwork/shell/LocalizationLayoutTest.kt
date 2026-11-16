package org.example.patchwork.shell

import android.content.res.Configuration
import android.os.LocaleList
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class LocalizationLayoutTest {
    @get:Rule val compose = createComposeRule()

    private fun render(tag: String) {
        val base = InstrumentationRegistry.getInstrumentation().targetContext
        val configuration = Configuration(base.resources.configuration).apply {
            setLocales(LocaleList.forLanguageTags(tag))
            fontScale = 2f
        }
        val context = base.createConfigurationContext(configuration)
        if (tag == "en-XA") assertNotEquals("Browse", context.getString(R.string.shell_browse))
        if (tag == "ar-XB") {
            assertNotEquals("Browse", context.getString(R.string.shell_browse))
            assertEquals(android.view.View.LAYOUT_DIRECTION_RTL, configuration.layoutDirection)
        }
        compose.setContent {
            CompositionLocalProvider(
                LocalContext provides context,
                LocalConfiguration provides configuration,
                LocalDensity provides Density(LocalDensity.current.density, 2f),
                LocalLayoutDirection provides if (tag == "ar-XB") LayoutDirection.Rtl else LayoutDirection.Ltr
            ) {
                MaterialTheme {
                    Box(Modifier.width(320.dp).fillMaxHeight()) {
                        PatchworkShell { Text(stringResource(R.string.shell_welcome)) }
                    }
                }
            }
        }
        compose.onNodeWithTag("shell.about").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithTag("about.back").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithTag("tab.settings").assertIsDisplayed().performClick()
        compose.onNodeWithTag("language.system").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("language.en").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("language.es").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("shell.about").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithTag("about.back").performScrollTo().assertIsDisplayed()
        // Navigation remains reachable with an expanded/RTL label at 200% font size.
        compose.onNodeWithTag("tab.browse").assertIsDisplayed()
    }

    @Test fun expansionPseudolocaleWithLargeText() = render("en-XA")
    @Test fun rtlPseudolocaleWithLargeText() = render("ar-XB")

    @Test fun composePluralApiReceivesQuantityAndFormatArgument() {
        compose.setContent {
            Text(pluralStringResource(R.plurals.discovery_result_count, 2, 2), Modifier.testTag("plural"))
        }
        compose.onNodeWithTag("plural").assertTextEquals("2 results")
    }
}
