package com.cloimism.iman

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** WebView(React)와 네이티브 기능을 잇는 플러그인. 계약은 apps/web/src/lib/native.ts */
@CapacitorPlugin(
    name = "ImanNative",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class ImanNativePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private fun fail(call: PluginCall, e: Throwable) = when (e) {
        is SignInCancelled -> call.reject("cancelled", "cancelled")
        is ApiException -> call.reject(e.code, e.code)
        else -> call.reject(e.message ?: "error", "error")
    }

    @PluginMethod
    fun signIn(call: PluginCall) {
        scope.launch {
            try {
                Auth.signIn(activity)
                call.resolve(JSObject().put("ok", true))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    @PluginMethod
    fun signOut(call: PluginCall) {
        scope.launch {
            runCatching { Auth.signOut(activity) }
            call.resolve()
        }
    }

    @PluginMethod
    fun getAccessToken(call: PluginCall) {
        val force = call.getBoolean("force", false) ?: false
        scope.launch {
            try {
                val token = withContext(Dispatchers.IO) { Api.accessToken(context, force) }
                call.resolve(JSObject().put("token", token))
            } catch (e: Throwable) {
                call.resolve(JSObject().put("token", null))
            }
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ctx = context
        call.resolve(
            JSObject()
                .put("signedIn", Api.signedIn(ctx))
                .put("usagePermission", UsageCollector.hasPermission(ctx))
                .put("notificationPermission", Notifications.allowed(ctx))
                .put("installPermission", ctx.packageManager.canRequestPackageInstalls())
                .put("deviceId", Store.deviceId(ctx))
                .put("lastSyncAt", Store.lastSyncAt(ctx).takeIf { it > 0 })
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("versionCode", Updater.currentCode(ctx)),
        )
    }

    @PluginMethod
    fun openUsageSettings(call: PluginCall) {
        val intent = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${context.packageName}"))
        runCatching { activity.startActivity(intent) }
            .onFailure { activity.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
        call.resolve()
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(JSObject().put("granted", true))
        } else {
            requestPermissionForAlias("notifications", call, "notificationCallback")
        }
    }

    @PermissionCallback
    private fun notificationCallback(call: PluginCall) {
        call.resolve(JSObject().put("granted", getPermissionState("notifications") == PermissionState.GRANTED))
    }

    @PluginMethod
    fun openInstallSettings(call: PluginCall) {
        activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}")))
        call.resolve()
    }

    @PluginMethod
    fun syncNow(call: PluginCall) {
        scope.launch {
            try {
                call.resolve(JSObject().put("accepted", Sync.run(context)))
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }

    @PluginMethod
    fun startRest(call: PluginCall) {
        val minutes = call.getInt("minutes", 30) ?: 30
        val source = call.getString("source", "app") ?: "app"
        val pauseId = call.getString("pauseId")
        scope.launch {
            withContext(Dispatchers.IO) { Rest.start(context, minutes, source, pauseId) }
            call.resolve()
        }
    }

    @PluginMethod
    fun checkUpdate(call: PluginCall) {
        scope.launch {
            try {
                val r = withContext(Dispatchers.IO) { Updater.latest() }
                val current = Updater.currentCode(context)
                call.resolve(
                    JSObject()
                        .put("available", r.versionCode > current)
                        .put("versionName", r.versionName)
                        .put("notes", r.notes)
                        .put("mandatory", current < r.minSupported),
                )
            } catch (e: Throwable) {
                call.resolve(JSObject().put("available", false).put("versionName", null).put("notes", null).put("mandatory", false))
            }
        }
    }

    @PluginMethod
    fun installUpdate(call: PluginCall) {
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    val r = Updater.latest()
                    Updater.install(context, r) { phase, done, total ->
                        notifyListeners("updateProgress", JSObject().put("phase", phase).put("downloaded", done).put("total", total))
                    }
                }
                call.resolve()
            } catch (e: Throwable) {
                fail(call, e)
            }
        }
    }
}
