package org.example.patchwork.shell

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
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
fun PatchworkShell() {
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
                if (selectedTab == 0) Text(stringResource(R.string.shell_welcome))
                Button(onClick = { about = true }, modifier = Modifier.testTag("shell.about")) {
                    Text(stringResource(R.string.shell_about))
                }
            }
        }
    }
}
