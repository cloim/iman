package com.cloimism.iman

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPOutputStream

class ApiException(val status: Int, val code: String) : IOException("$status $code")

/** 이만 API 호출. 액세스 토큰 만료 시 리프레시 토큰으로 한 번 갱신 후 재시도한다 */
object Api {
    private val lock = Any()

    fun request(
        ctx: Context,
        method: String,
        path: String,
        body: JSONObject? = null,
        auth: Boolean = true,
        gzip: Boolean = false,
    ): JSONObject {
        val first = send(ctx, method, path, body, if (auth) accessToken(ctx) else null, gzip)
        if (first.first == 401 && auth) {
            val renewed = accessToken(ctx, force = true) ?: throw ApiException(401, "signed_out")
            return parse(send(ctx, method, path, body, renewed, gzip))
        }
        return parse(first)
    }

    private fun parse(res: Pair<Int, String>): JSONObject {
        val (status, text) = res
        val json = if (text.isBlank()) JSONObject() else try {
            JSONObject(text)
        } catch (e: Exception) {
            JSONObject()
        }
        if (status !in 200..299) throw ApiException(status, json.optString("error", "http_$status"))
        return json
    }

    private fun send(ctx: Context, method: String, path: String, body: JSONObject?, token: String?, gzip: Boolean): Pair<Int, String> {
        val conn = (URL(BuildConfig.API_BASE + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15_000
            readTimeout = 30_000
            setRequestProperty("accept", "application/json")
            token?.let { setRequestProperty("authorization", "Bearer $it") }
        }
        try {
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("content-type", "application/json")
                val bytes = body.toString().toByteArray(Charsets.UTF_8)
                if (gzip) {
                    conn.setRequestProperty("content-encoding", "gzip")
                    GZIPOutputStream(conn.outputStream).use { it.write(bytes) }
                } else {
                    conn.outputStream.use { it.write(bytes) }
                }
            }
            val status = conn.responseCode
            val stream = if (status in 200..299) conn.inputStream else conn.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return status to text
        } finally {
            conn.disconnect()
        }
    }

    fun signedIn(ctx: Context) = Store.getSecret(ctx, "rt") != null

    fun saveTokens(ctx: Context, json: JSONObject) {
        Store.putSecret(ctx, "rt", json.getString("refreshToken"))
        Store.putSecret(ctx, "at", json.getString("accessToken"))
        Store.prefs(ctx).edit().putLong("atExp", json.getLong("accessExpiresAt")).apply()
    }

    /** 유효한 액세스 토큰. 만료 1분 전이면 갱신. 리프레시가 거부되면 로그아웃 상태로 정리 */
    fun accessToken(ctx: Context, force: Boolean = false): String? = synchronized(lock) {
        val exp = Store.prefs(ctx).getLong("atExp", 0L)
        val current = Store.getSecret(ctx, "at")
        if (!force && current != null && exp - 60_000 > System.currentTimeMillis()) return current
        val refresh = Store.getSecret(ctx, "rt") ?: return null
        val res = send(ctx, "POST", "/api/auth/refresh", JSONObject().put("refreshToken", refresh), null, false)
        if (res.first == 401) {
            Store.clearSession(ctx)
            return null
        }
        val json = parse(res)
        saveTokens(ctx, json)
        json.getString("accessToken")
    }
}
