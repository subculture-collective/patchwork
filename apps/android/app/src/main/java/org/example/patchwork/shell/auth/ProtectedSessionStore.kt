package org.example.patchwork.shell.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.time.Instant
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A non-exportable Android Keystore key protects the only persisted native credential. */
class ProtectedSessionStore(context: Context) : SessionStore {
    private val file = AtomicFile(File(context.noBackupFilesDir, "native-session-v1"))
    private val alias = context.packageName + ".native-session-v1"
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }

    override fun read(): NativeSession? {
        if (!file.baseFile.exists()) return null
        return try {
            if (file.baseFile.length() !in 29..4096) throw IllegalStateException("Invalid protected record")
            val bytes = file.readFully()
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            val json = JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
            NativeSession(json.getString("token"), Instant.parse(json.getString("expiresAt")), json.getString("apiBase"))
        } catch (_: Exception) {
            clear()
            null
        }
    }

    override fun write(session: NativeSession) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val content = JSONObject().put("token", session.token).put("expiresAt", session.expiresAt.toString())
            .put("apiBase", session.apiBase).toString().toByteArray(Charsets.UTF_8)
        val output = file.startWrite()
        try {
            output.write(cipher.iv + cipher.doFinal(content))
            file.finishWrite(output)
        } catch (error: Exception) { file.failWrite(output); throw error }
    }

    override fun clear() { file.delete() }
}
