package com.cloimism.iman

import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ImanNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }

    override fun onResume() {
        super.onResume()
        if (Store.restUntil(this) > System.currentTimeMillis()) RestReminderService.start(this)
        // 앱을 열 때마다 즉시 동기화
        Sync.now(this)
    }
}
