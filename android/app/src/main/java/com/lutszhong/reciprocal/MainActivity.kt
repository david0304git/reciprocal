package com.lutszhong.reciprocal

import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.ViewGroup
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.doOnLayout
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.lutszhong.reciprocal.bridge.ActivityHost
import com.lutszhong.reciprocal.bridge.Bridge
import com.lutszhong.reciprocal.bridge.PickMode

/**
 * Hosts the Reciprocal web UI (the unchanged React frontend from the Tauri desktop build) inside an
 * Android [WebView] served from `https://appassets.androidplatform.net/assets/web/`.
 *
 * The web layer talks to Kotlin through the `ReciprocalNative` bridge (see `web/public/tauri-shim.js`)
 * and to the UI shell through `ReciprocalHost` (theme changes, readiness logging).
 *
 * NOTE: the WebView is hosted in a plain [FrameLayout], not in a Compose `AndroidView`. Inside Compose
 * the WebView reports a zero-height CSS viewport (100vh/100dvh and even percentage heights resolve to
 * 0px while the page still paints), which breaks the entire layout. A plain view hierarchy gives
 * Chromium the correct viewport, so the whole shell stays web-based.
 */
class MainActivity : ComponentActivity(), ActivityHost {

    private lateinit var container: AppContainer
    private var bridge: Bridge? = null
    private var webView: WebView? = null

    private var pendingPermissions: ((Map<String, Boolean>) -> Unit)? = null
    private var pendingOpen: ((String?) -> Unit)? = null
    private var pendingCreate: ((String?) -> Unit)? = null

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            val callback = pendingPermissions
            pendingPermissions = null
            callback?.invoke(result)
        }

    private val openDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingOpen
            pendingOpen = null
            val uri = if (result.resultCode == RESULT_OK) result.data?.data?.toString() else null
            callback?.invoke(uri)
        }

    private val createDocumentLauncher =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = pendingCreate
            pendingCreate = null
            val uri = if (result.resultCode == RESULT_OK) result.data?.data?.toString() else null
            callback?.invoke(uri)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        container = AppContainer(this, this)

        val paper = getColor(if (isNightMode()) R.color.paper_dark else R.color.paper_light)
        window.setBackgroundDrawable(ColorDrawable(paper))

        val host = FrameLayout(this).apply { setBackgroundColor(paper) }
        val web = createWebView()
        host.addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        setContentView(host)

        // Edge-to-edge is enforced from API 35: pad the host so the page never sits under the status
        // bar, the navigation bar or the keyboard.
        ViewCompat.setOnApplyWindowInsetsListener(host) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
            )
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            // The page covers the gesture-bar strip itself (the nav is painted all the way down and the
            // labels sit above it via env(safe-area-inset-bottom)), so only the keyboard is padded here —
            // padding both layers counted the safe area twice and left ~24px of dead space under the nav.
            val bottom = ime.bottom
            val changed = view.paddingLeft != bars.left || view.paddingTop != bars.top ||
                view.paddingRight != bars.right || view.paddingBottom != bottom
            if (changed) view.setPadding(bars.left, bars.top, bars.right, bottom)
            insets
        }
        ViewCompat.requestApplyInsets(host)
        // Match the system bar icons to the theme the page will use before it reports its own theme.
        applySystemBarAppearance(isNightMode())

        onBackPressedDispatcher.addCallback(this) { handleBack() }
    }

    // ------------------------------------------------------------------ WebView

    private fun createWebView(): WebView {
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        val web = WebView(this)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            useWideViewPort = true
            loadWithOverviewMode = true
            userAgentString = "$userAgentString ReciprocalAndroid/0.1.7"
        }

        WebView.setWebContentsDebuggingEnabled(isDebuggable())

        web.addOnLayoutChangeListener { _, left, top, right, bottom, oldLeft, oldTop, oldRight, oldBottom ->
            Log.i(
                TAG,
                "webview layout ${right - left}x${bottom - top} (was ${oldRight - oldLeft}x${oldBottom - oldTop})",
            )
        }

        web.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)

            override fun onPageFinished(view: WebView, url: String) {
                super.onPageFinished(view, url)
                Log.i(TAG, "page finished: $url view=${view.width}x${view.height}")
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest,
            ): Boolean {
                val url = request.url
                if (url.host == APP_HOST) return false
                // Anything outside the bundled app opens in the system browser instead.
                openExternal(url.toString())
                return true
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.i(TAG, "[web] ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        val commandBridge = Bridge(container.router) { javascript ->
            web.post { web.evaluateJavascript(javascript, null) }
        }
        bridge = commandBridge
        web.addJavascriptInterface(commandBridge, "ReciprocalNative")
        web.addJavascriptInterface(UiHost(), "ReciprocalHost")
        if (isDebuggable()) {
            // Only the debug build exposes the end-to-end test hooks (scripts/e2e-android.mjs).
            web.addJavascriptInterface(DebugHost(), "ReciprocalDebug")
        }

        var started = false
        web.doOnLayout {
            if (!started) {
                started = true
                web.loadUrl(START_URL)
            }
        }

        webView = web
        return web
    }

    /** Callbacks from the web layer that are not command-shaped. */
    private inner class UiHost {
        @JavascriptInterface
        fun setDarkMode(dark: Boolean) {
            runOnUiThread { applySystemBarAppearance(dark) }
        }

        @JavascriptInterface
        fun ready(info: String) {
            Log.i(TAG, "ui ready: $info")
        }

        @JavascriptInterface
        fun hasCalendarPermission(): Boolean = hostHasCalendarPermission()

        /**
         * Real system night mode. The WebView's `prefers-color-scheme` always reports light here
         * because the activity uses a Light platform theme, so the page asks the shell instead.
         */
        @JavascriptInterface
        fun isSystemDark(): Boolean = isNightMode()

        @JavascriptInterface
        fun log(message: String) {
            Log.i(WEB_TAG, message)
        }
    }

    /** Debug-only extras used by the end-to-end test harness over the Chrome DevTools protocol. */
    private inner class DebugHost {
        @JavascriptInterface
        fun bridgeId(): String = "reciprocal-android"

        @JavascriptInterface
        fun storagePath(): String = container.store.storageInfo().dbPath
    }

    private fun applySystemBarAppearance(dark: Boolean) {
        val controller = WindowCompat.getInsetsController(window, window.decorView)
        controller.isAppearanceLightStatusBars = !dark
        controller.isAppearanceLightNavigationBars = !dark
        val paper = getColor(if (dark) R.color.paper_dark else R.color.paper_light)
        window.setBackgroundDrawable(ColorDrawable(paper))
        window.decorView.setBackgroundColor(paper)
    }

    private fun handleBack() {
        val web = webView
        if (web == null) {
            finish()
            return
        }
        web.evaluateJavascript("window.__reciprocalBack ? window.__reciprocalBack() : false") { result ->
            val handled = result?.trim()?.trim('"') == "true"
            if (!handled) finish()
        }
    }

    private fun hostHasCalendarPermission(): Boolean {
        val read = ContextCompat.checkSelfPermission(this, android.Manifest.permission.READ_CALENDAR)
        val write = ContextCompat.checkSelfPermission(this, android.Manifest.permission.WRITE_CALENDAR)
        return read == PackageManager.PERMISSION_GRANTED && write == PackageManager.PERMISSION_GRANTED
    }

    private fun isDebuggable(): Boolean =
        (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun isNightMode(): Boolean =
        (resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) ==
            android.content.res.Configuration.UI_MODE_NIGHT_YES

    override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {
        super.onConfigurationChanged(newConfig)
        // The manifest declares configChanges, so the WebView survives a day/night switch; tell the
        // page so an "auto" theme can re-resolve itself.
        webView?.evaluateJavascript(
            "window.__reciprocalSystemThemeChanged && window.__reciprocalSystemThemeChanged()",
            null,
        )
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onPause() {
        webView?.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        bridge?.shutdown()
        webView?.let { web ->
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        webView = null
        bridge = null
        super.onDestroy()
    }

    // ------------------------------------------------------------------ ActivityHost

    override fun openExternal(url: String) {
        if (!url.startsWith("https://github.com/")) {
            Log.w(TAG, "refused to open non-GitHub url: $url")
            return
        }
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (error: ActivityNotFoundException) {
            Toast.makeText(this, "找不到可開啟連結的應用程式", Toast.LENGTH_SHORT).show()
        }
    }

    override fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    override fun isPermissionPermanentlyDenied(permission: String): Boolean =
        !hasPermission(permission) && !shouldShowRequestPermissionRationale(permission)

    override fun requestPermissions(
        permissions: Array<String>,
        onResult: (granted: Map<String, Boolean>) -> Unit,
    ) {
        val missing = permissions.filter { !hasPermission(it) }
        if (missing.isEmpty()) {
            onResult(permissions.associateWith { true })
            return
        }
        pendingPermissions = onResult
        permissionLauncher.launch(missing.toTypedArray())
    }

    override fun pickDocument(
        mode: PickMode,
        mimeType: String,
        suggestedName: String?,
        onResult: (uri: String?) -> Unit,
    ) {
        val intent = when (mode) {
            PickMode.OPEN -> Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeType
            }

            PickMode.CREATE -> Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                type = mimeType
                suggestedName?.let { putExtra(Intent.EXTRA_TITLE, it) }
            }
        }
        try {
            when (mode) {
                PickMode.OPEN -> {
                    pendingOpen = onResult
                    openDocumentLauncher.launch(intent)
                }

                PickMode.CREATE -> {
                    pendingCreate = onResult
                    createDocumentLauncher.launch(intent)
                }
            }
        } catch (error: ActivityNotFoundException) {
            Log.w(TAG, "no document provider for $mimeType", error)
            onResult(null)
        }
    }

    override fun openAppSettings() {
        startActivity(
            Intent(
                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.fromParts("package", packageName, null),
            ),
        )
    }

    private companion object {
        const val TAG = "Reciprocal"
        const val WEB_TAG = "ReciprocalWeb"
        const val APP_HOST = "appassets.androidplatform.net"
        const val START_URL = "https://appassets.androidplatform.net/assets/web/index.html"
    }
}
