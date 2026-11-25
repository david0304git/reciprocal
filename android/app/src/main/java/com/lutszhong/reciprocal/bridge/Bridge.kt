package com.lutszhong.reciprocal.bridge

import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

/**
 * Java-side entry point for `window.ReciprocalNative.invoke(id, command, argsJson)`.
 *
 * Called on the WebView's JavaBridge thread, so every command runs on a dedicated single-thread
 * executor: SQLite work stays serialized and the UI thread is never blocked. Results are handed
 * back through [postJavascript], which the hosting Activity routes to the main thread.
 */
class Bridge(
    private val router: CommandRouter,
    private val postJavascript: (String) -> Unit,
) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "reciprocal-bridge").apply { isDaemon = true }
    }

    @JavascriptInterface
    fun invoke(id: String, command: String, argsJson: String) {
        try {
            executor.execute { run(id, command, argsJson) }
        } catch (error: RejectedExecutionException) {
            postJavascript(
                "window.__reciprocalNativeResolve($id,false,${JSONObject.quote("應用程式正在關閉")})",
            )
            Log.w(TAG, "bridge rejected command $command", error)
        }
    }

    fun shutdown() {
        executor.shutdownNow()
    }

    private fun run(id: String, command: String, argsJson: String) {
        val responder = Responder { ok, payload ->
            val flag = if (ok) "true" else "false"
            postJavascript(
                "window.__reciprocalNativeResolve($id,$flag,${JSONObject.quote(payload)})",
            )
        }
        try {
            val args = when {
                argsJson.isBlank() || argsJson == "null" -> JSONObject()
                else -> JSONObject(argsJson)
            }
            router.dispatch(command, args, responder)
        } catch (error: Throwable) {
            Log.e(TAG, "command failed: $command", error)
            responder.error(error.message ?: "執行失敗")
        }
    }

    private companion object {
        const val TAG = "ReciprocalBridge"
    }
}
