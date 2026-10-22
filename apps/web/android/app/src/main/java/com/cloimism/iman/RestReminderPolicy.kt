package com.cloimism.iman

/** 한 번의 쉬기 안에서 앱 사용이 이어질 때만 매 1분 알린다. 시간은 단조 증가 시계를 쓴다. */
class RestReminderPolicy {
    private var restEnd = 0L
    private var nextAt: Long? = null

    fun shouldNotify(now: Long, endsAt: Long, resting: Boolean, usingApp: Boolean): Boolean {
        if (endsAt != restEnd) {
            restEnd = endsAt
            nextAt = null
        }
        if (!resting || !usingApp) {
            nextAt = null
            return false
        }
        val due = nextAt
        if (due == null) {
            nextAt = now + INTERVAL_MS
            return false
        }
        if (now < due) return false
        nextAt = now + INTERVAL_MS
        return true
    }

    companion object {
        const val INTERVAL_MS = 60_000L
    }
}
