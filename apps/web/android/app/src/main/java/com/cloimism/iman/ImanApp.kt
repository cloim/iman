package com.cloimism.iman

import android.app.Application

class ImanApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        if (Api.signedIn(this)) Sync.schedule(this)
    }
}
