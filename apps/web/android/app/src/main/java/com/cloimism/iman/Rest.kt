package com.cloimism.iman

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/** "이만, 쉬기": 쉬는 동안 넛지를 멈추고, 끝나면 쉼표 하나를 기록했다고 알려 준다 */
object Rest {
    const val ONGOING_ID = 2001
    const val DONE_ID = 2002
    private val cancellationLock = Any()
    private val requests = Mutex()

    fun cancelPersonal(ctx: Context) {
        if (Store.restPause(ctx) != null) return
        val endsAt = Store.restUntil(ctx)
        if (endsAt <= System.currentTimeMillis()) return
        synchronized(cancellationLock) {
            val pending = Store.prefs(ctx).getStringSet("restCancellations", emptySet())!!.toMutableSet()
            pending.add("$endsAt:${System.currentTimeMillis()}")
            Store.prefs(ctx).edit().putStringSet("restCancellations", pending).apply()
        }
        end(ctx, null)
        Sync.now(ctx)
    }

    /** 네트워크가 돌아오면 취소한 개인 쉬기 기록을 서버에도 반영한다. */
    suspend fun flushCancellations(ctx: Context) = requests.withLock {
        val pending = synchronized(cancellationLock) {
            Store.prefs(ctx).getStringSet("restCancellations", emptySet())!!.toSet()
        }
        for (entry in pending) {
            val (endsAt, cancelledAt) = entry.split(":").map { it.toLong() }
            Api.request(ctx, "POST", "/api/me/rests/end", JSONObject().put("endsAt", endsAt).put("cancelledAt", cancelledAt))
            synchronized(cancellationLock) {
                val remaining = Store.prefs(ctx).getStringSet("restCancellations", emptySet())!!.toMutableSet()
                remaining.remove(entry)
                Store.prefs(ctx).edit().putStringSet("restCancellations", remaining).apply()
            }
        }
    }

    /** source 가 group 이면 서버가 이미 쉬기 기록을 만들었으므로 로컬 상태만 바꾼다 */
    suspend fun start(ctx: Context, minutes: Int, source: String, pauseId: String? = null) = requests.withLock {
        val start = System.currentTimeMillis()
        val end = start + minutes * 60_000L
        Store.setRestUntil(ctx, end)
        Store.setRestPause(ctx, if (source == "group") pauseId else null)
        Notifications.cancel(ctx, Nudge.NOTIFY_ID)
        val until = SimpleDateFormat("HH:mm", Locale.KOREA).format(Date(end))
        Notifications.show(
            ctx,
            ONGOING_ID,
            Notifications.builder(ctx, Notifications.REST, "쉬는 중이에요. ${until}에 알려 드릴게요.")
                .setOngoing(true)
                .setAutoCancel(false)
                .setUsesChronometer(true)
                .setChronometerCountDown(true)
                .setWhen(end),
        )
        WorkManager.getInstance(ctx).enqueueUniqueWork(
            "iman-rest-done",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<RestDoneWorker>()
                .setInputData(workDataOf("endsAt" to end))
                .setInitialDelay(minutes.toLong(), TimeUnit.MINUTES).build(),
        )
        Widgets.updateAll(ctx)
        if (source != "group") {
            runCatching {
                Api.request(
                    ctx,
                    "POST",
                    "/api/me/rests",
                    JSONObject().put("startsAt", start).put("endsAt", end).put("source", source)
                        .apply { pauseId?.let { put("pauseId", it) } },
                )
            }
        }
    }

    /**
     * 함께 쉬기를 일찍 마쳤을 때 남은 쉬기를 끝낸다.
     * pauseId 를 주면 그 함께 쉬기로 쉬던 중일 때만 끝내서, 혼자 시작한 쉬기는 건드리지 않는다
     */
    fun end(ctx: Context, pauseId: String?) {
        if (pauseId != null && Store.restPause(ctx) != pauseId) return
        if (System.currentTimeMillis() >= Store.restUntil(ctx)) return
        Store.setRestUntil(ctx, 0L)
        Store.setRestPause(ctx, null)
        WorkManager.getInstance(ctx).cancelUniqueWork("iman-rest-done")
        Notifications.cancel(ctx, ONGOING_ID)
        if (pauseId != null) Notifications.show(ctx, DONE_ID, Notifications.builder(ctx, Notifications.REST, "함께 쉬기를 마쳤어요. 오늘의 쉼표 하나를 찍었어요."))
        Widgets.updateAll(ctx)
    }
}

class RestDoneWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val endsAt = Store.restUntil(ctx)
        val expected = inputData.getLong("endsAt", endsAt)
        if (endsAt <= 0 || endsAt != expected || System.currentTimeMillis() < endsAt) return Result.success()
        Notifications.cancel(ctx, Rest.ONGOING_ID)
        Store.setRestUntil(ctx, 0L)
        Store.setRestPause(ctx, null)
        Notifications.show(ctx, Rest.DONE_ID, Notifications.builder(ctx, Notifications.REST, "잘 쉬었어요. 오늘의 쉼표 하나를 찍었어요."))
        Widgets.updateAll(ctx)
        return Result.success()
    }
}

/** 알림, 위젯 버튼 동작 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    REST -> Rest.start(ctx, intent.getIntExtra("minutes", 10), intent.getStringExtra("source") ?: "nudge")
                    SNOOZE -> {
                        Notifications.cancel(ctx, Nudge.NOTIFY_ID)
                        Nudge.snooze(ctx, intent.getStringExtra("text") ?: "")
                    }
                    JOIN_PAUSE -> {
                        val id = intent.getStringExtra("pauseId") ?: return@launch
                        val endsAt = intent.getLongExtra("endsAt", 0L)
                        Notifications.cancel(ctx, Messaging.PAUSE_ID)
                        runCatching { Api.request(ctx, "POST", "/api/group/pauses/$id/join") }
                        val minutes = ((endsAt - System.currentTimeMillis()) / 60_000).toInt().coerceAtLeast(1)
                        Rest.start(ctx, minutes, "group", id)
                    }
                    REFRESH -> Sync.now(ctx)
                }
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val REST = "com.cloimism.iman.REST"
        const val SNOOZE = "com.cloimism.iman.SNOOZE"
        const val JOIN_PAUSE = "com.cloimism.iman.JOIN_PAUSE"
        const val REFRESH = "com.cloimism.iman.REFRESH"
    }
}
