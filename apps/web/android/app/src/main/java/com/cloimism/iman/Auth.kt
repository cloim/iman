package com.cloimism.iman

import android.app.Activity
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class SignInCancelled : Exception("cancelled")

/** Credential Manager 로 구글 ID 토큰을 받아 이만 서버 토큰으로 교환한다 */
object Auth {
    suspend fun signIn(activity: Activity) {
        val clientId = BuildConfig.GOOGLE_WEB_CLIENT_ID
        if (clientId.isBlank() && BuildConfig.DEBUG) return devSignIn(activity)
        if (clientId.isBlank()) throw ApiException(503, "google_not_configured")
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
            .build()
        val result = try {
            CredentialManager.create(activity).getCredential(activity, request)
        } catch (e: GetCredentialCancellationException) {
            throw SignInCancelled()
        }
        val cred = result.credential
        if (cred !is CustomCredential || cred.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            throw ApiException(400, "unsupported_credential")
        }
        val idToken = GoogleIdTokenCredential.createFrom(cred.data).idToken
        val ctx = activity.applicationContext
        withContext(Dispatchers.IO) {
            val tokens = Api.request(
                ctx,
                "POST",
                "/api/auth/google",
                JSONObject().put("idToken", idToken).put("client", "app"),
                auth = false,
            )
            Api.saveTokens(ctx, tokens)
            Device.register(ctx)
        }
        Sync.schedule(ctx)
        Sync.now(ctx)
    }

    /** 디버그 빌드 + 개발 서버(DEV_LOGIN=1) 전용 로그인 */
    private suspend fun devSignIn(activity: Activity) {
        val ctx = activity.applicationContext
        withContext(Dispatchers.IO) {
            val tokens = Api.request(
                ctx,
                "POST",
                "/api/auth/dev",
                JSONObject().put("email", "android@iman.dev").put("name", "안드로이드").put("client", "app"),
                auth = false,
            )
            Api.saveTokens(ctx, tokens)
            Device.register(ctx)
        }
        Sync.schedule(ctx)
        Sync.now(ctx)
    }

    suspend fun signOut(activity: Activity) {
        val ctx = activity.applicationContext
        withContext(Dispatchers.IO) {
            Store.getSecret(ctx, "rt")?.let { rt ->
                runCatching { Api.request(ctx, "POST", "/api/auth/logout", JSONObject().put("refreshToken", rt), auth = false) }
            }
            Store.clearSession(ctx)
        }
        runCatching { CredentialManager.create(activity).clearCredentialState(androidx.credentials.ClearCredentialStateRequest()) }
        Widgets.updateAll(ctx)
    }
}
