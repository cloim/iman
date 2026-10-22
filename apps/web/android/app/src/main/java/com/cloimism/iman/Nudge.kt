package com.cloimism.iman

import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * 넛지: 앱을 막지 않고 알맞은 때에 부드럽게 알린다. 판정은 기기 안에서 하므로 오프라인에서도 동작.
 * - 목표 80%(근접), 100%(도달), 앱과 카테고리 한도, 60분 연속 사용
 * - 같은 종류는 하루 한 번, 하루 최대 4번
 * - 계속 사용 중이면 목표에 닿는 예상 시각에 한 번 더 확인하도록 예약
 */
object Nudge {
    const val NOTIFY_ID = 1001
    private const val DAILY_CAP = 4
    private const val CONTINUOUS_MS = 60 * 60_000L
    private const val PREDICT = "iman-nudge-predict"

    private val CATEGORY = mapOf(
        "video" to "영상", "social" to "SNS, 메신저", "game" to "게임", "audio" to "음악, 오디오",
        "image" to "사진", "news" to "뉴스, 읽을거리", "maps" to "지도, 이동", "productivity" to "생산성",
    )

    fun minutes(ms: Long) = formatDuration(ms)

    fun formatDuration(ms: Long): String {
        val total = (ms / 60_000).toInt()
        if (total <= 0) return "1분"
        val h = total / 60
        val m = total % 60
        return when {
            h == 0 -> "${m}분"
            m == 0 -> "${h}시간"
            else -> "${h}시간 ${m}분"
        }
    }

    private fun state(ctx: Context, date: String): JSONObject {
        val raw = Store.prefs(ctx).getString("nudge.$date", null)
        return raw?.let { JSONObject(it) } ?: JSONObject().put("count", 0).put("sent", JSONObject())
    }

    private fun save(ctx: Context, date: String, st: JSONObject) =
        Store.prefs(ctx).edit().putString("nudge.$date", st.toString()).apply()

    fun evaluate(ctx: Context, today: JSONObject) {
        val date = today.optString("date")
        if (date.isEmpty() || System.currentTimeMillis() < Store.restUntil(ctx)) return
        val st = state(ctx, date)
        val sent = st.getJSONObject("sent")
        val apps = today.optJSONObject("apps") ?: JSONObject()
        val goals = today.optJSONArray("goals") ?: return
        val active = today.optBoolean("activeNow")
        // 관리자가 정한 예외 앱은 서버 집계에서 빠져 있고, 기기에서 따로 보는 판정에서도 뺀다
        val excluded = today.optJSONArray("excludedPackages")
            ?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
        var predictAt = Long.MAX_VALUE

        fun send(key: String, text: String) {
            if (sent.has(key) || st.getInt("count") >= DAILY_CAP) return
            sent.put(key, System.currentTimeMillis())
            st.put("count", st.getInt("count") + 1)
            post(ctx, text)
        }

        for (i in 0 until goals.length()) {
            val g = goals.getJSONObject(i)
            val nudge = g.optJSONObject("nudge") ?: continue
            if (!g.optBoolean("activeToday") || !nudge.optBoolean("enabled", true)) continue
            val warm = nudge.optString("tone", "warm") == "warm"
            val ev = g.getJSONObject("evaluation")
            val status = ev.getString("status")
            val value = ev.getDouble("value").toLong()
            val limit = ev.getDouble("limit").toLong()
            val id = g.getString("id")
            val ref = g.optString("scopeRef")
            // 한도 0분인 예외 앱 목표가 0 >= 0 으로 알림을 내지 않도록 건너뛴다
            if (g.getString("type") == "app_limit" && ref in excluded) continue
            when (g.getString("type")) {
                "daily_actual" -> {
                    if (status == "over" || value >= limit) {
                        send("$id:over", if (warm) "오늘은 이만, 쉬어 갈까요? 목표 ${formatDuration(limit)}을 채웠어요." else "오늘 목표 ${formatDuration(limit)}을 채웠어요.")
                    } else if (status == "near" && nudge.optBoolean("near", true)) {
                        send("$id:near", if (warm) "오늘 목표까지 ${formatDuration(limit - value)} 남았어요. 천천히 마무리해 볼까요?" else "목표까지 ${formatDuration(limit - value)} 남았어요.")
                    }
                    if (active && value < limit) {
                        val toNear = (limit * 0.8).toLong() - value
                        val next = if (toNear > 0 && nudge.optBoolean("near", true)) toNear else limit - value
                        predictAt = minOf(predictAt, next)
                    }
                }
                "app_limit", "category_limit" -> {
                    val name = if (g.getString("type") == "app_limit") apps.optJSONObject(ref)?.optString("label") ?: ref else CATEGORY[ref] ?: ref
                    if (status == "over" || value >= limit) {
                        send("$id:over", if (warm) "${name}은(는) 오늘 ${formatDuration(limit)}을 채웠어요. 잠깐 쉬어 갈까요?" else "${name} 오늘 한도 ${formatDuration(limit)}에 닿았어요.")
                    } else if (status == "near" && nudge.optBoolean("near", true)) {
                        send("$id:near", "${name} 한도까지 ${formatDuration(limit - value)} 남았어요.")
                    }
                }
            }
        }

        // 60분 연속 사용
        val now = System.currentTimeMillis()
        val block = lastBlock(UsageDb.get(ctx).between(now - 6 * 3_600_000L, now), excluded, now - 6 * 3_600_000L, now)
        if (block != null && now - block.end < 60_000 && block.end - block.start >= CONTINUOUS_MS) {
            send("continuous:${block.start}", "한 시간째 쓰고 있어요. 눈 좀 쉬어 볼까요?")
        }

        save(ctx, date, st)
        if (predictAt in 1..(15 * 60_000L)) {
            WorkManager.getInstance(ctx).enqueueUniqueWork(
                PREDICT,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>().setInitialDelay(predictAt + 5_000, TimeUnit.MILLISECONDS).build(),
            )
        }
    }

    /** 예외 앱을 뺀 사용 구간의 마지막 덩어리(연속 사용 판정용) */
    fun lastBlock(sessions: List<LocalSession>, excluded: Set<String>, from: Long, now: Long): Intervals.Span? =
        Intervals.union(sessions.filter { it.pkg !in excluded }.mapNotNull { Intervals.clip(it.start, it.end, from, now, now) }).lastOrNull()

    fun post(ctx: Context, text: String) {
        val n = Notifications.builder(ctx, Notifications.NUDGE, text)
            .addAction(0, "이만, 쉬기", Notifications.broadcast(ctx, ActionReceiver.REST, 11) { putExtra("minutes", 10) })
            .addAction(0, "조금만 더", Notifications.broadcast(ctx, ActionReceiver.SNOOZE, 12) { putExtra("text", text) })
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
        Notifications.show(ctx, NOTIFY_ID, n)
    }

    /** "조금만 더": 15분 뒤 아직 사용 중이면 한 번만 다시 알림 */
    fun snooze(ctx: Context, text: String) {
        WorkManager.getInstance(ctx).enqueueUniqueWork(
            "iman-snooze",
            ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SnoozeWorker>()
                .setInitialDelay(15, TimeUnit.MINUTES)
                .setInputData(workDataOf("text" to text))
                .build(),
        )
    }
}

class SnoozeWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        runCatching { Sync.run(ctx) }
        val active = Store.todayJson(ctx)?.let { JSONObject(it).optBoolean("activeNow") } ?: false
        if (active && System.currentTimeMillis() >= Store.restUntil(ctx)) {
            Nudge.post(ctx, inputData.getString("text") ?: "15분이 지났어요. 이만 쉬어 갈까요?")
        }
        return Result.success()
    }
}
