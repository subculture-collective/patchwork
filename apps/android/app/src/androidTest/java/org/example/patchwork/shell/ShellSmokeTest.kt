package org.example.patchwork.shell

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import org.junit.Rule
import org.junit.Test

class ShellSmokeTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    @Test fun launchAndNavigateBetweenTabsAndAbout() {
        compose.onNodeWithTag("shell.about").assertIsDisplayed().performClick()
        compose.onNodeWithTag("about.back").assertIsDisplayed().performClick()
        compose.onNodeWithTag("tab.settings").performClick()
        compose.onNodeWithTag("shell.about").performClick()
        compose.onNodeWithTag("about.back").assertIsDisplayed().performClick()
        compose.onNodeWithTag("tab.browse").performClick()
        compose.onNodeWithTag("shell.about").assertIsDisplayed()
    }
}
