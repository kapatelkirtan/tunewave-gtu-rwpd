package com.kapatelkirtan.tunewave

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private lateinit var player: ExoPlayer
    private var mediaSession: MediaSession? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private val positionPublisher = object : Runnable {
        override fun run() {
            if (::player.isInitialized) publishState()
            mainHandler.postDelayed(this, 750L)
        }
    }

    override fun onCreate() {
        super.onCreate()
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) = publishState()
            override fun onPlaybackStateChanged(playbackState: Int) = publishState()
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = publishState()
            override fun onPlayerError(error: PlaybackException) {
                snapshotIsPlaying = false
                MainActivity.reportNativePlaybackState(
                    snapshotPositionMs, snapshotDurationMs, false, player.playbackState
                )
                MainActivity.reportNativePlaybackError(error.errorCodeName, error.message ?: "The stream failed to load.")
            }
        })

        mediaSession = MediaSession.Builder(this, player).build()
        mainHandler.post(positionPublisher)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val result = super.onStartCommand(intent, flags, startId)
        when (intent?.action) {
            ACTION_PLAY -> startTrack(intent)
            ACTION_PAUSE -> player.pause()
            ACTION_RESUME -> player.play()
            ACTION_SEEK -> player.seekTo(intent.getLongExtra(EXTRA_POSITION_MS, 0L).coerceAtLeast(0L))
            ACTION_VOLUME -> player.volume = intent.getFloatExtra(EXTRA_VOLUME, 1f).coerceIn(0f, 1f)
            ACTION_STOP -> {
                player.stop()
                player.clearMediaItems()
            }
        }
        publishState()
        return result
    }

    private fun startTrack(intent: Intent) {
        val url = intent.getStringExtra(EXTRA_URL).orEmpty()
        val uri = try { Uri.parse(url) } catch (_: Exception) { null }
        if (uri == null || !uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) return

        val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "TuneWave" }
        val artist = intent.getStringExtra(EXTRA_ARTIST).orEmpty().ifBlank { "Unknown artist" }
        val artwork = intent.getStringExtra(EXTRA_ARTWORK).orEmpty()
        val artworkUri = try {
            Uri.parse(artwork).takeIf { it.scheme.equals("https", ignoreCase = true) }
        } catch (_: Exception) { null }
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(artist)
            .setAlbumTitle("TuneWave")
            .apply { if (artworkUri != null) setArtworkUri(artworkUri) }
            .build()
        val item = MediaItem.Builder()
            .setUri(uri)
            .setMediaId(uri.toString())
            .setMediaMetadata(metadata)
            .build()

        player.volume = intent.getFloatExtra(EXTRA_VOLUME, 0.8f).coerceIn(0f, 1f)
        val startPosition = intent.getLongExtra(EXTRA_POSITION_MS, 0L).coerceAtLeast(0L)
        player.setMediaItem(item, startPosition)
        player.prepare()
        player.play()
        publishState()
    }

    private fun publishState() {
        if (!::player.isInitialized) return
        val position = player.currentPosition.coerceAtLeast(0L)
        val duration = if (player.duration == C.TIME_UNSET || player.duration < 0L) 0L else player.duration
        snapshotPositionMs = position
        snapshotDurationMs = duration
        snapshotIsPlaying = player.isPlaying
        MainActivity.reportNativePlaybackState(position, duration, player.isPlaying, player.playbackState)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = mediaSession

    override fun onDestroy() {
        mainHandler.removeCallbacks(positionPublisher)
        mediaSession?.release()
        mediaSession = null
        if (::player.isInitialized) player.release()
        snapshotIsPlaying = false
        super.onDestroy()
    }

    companion object {
        const val ACTION_PLAY = "com.kapatelkirtan.tunewave.action.PLAY"
        const val ACTION_PAUSE = "com.kapatelkirtan.tunewave.action.PAUSE"
        const val ACTION_RESUME = "com.kapatelkirtan.tunewave.action.RESUME"
        const val ACTION_SEEK = "com.kapatelkirtan.tunewave.action.SEEK"
        const val ACTION_VOLUME = "com.kapatelkirtan.tunewave.action.VOLUME"
        const val ACTION_STOP = "com.kapatelkirtan.tunewave.action.STOP"
        const val EXTRA_URL = "stream_url"
        const val EXTRA_TITLE = "track_title"
        const val EXTRA_ARTIST = "track_artist"
        const val EXTRA_ARTWORK = "track_artwork"
        const val EXTRA_POSITION_MS = "position_ms"
        const val EXTRA_VOLUME = "volume"

        @Volatile var snapshotPositionMs: Long = 0L
            private set
        @Volatile var snapshotDurationMs: Long = 0L
            private set
        @Volatile var snapshotIsPlaying: Boolean = false
            private set
    }
}
