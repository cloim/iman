package com.cloimism.iman

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.widget.RemoteViews
import androidx.core.graphics.PathParser
import androidx.core.graphics.ColorUtils
import kotlin.math.roundToInt
import org.json.JSONObject

/** 공식 브랜드 쉼표(iman-comma.svg, 56x81)와 앱 아이콘의 점. 웹 CommaGauge 와 같은 좌표계(76x82) */
object CommaRenderer {
    private const val COMMA = "m31.69 0.5c35.39 3.4 30.84 64.37-7.44 77.91-4.76 1.68-14.76 4.57-15.86-2.57-1.06-6.91 9.9-8.66 13.25-15.97 1.5-3.29 1.79-8.57-1.84-10.9-30.7-5.8-22.36-51.76 11.89-48.47z"
    private const val DOT = "M70.25 78.89C58.08 86.44 47.83 70.65 56.77 62.79 68.33 52.63 81.53 71.88 70.25 78.89Z"
    // 남은 양 또는 목표 초과분을 물결 수면으로 채운다. 행별 넓이로 수면 높이를 구한다.
    private val fillLevels by lazy {
        val region = android.graphics.Region().apply {
            setPath(PathParser.createPathFromPathData(COMMA), android.graphics.Region(0, 0, 56, 82))
        }
        IntArray(80).also { levels ->
            for (row in 1..79) {
                levels[row] = levels[row - 1] + (0 until 56).count { region.contains(it, 79 - row) }
            }
        }
    }

    fun gauge(sizePx: Int, ratio: Double, active: Boolean, night: Boolean): Bitmap {
        val w = sizePx
        val h = (sizePx * 82f / 76f).toInt()
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(bmp)
        c.scale(w / 76f, h / 82f)
        val comma = PathParser.createPathFromPathData(COMMA)
        c.drawPath(comma, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = if (night) 0xFF2B3A33.toInt() else 0xFFE3EEE4.toInt() })
        val over = ratio > 1
        val amount = (if (over) ratio - 1 else 1 - ratio).coerceIn(0.0, 1.0)
        val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = if (over) ColorUtils.blendARGB(0xFFE98E7A.toInt(), 0xFFC63C2F.toInt(), (ratio - 1).coerceIn(0.0, 1.0).toFloat())
                else 0xFF7EC3A8.toInt()
        }
        c.save()
        c.clipPath(comma)
        if (amount > 0) {
            val area = amount * fillLevels.last()
            val row = fillLevels.indexOfFirst { it >= area }.coerceAtLeast(1)
            val previous = fillLevels[row - 1]
            val fraction = if (fillLevels[row] > previous) (area - previous) / (fillLevels[row] - previous) else 0.0
            val y = if (amount >= 1) -3f else (80 - row - fraction).toFloat()
            val amplitude = if (amount >= 1) 0f else 1.6f
            fun wave(surface: Float) = Path().apply {
                moveTo(-28f, surface)
                for (x in -28 until 70 step 14) {
                    quadTo(x + 3.5f, surface - amplitude, x + 7f, surface)
                    quadTo(x + 10.5f, surface + amplitude, x + 14f, surface)
                }
                lineTo(84f, 90f)
                lineTo(-28f, 90f)
                close()
            }
            fill.alpha = 115
            c.drawPath(wave(y - 0.8f), fill)
            fill.alpha = 255
            c.drawPath(wave(y), fill)
        }
        c.restore()
        if (active) c.drawPath(PathParser.createPathFromPathData(DOT), Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF87C6EC.toInt() })
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

    fun render(ctx: Context, mgr: AppWidgetManager, ids: IntArray, medium: Boolean) {
        val today = Store.todayJson(ctx)?.let { runCatching { JSONObject(it) }.getOrNull() }
        val prefs = Store.prefs(ctx)
        val color = Color.parseColor(prefs.getString("widget.backgroundColor", "#FFFDF7"))
        val transparency = prefs.getInt("widget.transparency", 0).coerceIn(0, 100)
        val dark = ColorUtils.calculateLuminance(color) < 0.4
        val ink = Color.parseColor(if (dark) "#F4EEDF" else "#3C3E41")
        val muted = Color.parseColor(if (dark) "#D0CABF" else "#65645F")
        val density = ctx.resources.displayMetrics.density
        // 배경만 투명하게 그려 글자와 게이지의 선명도를 유지한다.
        val background = Bitmap.createBitmap((320 * density).toInt(), (200 * density).toInt(), Bitmap.Config.ARGB_8888)
        Canvas(background).drawRoundRect(RectF(0f, 0f, background.width.toFloat(), background.height.toFloat()),
            24 * density, 24 * density, Paint(Paint.ANTI_ALIAS_FLAG).apply {
                this.color = ColorUtils.setAlphaComponent(color, (255 * (100 - transparency) / 100f).roundToInt())
            })
        for (id in ids) {
            val v = RemoteViews(ctx.packageName, if (medium) R.layout.widget_medium else R.layout.widget_small)
            v.setImageViewBitmap(R.id.widget_background, background)
            v.setTextColor(R.id.widget_value, ink)
            v.setTextColor(R.id.widget_label, muted)
            v.setTextColor(R.id.widget_sub, muted)
            if (medium) v.setTextColor(R.id.widget_detail, muted)
            v.setOnClickPendingIntent(R.id.widget_root, Notifications.openApp(ctx))
            if (today == null || !Api.signedIn(ctx)) {
                v.setTextViewText(R.id.widget_value, "로그인")
                v.setTextViewText(R.id.widget_sub, "앱을 열어 시작해요")
                v.setImageViewBitmap(R.id.widget_gauge, CommaRenderer.gauge((56 * density).toInt(), 0.0, false, dark))
                mgr.updateAppWidget(id, v)
                continue
            }
            val actual = today.optLong("actualMs")
            val goals = today.optJSONArray("goals")
            val baselineMin = today.optLong("baselineMin", 240L)
            var target = baselineMin * 60_000
            var status = "met"
            var hasGoal = false
            for (i in 0 until (goals?.length() ?: 0)) {
                val g = goals!!.getJSONObject(i)
                if (g.getString("type") == "daily_actual" && g.optBoolean("active") && g.optBoolean("activeToday")) {
                    target = g.getLong("target") * 60_000
                    status = g.getJSONObject("evaluation").getString("status")
                    hasGoal = true
                }
            }
            val resting = System.currentTimeMillis() < Store.restUntil(ctx)
            val active = today.optBoolean("activeNow") && !resting
            v.setImageViewBitmap(
                R.id.widget_gauge,
                CommaRenderer.gauge(((if (medium) 88 else 56) * density).toInt(), actual.toDouble() / target, active, dark),
            )
            v.setTextViewText(R.id.widget_value, Nudge.formatDuration(actual).let { if (actual < 60_000) "0분" else it })
            v.setTextViewText(
                R.id.widget_sub,
                when {
                    resting -> "쉬는 중"
                    !hasGoal -> "하루 목표를 정해 보세요"
                    status == "over" -> "목표를 넘었어요"
                    actual >= target -> "목표 안에서 잘 쓰고 있어요"
                    !medium -> "${Nudge.formatDuration(target - actual)} 남음"
                    else -> "${if (status == "near") "목표에 가까워졌어요" else "목표 안에서 잘 쓰고 있어요"} | ${Nudge.formatDuration(target - actual)} 남음"
                },
            )
            if (medium) v.setTextViewText(R.id.widget_detail,
                "동시 실행 ${Nudge.formatDuration(today.optLong("overlapMs"))} 제외\n화면 켬 ${today.optInt("pickups")}번${if (active) " | 지금 사용 중" else ""}")
            mgr.updateAppWidget(id, v)
        }
    }

}

open class SmallWidget : AppWidgetProvider() {
    override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
        Widgets.render(ctx, mgr, ids, this is MediumWidget)
        Sync.now(ctx)
    }
}

class MediumWidget : SmallWidget()
