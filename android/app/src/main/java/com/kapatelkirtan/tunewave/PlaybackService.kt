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
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import android.util.Log

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
        // Use a TuneWave-owned channel so its playback controls are explicit and
        // independently configurable from any default media-notification channel.
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this)
                .setChannelId("tunewave_media_playback")
                .setChannelName(R.string.app_name)
                .setNotificationId(DefaultMediaNotificationProvider.DEFAULT_NOTIFICATION_ID)
                .build()
        )
        Log.i(TAG, "PlaybackService created; Media3 notification provider installed")
        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                true
            )
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()

        player.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) = publishState()
            override fun onPlaybackStateChanged(playbackState: Int) = publishState()
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) = publishState()
            override fun onPlayerError(error: PlaybackException) {
                Log.e(TAG, "ExoPlayer error code=${error.errorCodeName}: ${error.message}", error)
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
        // Let Media3 handle its service lifecycle and media-button intents first.
        val result = super.onStartCommand(intent, flags, startId)
        Log.i(TAG, "onStartCommand action=${intent?.action ?: "null"}")
        when (intent?.action) {
            ACTION_PLAY -> {
                startTrack(intent)
                // Force a notification refresh after the requested MediaItem has
                // been installed, including while ExoPlayer is still buffering.
                triggerNotificationUpdate()
            }
            ACTION_PAUSE -> player.pause()
            ACTION_RESUME -> {
                player.play()
                triggerNotificationUpdate()
            }
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
        if (uri == null || !uri.scheme.equals("https", ignoreCase = true) || uri.host.isNullOrBlank()) {
            Log.e(TAG, "Rejected invalid audio URL")
            MainActivity.reportNativePlaybackError("INVALID_STREAM_URL", "The native player received an invalid HTTPS audio URL.")
            return
        }
        Log.i(TAG, "Loading media URL host=${uri.host}")

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
        private const val TAG = "TuneWavePlayback"
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
