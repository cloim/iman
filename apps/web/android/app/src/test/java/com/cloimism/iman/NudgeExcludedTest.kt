package com.cloimism.iman

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** 연속 사용 판정에서 관리자가 정한 예외 앱을 빼는지 확인 */
class NudgeExcludedTest {
    private val min = 60_000L
    private val now = 1_000 * min
    private val from = now - 360 * min

    @Test
    fun excludedOnlyUsageIsIgnored() {
        val sessions = listOf(LocalSession("com.example.music", now - 90 * min, null))
        assertNull(Nudge.lastBlock(sessions, setOf("com.example.music"), from, now))
        assertEquals(Intervals.Span(now - 90 * min, now), Nudge.lastBlock(sessions, emptySet(), from, now))
    }

    @Test
    fun overlapWithOtherAppsKeepsOnlyCountedUsage() {
        val sessions = listOf(
            LocalSession("com.example.music", now - 90 * min, null),
            LocalSession("com.example.chat", now - 40 * min, now - 20 * min),
            LocalSession("com.example.video", now - 25 * min, null),
        )
        assertEquals(
            Intervals.Span(now - 40 * min, now),
            Nudge.lastBlock(sessions, setOf("com.example.music"), from, now),
        )
    }
}
