package com.cloimism.iman

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.time.OffsetDateTime

/** fixtures/intervals/cases.json 공용 골든 케이스로 TS, SQL 과 같은 결과인지 확인 */
class IntervalsGoldenTest {
    private fun ms(s: String) = OffsetDateTime.parse(s).toInstant().toEpochMilli()

    @Test
    fun matchesGoldenFixtures() {
        val file = generateSequence(File("").absoluteFile) { it.parentFile }
            .map { File(it, "fixtures/intervals/cases.json") }
            .first { it.exists() }
        val cases = JSONObject(file.readText()).getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val w = c.getJSONArray("window")
            val from = ms(w.getString(0))
            val to = ms(w.getString(1))
            val now = ms(c.getString("now"))
            val sessions = c.getJSONArray("sessions")
            val spans = (0 until sessions.length()).mapNotNull { j ->
                val s = sessions.getJSONArray(j)
                Intervals.clip(ms(s.getString(2)), if (s.isNull(3)) null else ms(s.getString(3)), from, to, now)
            }
            val t = Intervals.totals(spans)
            val e = c.getJSONObject("expect")
            val name = c.getString("name")
            assertEquals(name, e.getLong("totalMin") * 60_000, t.totalMs)
            assertEquals(name, e.getLong("actualMin") * 60_000, t.actualMs)
            assertEquals(name, e.getInt("pickups"), t.pickups)
        }
    }
}
