package com.cloimism.iman

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.view.View
import android.widget.RemoteViews
import androidx.core.graphics.PathParser
import org.json.JSONObject

/** 공식 브랜드 쉼표(iman-comma.svg, 56x81)와 앱 아이콘의 점. 웹 CommaGauge 와 같은 좌표계(76x82) */
object CommaRenderer {
    private const val COMMA = "m31.69 0.5c35.39 3.4 30.84 64.37-7.44 77.91-4.76 1.68-14.76 4.57-15.86-2.57-1.06-6.91 9.9-8.66 13.25-15.97 1.5-3.29 1.79-8.57-1.84-10.9-30.7-5.8-22.36-51.76 11.89-48.47z"
    private const val DOT = "M70.25 78.89C58.08 86.44 47.83 70.65 56.77 62.79 68.33 52.63 81.53 71.88 70.25 78.89Z"
    private const val HEAD_TOP = 0.5f
    private const val HEAD_BOTTOM = 50f
    private const val TAIL_BOTTOM = 79f

    fun gauge(sizePx: Int, ratio: Double, status: String, active: Boolean, night: Boolean): Bitmap {
        val w = sizePx
        val h = (sizePx * 82f / 76f).toInt()
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(w / 76f, h / 82f)
        val comma = PathParser.createPathFromPathData(COMMA)
        c.drawPath(comma, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (night) 0xFF2B3A33.toInt() else 0xFFE3EEE4.toInt() })
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = when (status) {
                "over" -> 0xFFE98E7A.toInt()
                "near" -> 0xFFE6B85C.toInt()
                else -> 0xFF7EC3A8.toInt()
            }
        }
        c.save()
        c.clipPath(comma)
        val head = ratio.coerceIn(0.0, 1.0).toFloat()
        c.drawRect(RectF(0f, HEAD_BOTTOM - head * (HEAD_BOTTOM - HEAD_TOP), 60f, HEAD_BOTTOM), fill)
        val over = (ratio - 1).coerceIn(0.0, 1.0).toFloat()
        if (over > 0) {
            c.drawRect(RectF(0f, HEAD_BOTTOM - 0.5f, 60f, HEAD_BOTTOM + over * (TAIL_BOTTOM - HEAD_BOTTOM)), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFE98E7A.toInt() })
        }
        c.restore()
        if (active) c.drawPath(PathParser.createPathFromPathData(DOT), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF87C6EC.toInt() })
        return bmp
    }

    /** 24시간 미니 리본: 실제 사용 구간 띠 + 현재 시각 */
    fun ribbon(widthPx: Int, heightPx: Int, union: List<Intervals.Span>, dayStart: Long, dayEnd: Long, now: Long, night: Boolean): Bitmap {
        val bmp = Bitmap.createBitmap(widthPx, heightPx, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        val span = (dayEnd - dayStart).toFloat()
        val r = heightPx / 2f
        c.drawRoundRect(RectF(0f, 0f, widthPx.toFloat(), heightPx.toFloat()), r, r, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (night) 0xFF36383C.toInt() else 0xFFECE4D2.toInt() })
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF7EC3A7.toInt() }
        for (s in union) {
            val x0 = (s.start - dayStart) / span * widthPx
            val x1 = maxOf(x0 + 2f, (s.end - dayStart) / span * widthPx)
            c.drawRoundRect(RectF(x0, 0f, x1, heightPx.toFloat()), r, r, p)
        }
        if (now in dayStart until dayEnd) {
            val x = (now - dayStart) / span * widthPx
            c.drawRect(RectF(x - 1.5f, 0f, x + 1.5f, heightPx.toFloat()), Paint().apply { color = 0xFF89C7EE.toInt() })
        }
        return bmp
    }
}

object Widgets {
    fun updateAll(ctx: Context) {
        val mgr = AppWidgetManager.getInstance(ctx)
        for (cls in listOf(SmallWidget::class.java, MediumWidget::class.java)) {
            val ids = mgr.getAppWidgetIds(ComponentName(ctx, cls))
            if (ids.isNotEmpty()) render(ctx, mgr, ids, cls == MediumWidget::class.java)
        }
    }

    private fun night(ctx: Context) =
        (ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES

    fun render(ctx: Context, mgr: AppWidgetManager, ids: IntArray, medium: Boolean) {
        val today = Store.todayJson(ctx)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val dark = night(ctx)
        val density = ctx.resources.displayMetrics.density
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, if (medium) R.layout.widget_medium else R.layout.widget_small)
            v.setOnClickPendingIntent(R.id.widget_root, Notifications.openApp(ctx))
            if (today == null || !Api.signedIn(ctx)) {
                v.setTextViewText(R.id.widget_value, "로그인")
                v.setTextViewText(R.id.widget_sub, "앱을 열어 시작해요")
                v.setImageViewBitmap(R.id.widget_gauge, CommaRenderer.gauge((56 * density).toInt(), 0.0, "met", false, dark))
                mgr.updateAppWidget(id, v)
                continue
            }
            val actual = today.optLong("actualMs")
            val goals = today.optJSONArray("goals")
            var target = 240L * 60_000
            var status = "met"
            var hasGoal = false
            for (i in 0 until (goals?.length() ?: 0)) {
                val g = goals!!.getJSONObject(i)
                if (g.getString("type") == "daily_actual" && g.optBoolean("activeToday")) {
                    target = g.getLong("target") * 60_000
                    status = g.getJSONObject("evaluation").getString("status")
                    hasGoal = true
                }
            }
            val resting = System.currentTimeMillis() < Store.restUntil(ctx)
            val active = today.optBoolean("activeNow") && !resting
            v.setImageViewBitmap(
                R.id.widget_gauge,
                CommaRenderer.gauge(((if (medium) 64 else 56) * density).toInt(), actual.toDouble() / target, status, active, dark),
            )
            v.setTextViewText(R.id.widget_value, Nudge.formatDuration(actual).let { if (actual < 60_000) "0분" else it })
            v.setTextViewText(
                R.id.widget_sub,
                when {
                    resting -> "쉬는 중"
                    !hasGoal -> "실제 사용"
                    actual >= target -> "목표를 넘었어요"
                    else -> "${Nudge.formatDuration(target - actual)} 남음"
                },
            )
            if (medium) renderMedium(ctx, v, today, density, dark)
            mgr.updateAppWidget(id, v)
        }
    }

    private fun renderMedium(ctx: Context, v: RemoteViews, today: JSONObject, density: Float, dark: Boolean) {
        val dayStart = today.getLong("dayStart")
        val dayEnd = today.getLong("dayEnd")
        val now = System.currentTimeMillis()
        val sessions = today.optJSONArray("sessions")
        val spans = ArrayList<Intervals.Span>()
        for (i in 0 until (sessions?.length() ?: 0)) {
            val s = sessions!!.getJSONObject(i)
            val end = if (s.isNull("endedAt")) null else s.getLong("endedAt")
            Intervals.clip(s.getLong("startedAt"), end, dayStart, dayEnd, now)?.let { spans.add(it) }
        }
        v.setImageViewBitmap(
            R.id.widget_ribbon,
            CommaRenderer.ribbon((220 * density).toInt(), (10 * density).toInt(), Intervals.union(spans), dayStart, dayEnd, now, dark),
        )
        val apps = today.optJSONObject("apps") ?: JSONObject()
        val byApp = today.optJSONObject("byApp") ?: JSONObject()
        val top = byApp.keys().asSequence()
            .map { it to byApp.getJSONObject(it).getLong("actualMs") }
            .sortedByDescending { it.second }
            .take(3)
            .toList()
        val rows = listOf(R.id.widget_app1, R.id.widget_app2, R.id.widget_app3)
        rows.forEachIndexed { i, rid ->
            val item = top.getOrNull(i)
            if (item == null) {
                v.setViewVisibility(rid, View.GONE)
            } else {
                v.setViewVisibility(rid, View.VISIBLE)
                val label = apps.optJSONObject(item.first)?.optString("label") ?: item.first
                v.setTextViewText(rid, "$label  ${Nudge.formatDuration(item.second)}")
            }
        }
        v.setTextViewText(R.id.widget_overlap, "동시 실행 ${Nudge.formatDuration(today.optLong("overlapMs"))} 포함 총 ${Nudge.formatDuration(today.optLong("totalMs"))}")
        v.setOnClickPendingIntent(
            R.id.widget_rest,
            Notifications.broadcast(ctx, ActionReceiver.REST, 31) { putExtra("minutes", 30); putExtra("source", "widget") },
        )
        v.setTextColor(R.id.widget_rest, Color.parseColor("#18352A"))
    }
}

open class SmallWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Widgets.render(ctx, mgr, ids, this is MediumWidget)
        Sync.now(ctx)
    }
}

class MediumWidget : SmallWidget()
