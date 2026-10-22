package com.cloimism.iman

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/** 실제 시스템 알림으로 1분 반복과 앱 사용 중단/쉬기 취소를 검증한다. */
@RunWith(AndroidJUnit4::class)
class RestReminderServiceTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val ctx: Context = instrumentation.targetContext
    private val nm = ctx.getSystemService(NotificationManager::class.java)

    private fun launchOwnApp() {
        ctx.startActivity(Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        Thread.sleep(2_000)
    }

    private fun reminder() = nm.activeNotifications.firstOrNull { it.id == RestReminderService.REMINDER_ID }

    private fun waitUntil(timeoutMs: Long, check: () -> Boolean) {
        val deadline = android.os.SystemClock.elapsedRealtime() + timeoutMs
        while (!check() && android.os.SystemClock.elapsedRealtime() < deadline) Thread.sleep(250)
        assertTrue("condition timed out after ${timeoutMs}ms", check())
    }

    @Test fun repeatsForTrackedAppsAndStopsForExceptionsAndCancellation() {
        val oldToday = Store.todayJson(ctx)
        val oldEnd = Store.restUntil(ctx)
        val oldPause = Store.restPause(ctx)
        try {
            Store.setTodayJson(ctx, "{\"excludedPackages\":[]}")
            launchOwnApp()
            runBlocking { Rest.start(ctx, 5, "group", "rest-test") }
            ctx.startActivity(Intent(android.provider.Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            Thread.sleep(55_000)
            assertNull("first reminder must wait a full minute", reminder())
            waitUntil(15_000) { reminder() != null }
            val first = reminder()!!.postTime
            waitUntil(70_000) { (reminder()?.postTime ?: 0) > first }
            assertTrue(reminder()!!.postTime - first >= 60_000)

            Store.setTodayJson(ctx, "{\"excludedPackages\":[\"com.android.settings\"]}")
            waitUntil(5_000) { reminder() == null }
            assertTrue(Store.restUntil(ctx) > System.currentTimeMillis())
            Rest.end(ctx, "rest-test")
            assertEquals(0L, Store.restUntil(ctx))
            assertNull(reminder())
            waitUntil(5_000) { nm.activeNotifications.none { it.id == Rest.ONGOING_ID } }
        } finally {
            Rest.end(ctx, null)
            Store.setRestUntil(ctx, oldEnd)
            Store.setRestPause(ctx, oldPause)
            if (oldToday != null) Store.setTodayJson(ctx, oldToday)
            else Store.prefs(ctx).edit().remove("today").apply()
        }
    }
}
