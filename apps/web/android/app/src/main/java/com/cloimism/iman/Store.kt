package com.cloimism.iman

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 앱 로컬 상태. 토큰은 Android Keystore 의 AES 키로 암호화해 보관한다.
 * 리프레시 토큰은 네이티브만 갖고, WebView 는 액세스 토큰만 받아 쓴다.
 */
object Store {
    private const val PREFS = "iman"
    private const val KEY_ALIAS = "iman_store_key"
    private const val TRANSFORM = "AES/GCM/NoPadding"

    fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    fun putSecret(ctx: Context, name: String, value: String?) {
        val p = prefs(ctx).edit()
        if (value == null) {
            p.remove("s.$name").apply()
            return
        }
        val c = Cipher.getInstance(TRANSFORM).apply { init(Cipher.ENCRYPT_MODE, key()) }
        val enc = c.iv + c.doFinal(value.toByteArray(Charsets.UTF_8))
        p.putString("s.$name", Base64.encodeToString(enc, Base64.NO_WRAP)).apply()
    }

    fun getSecret(ctx: Context, name: String): String? {
        val raw = prefs(ctx).getString("s.$name", null) ?: return null
        return try {
            val bytes = Base64.decode(raw, Base64.NO_WRAP)
            val c = Cipher.getInstance(TRANSFORM)
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
            String(c.doFinal(bytes, 12, bytes.size - 12), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    fun installId(ctx: Context): String {
        val p = prefs(ctx)
        p.getString("installId", null)?.let { return it }
        val id = UUID.randomUUID().toString()
        p.edit().putString("installId", id).apply()
        return id
    }

    fun deviceId(ctx: Context): String? = prefs(ctx).getString("deviceId", null)
    fun setDeviceId(ctx: Context, id: String?) = prefs(ctx).edit().putString("deviceId", id).apply()

    fun cursor(ctx: Context): Long = prefs(ctx).getLong("cursor", 0L)
    fun setCursor(ctx: Context, v: Long) = prefs(ctx).edit().putLong("cursor", v).apply()

    fun lastSyncAt(ctx: Context): Long = prefs(ctx).getLong("lastSyncAt", 0L)
    fun setLastSyncAt(ctx: Context, v: Long) = prefs(ctx).edit().putLong("lastSyncAt", v).apply()

    /** 마지막으로 받은 서버 오늘 집계(전체 기기 합산). 위젯과 넛지가 오프라인에서도 쓴다 */
    fun todayJson(ctx: Context): String? = prefs(ctx).getString("today", null)
    fun setTodayJson(ctx: Context, v: String?) = prefs(ctx).edit().putString("today", v).apply()

    fun restUntil(ctx: Context): Long = prefs(ctx).getLong("restUntil", 0L)
    fun setRestUntil(ctx: Context, v: Long) = prefs(ctx).edit().putLong("restUntil", v).apply()

    /** 지금 쉬고 있는 함께 쉬기 id. 혼자 쉬면 null */
    fun restPause(ctx: Context): String? = prefs(ctx).getString("restPause", null)
    fun setRestPause(ctx: Context, v: String?) = prefs(ctx).edit().putString("restPause", v).apply()

    fun clearSession(ctx: Context) {
        putSecret(ctx, "rt", null)
        putSecret(ctx, "at", null)
        prefs(ctx).edit().remove("atExp").remove("deviceId").remove("today").remove("restCancellations").apply()
    }
}
