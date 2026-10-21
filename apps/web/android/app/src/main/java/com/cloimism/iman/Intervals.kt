package com.cloimism.iman

/**
 * packages/core 의 구간 계산과 같은 규칙(TS, SQL 과 공용 골든 픽스처로 검증).
 * 총 사용시간 = 구간 길이 합, 실제 사용시간 = 합집합 길이.
 */
object Intervals {
    data class Span(val start: Long, val end: Long)

    fun clip(start: Long, end: Long?, from: Long, to: Long, now: Long): Span? {
        val e = minOf(end ?: now, to, now)
        val s = maxOf(start, from)
        return if (e > s) Span(s, e) else null
    }

    fun union(spans: List<Span>): List<Span> {
        val out = ArrayList<Span>()
        for (s in spans.sortedWith(compareBy({ it.start }, { it.end }))) {
            val last = out.lastOrNull()
            if (last != null && s.start <= last.end) out[out.size - 1] = Span(last.start, maxOf(last.end, s.end))
            else out.add(s)
        }
        return out
    }

    fun length(spans: List<Span>) = spans.sumOf { it.end - it.start }

    data class Totals(val totalMs: Long, val actualMs: Long, val pickups: Int)

    fun totals(spans: List<Span>): Totals {
        val u = union(spans)
        return Totals(length(spans), length(u), u.size)
    }
}
