package com.cloimism.iman

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * GitHub Releases 에서 직접 업데이트. 릴리스에 첨부된 latest.json 으로 버전을 확인하고,
 * 내려받은 APK 의 sha256 과 서명 인증서가 지금 앱과 같을 때만 PackageInstaller 로 설치한다.
 */
object Updater {
    data class Release(val versionCode: Int, val versionName: String, val apkUrl: String, val sha256: String, val minSupported: Int, val notes: String)

    private fun latestUrl() = "https://github.com/${BuildConfig.UPDATE_REPO}/releases/latest/download/latest.json"

    fun latest(): Release {
        val conn = URL(latestUrl()).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 15_000
        conn.readTimeout = 20_000
        try {
            if (conn.responseCode != 200) throw ApiException(conn.responseCode, "update_unavailable")
            val j = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            return Release(
                j.getInt("versionCode"),
                j.getString("versionName"),
                j.getString("apkUrl"),
                j.getString("sha256").lowercase(),
                j.optInt("minSupported", 0),
                j.optString("notes", ""),
            )
        } finally {
            conn.disconnect()
        }
    }

    fun currentCode(ctx: Context): Int = ctx.packageManager.getPackageInfo(ctx.packageName, 0).longVersionCode.toInt()

    fun install(ctx: Context, release: Release, progress: (phase: String, done: Long, total: Long) -> Unit) {
        val file = File(ctx.cacheDir, "update.apk")
        val conn = URL(release.apkUrl).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            val total = conn.contentLengthLong
            var done = 0L
            var lastReport = 0L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        digest.update(buf, 0, n)
                        done += n
                        if (done - lastReport > 256 * 1024) {
                            lastReport = done
                            progress("download", done, total)
                        }
                    }
                }
            }
            progress("download", done, total)
        } finally {
            conn.disconnect()
        }

        progress("verify", 0, 0)
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        if (hash != release.sha256) throw ApiException(400, "update_hash_mismatch")
        val pm = ctx.packageManager
        val archive = pm.getPackageArchiveInfo(file.path, PackageManager.GET_SIGNING_CERTIFICATES)
            ?: throw ApiException(400, "update_invalid_apk")
        val mine = pm.getPackageInfo(ctx.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val theirs = archive.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
        val ours = mine.signingInfo?.apkContentsSigners?.map { it.toCharsString() }?.toSet()
        if (archive.packageName != ctx.packageName || theirs == null || theirs != ours) throw ApiException(400, "update_signature_mismatch")

        progress("install", 0, 0)
        val installer = pm.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
        }
        val sessionId = installer.createSession(params)
        installer.openSession(sessionId).use { session ->
            file.inputStream().use { input ->
                session.openWrite("base.apk", 0, file.length()).use { out ->
                    input.copyTo(out)
                    session.fsync(out)
                }
            }
            val intent = Intent(ctx, InstallReceiver::class.java)
            val pi = PendingIntent.getBroadcast(ctx, sessionId, intent, PendingIntent.FLAG_MUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            session.commit(pi.intentSender)
        }
    }
}

/** 설치 확인 화면을 띄운다 */
class InstallReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT) ?: return
            ctx.startActivity(confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }
}
