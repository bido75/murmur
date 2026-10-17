package com.murmur.wear

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.File

/** Device token (encrypted) and the folder where recordings wait until they upload. */
object Store {
    private fun prefs(ctx: Context) = EncryptedSharedPreferences.create(
        ctx, "murmur", MasterKey.Builder(ctx).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV, EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun token(ctx: Context): String? = prefs(ctx).getString("token", null)
    fun setToken(ctx: Context, t: String?) = prefs(ctx).edit().apply { if (t == null) remove("token") else putString("token", t) }.apply()

    fun pendingDir(ctx: Context): File = File(ctx.filesDir, "pending").apply { mkdirs() }
    fun pendingCount(ctx: Context): Int = pendingDir(ctx).listFiles { f -> f.extension == "m4a" }?.size ?: 0
}
