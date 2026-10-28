package com.openpath.vpn

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** AES-GCM ciphertext in app-private preferences; the key never leaves Android Keystore. */
class SecureProfileStore(
    context: Context,
    private val keyProvider: () -> SecretKey = { androidKey() },
) {
    private val preferences = context.getSharedPreferences("wireguard_profile", Context.MODE_PRIVATE)
    fun exists(): Boolean = preferences.contains("ciphertext")

    fun save(bytes: ByteArray) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, keyProvider())
        val blob = byteArrayOf(1) + cipher.iv + cipher.doFinal(bytes)
        check(preferences.edit().putString("ciphertext", Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) {
            "Could not save encrypted profile."
        }
    }

    fun load(): ByteArray {
        val encoded = preferences.getString("ciphertext", null) ?: throw IllegalStateException("Import a profile first.")
        val blob = Base64.decode(encoded, Base64.NO_WRAP)
        require(blob.size >= 1 + 12 + 16 && blob[0] == 1.toByte()) { "Stored profile is invalid." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, keyProvider(), GCMParameterSpec(128, blob.copyOfRange(1, 13)))
        return cipher.doFinal(blob.copyOfRange(13, blob.size))
    }

    fun remove() {
        check(preferences.edit().remove("ciphertext").commit()) { "Could not remove the profile." }
    }

    companion object {
        private const val ALIAS = "openpath-wireguard-profile-v1"
        private fun androidKey(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build()
            )
            return generator.generateKey()
        }
    }
}
