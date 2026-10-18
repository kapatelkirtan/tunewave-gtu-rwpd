package com.kapatelkirtan.tunewave

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.webkit.JavascriptInterface

class TuneWaveNativeBridge(context: Context) {
    private val appContext = context.applicationContext

    @JavascriptInterface
    fun playTrack(url: String, title: String, artist: String, artwork: String, positionMs: Long, volume: Double): Boolean {
        val uri = try { Uri.parse(url) } catch (_: Exception) { return false }
        if (!uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return false

        val intent = Intent(appContext, PlaybackService::class.java).apply {
            action = PlaybackService.ACTION_PLAY
            putExtra(PlaybackService.EXTRA_URL, uri.toString())
            putExtra(PlaybackService.EXTRA_TITLE, title.take(300))
            putExtra(PlaybackService.EXTRA_ARTIST, artist.take(200))
            putExtra(PlaybackService.EXTRA_ARTWORK, artwork.take(2000))
            putExtra(PlaybackService.EXTRA_POSITION_MS, positionMs.coerceAtLeast(0L))
            putExtra(PlaybackService.EXTRA_VOLUME, volume.coerceIn(0.0, 1.0).toFloat())
        }
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) appContext.startForegroundService(intent)
            else appContext.startService(intent)
            true
        } catch (_: Exception) {
            false
        }
    }

    @JavascriptInterface
    fun pause() = send(PlaybackService.ACTION_PAUSE)

    @JavascriptInterface
    fun resume() = send(PlaybackService.ACTION_RESUME)

    @JavascriptInterface
    fun seekTo(positionMs: Long) {
        send(PlaybackService.ACTION_SEEK) {
            putExtra(PlaybackService.EXTRA_POSITION_MS, positionMs.coerceAtLeast(0L))
        }
    }

    @JavascriptInterface
    fun setVolume(volume: Double) {
        send(PlaybackService.ACTION_VOLUME) {
            putExtra(PlaybackService.EXTRA_VOLUME, volume.coerceIn(0.0, 1.0).toFloat())
        }
    }

    @JavascriptInterface
    fun getPositionMs(): Long = PlaybackService.snapshotPositionMs

    @JavascriptInterface
    fun getDurationMs(): Long = PlaybackService.snapshotDurationMs

    @JavascriptInterface
    fun isPlaying(): Boolean = PlaybackService.snapshotIsPlaying

    private fun send(action: String, fill: Intent.() -> Unit = {}) {
        val intent = Intent(appContext, PlaybackService::class.java).apply {
            this.action = action
            fill()
        }
        try { appContext.startService(intent) } catch (_: Exception) { /* No active service yet. */ }
    }
}
