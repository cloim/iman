package com.cloimism.iman

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RestReminderPolicyTest {
    private val end = 3_600_000L

    @Test fun repeatsEveryMinuteWithoutDailyCap() {
        val policy = RestReminderPolicy()
        assertFalse(policy.shouldNotify(0, end, true, true))
        assertFalse(policy.shouldNotify(59_999, end, true, true))
        for (minute in 1..10) {
            val now = minute * 60_000L
            assertTrue(policy.shouldNotify(now, end, true, true))
            assertFalse(policy.shouldNotify(now + 1, end, true, true))
            assertFalse(policy.shouldNotify(now + 59_999, end, true, true))
        }
    }

    @Test fun stopsWhenIdleAndStartsANewMinuteOnResume() {
        val policy = RestReminderPolicy()
        policy.shouldNotify(0, end, true, true)
        assertFalse(policy.shouldNotify(40_000, end, true, false))
        assertFalse(policy.shouldNotify(100_000, end, true, false))
        assertFalse(policy.shouldNotify(120_000, end, true, true))
        assertFalse(policy.shouldNotify(179_999, end, true, true))
        assertTrue(policy.shouldNotify(180_000, end, true, true))
    }

    @Test fun ignoresExpiredAndCancelledRestsAndResetsForANewRest() {
        val policy = RestReminderPolicy()
        policy.shouldNotify(0, end, true, true)
        assertFalse(policy.shouldNotify(60_000, end, false, true))
        assertFalse(policy.shouldNotify(120_000, 0, false, true))
        assertFalse(policy.shouldNotify(180_000, end + 1, true, true))
        assertTrue(policy.shouldNotify(240_000, end + 1, true, true))
        assertFalse(policy.shouldNotify(300_000, end + 2, true, true))
    }

    @Test fun delayedChecksSendOneReminderWithoutABurst() {
        val policy = RestReminderPolicy()
        policy.shouldNotify(0, end, true, true)
        assertTrue(policy.shouldNotify(180_000, end, true, true))
        assertFalse(policy.shouldNotify(180_001, end, true, true))
        assertTrue(policy.shouldNotify(240_000, end, true, true))
    }
}
