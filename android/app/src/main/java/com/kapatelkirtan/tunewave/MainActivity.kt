package com.kapatelkirtan.tunewave

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import java.lang.ref.WeakReference
import org.json.JSONObject

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = android.graphics.Color.rgb(7, 10, 14)
        window.navigationBarColor = android.graphics.Color.rgb(7, 10, 14)

        webView = WebView(this)
        webView.layoutParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        setContentView(webView)
        activeWebView = WeakReference(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.javaScriptCanOpenWindowsAutomatically = true
        webView.settings.allowFileAccess = false
        webView.settings.allowContentAccess = false
        webView.settings.mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true)

        webView.addJavascriptInterface(TuneWaveNativeBridge(applicationContext), "TuneWaveNative")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val uri = request?.url ?: return false
                if (!request.isForMainFrame) return false
                val scheme = uri.scheme?.lowercase()
                if (scheme != "http" && scheme != "https") return true
                if (uri.host.equals(SITE_HOST, ignoreCase = true)) return false
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, uri))
                    true
                } catch (_: Exception) {
                    false
                }
            }
        }

        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQUEST_NOTIFICATIONS)
        }

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState)
        } else {
            webView.loadUrl(SITE_URL)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        webView.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    @Deprecated("Deprecated in Android API; retained for backwards navigation")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        if (activeWebView?.get() === webView) activeWebView = null
        super.onDestroy()
    }

    companion object {
        private const val SITE_HOST = "tunewave-gtu-rwpd-1.onrender.com"
        private const val SITE_URL = "https://tunewave-gtu-rwpd-1.onrender.com/"
        private const val REQUEST_NOTIFICATIONS = 4107
        @Volatile private var activeWebView: WeakReference<WebView>? = null

        @JvmStatic
        fun reportNativePlaybackState(positionMs: Long, durationMs: Long, isPlaying: Boolean, playbackState: Int) {
            val view = activeWebView?.get() ?: return
            val safePosition = positionMs.coerceAtLeast(0L)
            val safeDuration = durationMs.coerceAtLeast(0L)
            view.post {
                val script = "window.onTuneWaveNativeState && window.onTuneWaveNativeState($safePosition,$safeDuration,$isPlaying,$playbackState);"
                view.evaluateJavascript(script, null)
            }
        }

        @JvmStatic
        fun reportNativePlaybackError(errorCode: String, message: String) {
            val view = activeWebView?.get() ?: return
            val safeCode = JSONObject.quote(errorCode.take(80))
            val safeMessage = JSONObject.quote(message.take(500))
            view.post {
                val script = "window.onTuneWaveNativeError && window.onTuneWaveNativeError($safeCode,$safeMessage);"
                view.evaluateJavascript(script, null)
            }
        }
    }
}
