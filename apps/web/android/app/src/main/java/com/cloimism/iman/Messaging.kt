package com.cloimism.iman

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/** 서버 푸시: 함께 쉬기 초대, 주간 리포트 */
class Messaging : FirebaseMessagingService() {
    override fun onNewToken(token: String) = Device.uploadPushToken(applicationContext, token)

    override fun onMessageReceived(message: RemoteMessage) {
        val ctx = applicationContext
        val data = message.data
        val body = data["body"] ?: return
        when (data["kind"]) {
            "pause" -> {
                val pauseId = data["pauseId"] ?: return
                val endsAt = data["endsAt"]?.toLongOrNull() ?: return
                Notifications.show(
                    ctx,
                    PAUSE_ID,
                    Notifications.builder(ctx, Notifications.GROUP, body)
                        .setContentTitle(data["title"] ?: "함께 쉬기")
                        .setTimeoutAfter(maxOf(60_000L, endsAt - System.currentTimeMillis()))
                        .addAction(
                            0,
                            "함께 쉬기",
                            Notifications.broadcast(ctx, ActionReceiver.JOIN_PAUSE, 21) {
                                putExtra("pauseId", pauseId)
                                putExtra("endsAt", endsAt)
                            },
                        ),
                )
            }
            "weekly" -> Notifications.show(
                ctx,
                REPORT_ID,
                Notifications.builder(ctx, Notifications.REPORT, body).setContentTitle(data["title"] ?: "주간 쉼표 리포트"),
            )
        }
    }

    companion object {
        const val PAUSE_ID = 3001
        const val REPORT_ID = 3002
    }
}
