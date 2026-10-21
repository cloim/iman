package com.cloimism.iman

import android.content.Context
import android.os.Build
import android.provider.Settings
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.FirebaseApp
import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object Device {
    fun name(ctx: Context): String =
        Settings.Global.getString(ctx.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() } ?: Build.MODEL

    /** 기기 등록(재설치 전까지 같은 installId). FCM 토큰도 함께 올린다 */
    fun register(ctx: Context): String {
        val res = Api.request(
            ctx,
            "POST",
            "/api/devices",
            JSONObject()
                .put("installId", Store.installId(ctx))
                .put("model", name(ctx))
                .put("osVersion", Build.VERSION.RELEASE)
                .put("appVersion", BuildConfig.VERSION_NAME),
        )
        val id = res.getString("id")
        Store.setDeviceId(ctx, id)
        registerPush(ctx)
        return id
    }

    fun registerPush(ctx: Context) {
        if (FirebaseApp.getApps(ctx).isEmpty()) return
        FirebaseMessaging.getInstance().token.addOnSuccessListener { token -> uploadPushToken(ctx, token) }
    }

    fun uploadPushToken(ctx: Context, token: String) {
        val id = Store.deviceId(ctx) ?: return
        Thread {
            runCatching { Api.request(ctx, "PUT", "/api/devices/$id/push", JSONObject().put("token", token)) }
        }.start()
    }
}

object Sync {
    private val mutex = Mutex()
    private const val BATCH = 500
    const val PERIODIC = "iman-sync"
    const val NOW = "iman-sync-now"

    /** 수집, 업로드, 오늘 집계 갱신, 위젯과 넛지 반영 */
    suspend fun run(ctx: Context): Int = mutex.withLock {
        withContext(Dispatchers.IO) {
            if (!Api.signedIn(ctx)) return@withContext 0
            Rest.flushCancellations(ctx)
            UsageCollector.collect(ctx)
            val deviceId = Store.deviceId(ctx) ?: Device.register(ctx)
            val db = UsageDb.get(ctx)
            var accepted = 0
            while (true) {
                val batch = db.unsynced(BATCH)
                if (batch.isEmpty()) break
                val sessions = JSONArray()
                val apps = JSONArray()
                for (pkg in batch.map { it.pkg }.toSet()) {
                    val (label, category) = UsageCollector.appInfo(ctx, pkg)
                    apps.put(JSONObject().put("packageName", pkg).put("label", label).put("category", category))
                }
                for (s in batch) {
                    sessions.put(
                        JSONObject().put("packageName", s.pkg).put("startedAt", s.start).put("endedAt", s.end ?: JSONObject.NULL),
                    )
                }
                val body = JSONObject()
                    .put("deviceId", deviceId)
                    .put("sentAt", System.currentTimeMillis())
                    .put("apps", apps)
                    .put("sessions", sessions)
                val res = try {
                    Api.request(ctx, "POST", "/api/sessions/ingest", body, gzip = true)
                } catch (e: ApiException) {
                    if (e.code == "device_not_found") {
                        Store.setDeviceId(ctx, null)
                        Device.register(ctx)
                    }
                    throw e
                }
                accepted += res.optInt("accepted")
                db.markSynced(batch)
                if (batch.size < BATCH) break
            }
            Store.setLastSyncAt(ctx, System.currentTimeMillis())
            val today = Api.request(ctx, "GET", "/api/me/today")
            Store.setTodayJson(ctx, today.toString())
            Widgets.updateAll(ctx)
            Nudge.evaluate(ctx, today)
            accepted
        }
    }

    fun schedule(ctx: Context) {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, req)
    }

    fun now(ctx: Context, delayMs: Long = 0) {
        val req = OneTimeWorkRequestBuilder<SyncWorker>()
            .apply {
                if (delayMs > 0) setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                else setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            }
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(ctx).enqueueUniqueWork(NOW, ExistingWorkPolicy.REPLACE, req)
    }
}

class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result = try {
        Sync.run(applicationContext)
        Result.success()
    } catch (e: ApiException) {
        if (e.status == 401) Result.success() else Result.retry()
    } catch (e: Exception) {
        Result.retry()
    }
}
