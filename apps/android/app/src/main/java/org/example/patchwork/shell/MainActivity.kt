package org.example.patchwork.shell

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AppCompatDelegate
import androidx.core.os.LocaleListCompat
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import java.util.Locale
import org.xmlpull.v1.XmlPullParser
import org.example.patchwork.shell.discovery.NativeDiscoveryPanel

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val colors = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xffbed2b1))
                else lightColorScheme(primary = Color(0xff45593b))
            MaterialTheme(colorScheme = colors) { PatchworkShell() }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PatchworkShell(discoveryContent: @Composable () -> Unit = { NativeDiscoveryPanel() }) {
    var selectedTab by rememberSaveable { mutableIntStateOf(0) }
    var about by rememberSaveable { mutableStateOf(false) }
    BackHandler(enabled = about) { about = false }
    Scaffold(
        topBar = { TopAppBar(title = {
            Text(stringResource(if (about) R.string.shell_about else if (selectedTab == 0) R.string.app_title else R.string.shell_settings))
        }) },
        bottomBar = {
            NavigationBar {
                listOf(R.string.shell_browse, R.string.shell_settings).forEachIndexed { index, label ->
                    NavigationBarItem(selected = selectedTab == index,
                        onClick = { selectedTab = index; about = false },
                        icon = { Icon(if (index == 0) Icons.Default.Home else Icons.Default.Settings, contentDescription = null) },
                        label = { Text(stringResource(label)) },
                        modifier = Modifier.testTag(if (index == 0) "tab.browse" else "tab.settings"))
                }
            }
        }
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            if (about) {
                Text(stringResource(R.string.shell_purpose), style = MaterialTheme.typography.headlineSmall)
                Text(stringResource(R.string.shell_environment, BuildConfig.ENVIRONMENT))
                Text(stringResource(R.string.shell_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE))
                TextButton(onClick = { about = false }, modifier = Modifier.testTag("about.back")) {
                    Text(stringResource(R.string.shell_back))
                }
            } else {
                if (selectedTab == 0) discoveryContent()
                else LanguagePicker()
                Button(onClick = { about = true }, modifier = Modifier.testTag("shell.about")) {
                    Text(stringResource(R.string.shell_about))
                }
            }
        }
    }
}

@Composable
private fun LanguagePicker() {
    val context = LocalContext.current
    val languages = remember(context) {
        buildList {
            context.resources.getXml(R.xml.locales_config).use { xml ->
                while (xml.next() != XmlPullParser.END_DOCUMENT) {
                    if (xml.eventType == XmlPullParser.START_TAG && xml.name == "locale") {
                        add(xml.getAttributeValue("http://schemas.android.com/apk/res/android", "name"))
                    }
                }
            }
        }
    }
    val selected = AppCompatDelegate.getApplicationLocales().toLanguageTags()
    Text(stringResource(R.string.settings_language), style = MaterialTheme.typography.titleMedium)
    Column(Modifier.selectableGroup()) {
        (listOf("") + languages).forEach { tag ->
            Row(
                Modifier.fillMaxWidth().testTag("language.${tag.ifEmpty { "system" }}")
                    .selectable(selected = selected == tag, role = Role.RadioButton, onClick = {
                        AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag))
                    }).padding(vertical = 8.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically
            ) {
                RadioButton(selected = selected == tag, onClick = null)
                // Language self-names come from the OS locale registry, not translated sentence fragments.
                Text(if (tag.isEmpty()) stringResource(R.string.settings_language_system)
                    else Locale.forLanguageTag(tag).let { it.getDisplayName(it) },
                    modifier = Modifier.padding(start = 8.dp))
            }
        }
    }
}
