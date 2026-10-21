package com.cloimism.iman

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Notifications {
    const val NUDGE = "nudge"
    const val REST = "rest"
    const val GROUP = "group"
    const val REPORT = "report"

    fun createChannels(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(NUDGE, "넛지 알림", NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = "목표에 가까워지거나 닿았을 때 부드럽게 알려 드려요"
                },
                NotificationChannel(REST, "쉬는 중", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "이만, 쉬기 진행과 마무리"
                },
                NotificationChannel(GROUP, "함께 쉬기", NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "그룹의 함께 쉬기 초대"
                },
                NotificationChannel(REPORT, "주간 리포트", NotificationManager.IMPORTANCE_LOW),
            ),
        )
    }

    fun allowed(ctx: Context) =
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(
        ctx,
        0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    fun broadcast(ctx: Context, action: String, requestCode: Int, extras: Intent.() -> Unit = {}): PendingIntent =
        PendingIntent.getBroadcast(
            ctx,
            requestCode,
            Intent(ctx, ActionReceiver::class.java).setAction(action).apply(extras),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    fun builder(ctx: Context, channel: String, text: String) = NotificationCompat.Builder(ctx, channel)
        .setSmallIcon(R.drawable.ic_stat_comma)
        .setColor(0xFF7EC3A7.toInt())
        .setContentTitle("이만,")
        .setContentText(text)
        .setStyle(NotificationCompat.BigTextStyle().bigText(text))
        .setContentIntent(openApp(ctx))
        .setAutoCancel(true)

    fun show(ctx: Context, id: Int, n: NotificationCompat.Builder) {
        if (!allowed(ctx)) return
        @Suppress("MissingPermission")
        NotificationManagerCompat.from(ctx).notify(id, n.build())
    }

    fun cancel(ctx: Context, id: Int) = NotificationManagerCompat.from(ctx).cancel(id)
}
