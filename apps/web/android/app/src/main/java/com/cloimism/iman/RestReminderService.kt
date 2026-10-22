package com.cloimism.iman

import android.app.KeyguardManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/** 사용자가 시작한 쉬기 동안만 로컬 사용 상태를 확인한다. 네트워크와 일반 넛지 상한에 의존하지 않는다. */
class RestReminderService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, Rest.ONGOING_ID, Rest.notification(this).build(), type)
        scope.launch {
            val policy = RestReminderPolicy()
            while (isActive) {
                val end = Store.restUntil(this@RestReminderService)
                if (end <= System.currentTimeMillis()) {
                    Rest.finish(this@RestReminderService, end)
                    break
                }
                val usingApp = runCatching { usingTrackedApp() }.getOrDefault(false)
                if (policy.shouldNotify(SystemClock.elapsedRealtime(), end, System.currentTimeMillis() < end, usingApp)) {
                    // 취소와 재시작이 사용 이벤트 조회와 겹쳐도 이전 쉬기의 알림을 보내지 않는다.
                    synchronized(Rest.stateLock) {
                      if (Store.restUntil(this@RestReminderService) == end && System.currentTimeMillis() < end) {
                        Notifications.show(this@RestReminderService, REMINDER_ID,
                            Notifications.builder(this@RestReminderService, Notifications.NUDGE, "지금은 쉬는 중이에요. 앱을 내려놓고 잠시 쉬어 주세요.")
                                .setOnlyAlertOnce(false))
                      }
                    }
                } else if (!usingApp) {
                    Notifications.cancel(this@RestReminderService, REMINDER_ID)
                }
                delay(1_000)
            }
            stopSelf()
        }
    }

    private fun usingTrackedApp(): Boolean {
        val power = getSystemService(PowerManager::class.java)
        val keyguard = getSystemService(KeyguardManager::class.java)
        if (!power.isInteractive || keyguard.isKeyguardLocked || !UsageCollector.hasPermission(this)) return false
        UsageCollector.collect(this)
        val excluded = Store.todayJson(this)?.let { JSONObject(it).optJSONArray("excludedPackages") }
            ?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
        return UsageDb.get(this).open().any { it.pkg !in excluded }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 쉬기를 새로 시작한 경우에도 같은 서비스를 써서 중복 루프를 만들지 않는다.
        Notifications.show(this, Rest.ONGOING_ID, Rest.notification(this))
        return START_STICKY
    }

    override fun onDestroy() {
        scope.cancel()
        Notifications.cancel(this, REMINDER_ID)
        super.onDestroy()
    }

    companion object {
        const val REMINDER_ID = 2003

        fun start(ctx: Context) {
            ContextCompat.startForegroundService(ctx, Intent(ctx, RestReminderService::class.java))
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, RestReminderService::class.java))
            Notifications.cancel(ctx, REMINDER_ID)
        }
    }
}
