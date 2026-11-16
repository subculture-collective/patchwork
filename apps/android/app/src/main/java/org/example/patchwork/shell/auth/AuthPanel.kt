package org.example.patchwork.shell.auth

import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.example.patchwork.shell.BuildConfig
import org.example.patchwork.shell.R

class AuthViewModel(application: Application) : AndroidViewModel(application) {
    private val engine = NativeAuth(AuthHttpApi(BuildConfig.API_BASE_URL), ProtectedSessionStore(application),
        BuildConfig.APPLICATION_ID + ".oauth://callback")
    private val mutex = Mutex()
    var state by mutableStateOf(AuthState())
        private set
    var busy by mutableStateOf(true)
        private set

    init { action { engine.restore() } }

    private fun action(effect: () -> Unit) {
        viewModelScope.launch {
            mutex.withLock {
                busy = true
                withContext(Dispatchers.IO) {
                    try { effect() } catch (error: Exception) { engine.failed(error) }
                }
                state = engine.state
                busy = false
            }
        }
    }

    fun begin(handle: String, openBrowser: (String) -> Unit) {
        viewModelScope.launch {
            mutex.withLock {
                busy = true
                try {
                    val url = withContext(Dispatchers.IO) { engine.begin(handle) }
                    openBrowser(url)
                } catch (error: Exception) { engine.failed(error) }
                state = engine.state
                busy = false
            }
        }
    }
    fun callback(value: String) = action { engine.complete(value) }
    fun cancel() = action { engine.cancel() }
    fun accept(adult: Boolean, documents: Boolean) = action { engine.accept(adult, documents) }
    fun refresh() = action { engine.restore(true) }
    fun logout() = action { engine.logout() }
    fun revalidateIfSignedIn() {
        if (!busy && state.phase in setOf(AuthPhase.READY, AuthPhase.CONSENT)) refresh()
    }
}

@Composable
fun NativeAuthPanel(model: AuthViewModel = viewModel()) {
    val context = LocalContext.current
    AuthPanel(model.state, model.busy, onBegin = { handle ->
        model.begin(handle) { url -> context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) }
    }, onCancel = model::cancel, onAccept = model::accept, onRefresh = model::refresh, onLogout = model::logout)
}

private val documentLabels = mapOf(
    "terms-of-use" to R.string.consent_terms,
    "privacy-notice" to R.string.consent_privacy,
    "community-guidelines" to R.string.consent_guidelines,
    "synthetic-data-disclosure" to R.string.consent_synthetic,
    "location-sharing-consent" to R.string.consent_location
)

@Composable
fun AuthPanel(
    state: AuthState, busy: Boolean, onBegin: (String) -> Unit, onCancel: () -> Unit,
    onAccept: (Boolean, Boolean) -> Unit, onRefresh: () -> Unit, onLogout: () -> Unit
) {
    Text(stringResource(R.string.auth_title), style = MaterialTheme.typography.titleMedium)
    if (busy) {
        Text(stringResource(R.string.auth_loading), Modifier.testTag("auth.loading"))
        return
    }
    state.code?.let { code ->
        val message = when (code) {
            "SIGN_IN_CANCELLED" -> R.string.auth_cancelled
            "SIGN_IN_INTERRUPTED", "NATIVE_HANDOFF_INVALID" -> R.string.auth_interrupted
            "SESSION_EXPIRED", "UNAUTHORIZED", "ACCOUNT_DEACTIVATED", "FORBIDDEN" -> R.string.auth_expired
            "NATIVE_AUTH_UNAVAILABLE" -> R.string.auth_unavailable
            "SESSION_STORAGE_UNAVAILABLE" -> R.string.auth_storage_unavailable
            "LOCAL_LOGOUT_ONLY" -> R.string.auth_local_logout
            "INVALID_HANDLE" -> R.string.auth_invalid_handle
            else -> R.string.auth_failed
        }
        Text(stringResource(message), Modifier.testTag("auth.message"))
    }
    when (state.phase) {
        AuthPhase.SIGNED_OUT -> {
            // Handles are memory-only too; do not restore another account's text after process death/logout.
            var handle by remember { mutableStateOf("") }
            OutlinedTextField(handle, { handle = it }, singleLine = true,
                label = { Text(stringResource(R.string.auth_handle)) }, modifier = Modifier.fillMaxWidth().testTag("auth.handle"))
            Button(onClick = { onBegin(handle) }, enabled = handle.isNotBlank(), modifier = Modifier.testTag("auth.start")) {
                Text(stringResource(R.string.auth_sign_in))
            }
        }
        AuthPhase.BROWSER -> {
            Text(stringResource(R.string.auth_browser_pending))
            TextButton(onClick = onCancel, modifier = Modifier.testTag("auth.cancel")) { Text(stringResource(R.string.auth_cancel)) }
        }
        AuthPhase.CONSENT -> {
            val policy = state.policy ?: return
            // A new account or policy version starts with every acknowledgement unchecked.
            key(state.did, policy.version) {
                var accepted by rememberSaveable { mutableStateOf(setOf<String>()) }
                var adult by rememberSaveable { mutableStateOf(false) }
                Text(stringResource(R.string.consent_title))
                Text(stringResource(R.string.consent_version, policy.version))
                if (policy.documents.toSet() != documentLabels.keys || policy.documents.size != documentLabels.size) {
                    Text(stringResource(R.string.auth_policy_unavailable))
                } else {
                    policy.documents.forEach { document ->
                        Acknowledgement(stringResource(R.string.consent_accept, stringResource(documentLabels.getValue(document))),
                            document in accepted, "consent.$document") { checked ->
                            accepted = if (checked) accepted + document else accepted - document
                        }
                    }
                    Acknowledgement(stringResource(R.string.consent_age), adult, "consent.adult") { adult = it }
                    Button(onClick = { onAccept(adult, accepted.containsAll(policy.documents)) },
                        enabled = adult && accepted.containsAll(policy.documents), modifier = Modifier.testTag("auth.accept")) {
                        Text(stringResource(R.string.consent_continue))
                    }
                }
            }
        }
        AuthPhase.READY -> Text(stringResource(R.string.auth_signed_in, state.did.orEmpty()), Modifier.testTag("auth.ready"))
        AuthPhase.UNAVAILABLE -> Text(stringResource(R.string.auth_session_unavailable))
    }
    if (state.phase in setOf(AuthPhase.READY, AuthPhase.CONSENT, AuthPhase.UNAVAILABLE)) {
        TextButton(onClick = onRefresh, modifier = Modifier.testTag("auth.refresh")) { Text(stringResource(R.string.auth_refresh)) }
        TextButton(onClick = onLogout, modifier = Modifier.testTag("auth.logout")) { Text(stringResource(R.string.auth_sign_out)) }
    }
}

@Composable
private fun Acknowledgement(label: String, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().testTag(tag).toggleable(checked, role = Role.Checkbox, onValueChange = onChange)
        .padding(vertical = 8.dp)) {
        Checkbox(checked, onCheckedChange = null)
        Text(label, Modifier.padding(start = 8.dp))
    }
}
