package com.cloimism.iman

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Process

/**
 * 안드로이드 사용 이벤트에서 앱별 포그라운드 구간을 복원한다.
 * - RESUMED 로 시작, STOPPED(화면에서 사라짐)로 종료. PIP 처럼 일시정지 상태로 보이는 동안도 사용으로 센다
 * - 다른 앱으로 넘어갈 때 PAUSED 직후 STOPPED 가 오면 PAUSED 시각에서 끝내 전환 순간의 겹침을 없앤다
 * - 같은 앱이 2초 안에 다시 열리면 한 세션으로 잇는다
 * - 화면 꺼짐, 잠금, 종료, 부팅 이벤트에서 열린 구간을 모두 닫는다
 */
object UsageCollector {
    private const val MERGE_GAP_MS = 2_000L
    private const val SWITCH_GRACE_MS = 1_500L
    private const val FIRST_BACKFILL_MS = 3 * 86_400_000L

    @Suppress("DEPRECATION")
    fun hasPermission(ctx: Context): Boolean {
        val ops = ctx.getSystemService(AppOpsManager::class.java)
        return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) ==
            AppOpsManager.MODE_ALLOWED
    }

    private fun excluded(ctx: Context): Set<String> {
        val home = ctx.packageManager
            .resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY)
            ?.activityInfo?.packageName
        return setOfNotNull(ctx.packageName, home, "com.android.systemui", "android")
    }

    @Synchronized
    fun collect(ctx: Context): Int {
        if (!hasPermission(ctx)) return 0
        val usm = ctx.getSystemService(UsageStatsManager::class.java)
        val db = UsageDb.get(ctx)
        val now = System.currentTimeMillis()
        val cursor = Store.cursor(ctx).takeIf { it > 0 } ?: (now - FIRST_BACKFILL_MS)
        val skip = excluded(ctx)

        // 이전 실행에서 열려 있던 세션은 활동 이름을 모르므로 "?" 로 이어 받는다
        val visible = HashMap<String, MutableSet<String>>()
        val startOf = HashMap<String, Long>()
        val pausedAt = HashMap<String, Long>()
        for (s in db.open()) {
            visible[s.pkg] = mutableSetOf("?")
            startOf[s.pkg] = s.start
        }

        var last = cursor
        var changed = 0
        fun close(pkg: String, at: Long) {
            val start = startOf.remove(pkg) ?: return
            visible.remove(pkg)
            val p = pausedAt.remove(pkg)
            val end = if (p != null && at - p <= SWITCH_GRACE_MS) p else at
            db.upsert(LocalSession(pkg, start, maxOf(start, end)))
            changed++
        }

        val events = usm.queryEvents(cursor - 1, now)
        val e = UsageEvents.Event()
        val w = db.writableDatabase
        w.beginTransaction()
        try {
            while (events.hasNextEvent()) {
                events.getNextEvent(e)
                val t = e.timeStamp
                if (t > last) last = t
                val pkg = e.packageName ?: continue
                when (e.eventType) {
                    UsageEvents.Event.ACTIVITY_RESUMED -> {
                        if (pkg in skip) continue
                        pausedAt.remove(pkg)
                        val set = visible.getOrPut(pkg) { mutableSetOf() }
                        if (set.isEmpty() && startOf[pkg] == null) {
                            val prev = db.lastClosed(pkg)
                            val start = if (prev?.end != null && t - prev.end <= MERGE_GAP_MS) prev.start else t
                            startOf[pkg] = start
                            db.upsert(LocalSession(pkg, start, null))
                            changed++
                        }
                        set.add(e.className ?: "?")
                    }
                    UsageEvents.Event.ACTIVITY_PAUSED -> if (visible.containsKey(pkg)) pausedAt[pkg] = t
                    UsageEvents.Event.ACTIVITY_STOPPED -> {
                        val set = visible[pkg] ?: continue
                        set.remove(e.className)
                        set.remove("?")
                        if (set.isEmpty()) close(pkg, t)
                    }
                    UsageEvents.Event.SCREEN_NON_INTERACTIVE,
                    UsageEvents.Event.KEYGUARD_SHOWN,
                    UsageEvents.Event.DEVICE_SHUTDOWN,
                    UsageEvents.Event.DEVICE_STARTUP -> for (p in startOf.keys.toList()) close(p, t)
                }
            }
            w.setTransactionSuccessful()
        } finally {
            w.endTransaction()
        }
        Store.setCursor(ctx, last)
        db.prune(now - 30 * 86_400_000L)
        return changed
    }

    /** 앱 이름과 카테고리(서버 apps 카탈로그용) */
    fun appInfo(ctx: Context, pkg: String): Pair<String, String> {
        val pm = ctx.packageManager
        return try {
            val ai = pm.getApplicationInfo(pkg, 0)
            val category = when (ai.category) {
                ApplicationInfo.CATEGORY_GAME -> "game"
                ApplicationInfo.CATEGORY_AUDIO -> "audio"
                ApplicationInfo.CATEGORY_VIDEO -> "video"
                ApplicationInfo.CATEGORY_IMAGE -> "image"
                ApplicationInfo.CATEGORY_SOCIAL -> "social"
                ApplicationInfo.CATEGORY_NEWS -> "news"
                ApplicationInfo.CATEGORY_MAPS -> "maps"
                ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
                ApplicationInfo.CATEGORY_ACCESSIBILITY -> "accessibility"
                else -> "other"
            }
            pm.getApplicationLabel(ai).toString() to category
        } catch (e: PackageManager.NameNotFoundException) {
            pkg.substringAfterLast('.') to "other"
        }
    }
}
