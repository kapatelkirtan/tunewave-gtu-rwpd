package com.kirtan.tunewave.pip;

import android.app.Activity;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;
import android.util.Rational;

public final class MainActivity extends Activity {
    private static final String START_URL = "https://tunewave-gtu-rwpd-1.onrender.com/";
    private static final String SITE_HOST = "tunewave-gtu-rwpd-1.onrender.com";

    static final String ACTION_PLAY = "com.kirtan.tunewave.pip.PLAY";
    static final String ACTION_PAUSE = "com.kirtan.tunewave.pip.PAUSE";
    static final String ACTION_PREVIOUS = "com.kirtan.tunewave.pip.PREVIOUS";
    static final String ACTION_NEXT = "com.kirtan.tunewave.pip.NEXT";

    private static MainActivity currentActivity;

    private WebView webView;
    private LinearLayout pipCard;
    private TextView titleView;
    private TextView artistView;
    private TextView playPauseView;
    private MediaSession mediaSession;
    private boolean isPlaying;
    private String currentTitle = "TuneWave";
    private String currentArtist = "Ready to play";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        currentActivity = this;

        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(7, 10, 14));
        window.setNavigationBarColor(Color.rgb(7, 10, 14));

        FrameLayout root = new FrameLayout(this);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 10, 14));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        pipCard = buildPipCard();
        pipCard.setVisibility(View.GONE);
        root.addView(pipCard, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        setupMediaSession();
        setupWebView();
        updatePipParams();
    }

    private void setupWebView() {
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setAllowContentAccess(false);
        webView.setWebChromeClient(new WebChromeClient());
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.addJavascriptInterface(new TuneWaveBridge(), "TuneWaveAndroidBridge");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!request.isForMainFrame()) return false;
                if ("https".equalsIgnoreCase(uri.getScheme()) &&
                        SITE_HOST.equalsIgnoreCase(uri.getHost())) return false;

                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                    return true;
                } catch (Exception ignored) {
                    return false;
                }
            }
        });
        webView.loadUrl(START_URL);
    }

    private LinearLayout buildPipCard() {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setGravity(Gravity.CENTER_VERTICAL);
        card.setPadding(dp(14), dp(12), dp(14), dp(10));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.rgb(7, 10, 14));
        background.setCornerRadius(dp(12));
        card.setBackground(background);

        TextView eyebrow = new TextView(this);
        eyebrow.setText("TUNEWAVE  •  MINI PLAYER");
        eyebrow.setTextColor(Color.rgb(80, 232, 255));
        eyebrow.setTextSize(10);
        eyebrow.setLetterSpacing(0.06f);
        card.addView(eyebrow, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        titleView = new TextView(this);
        titleView.setText(currentTitle);
        titleView.setTextColor(Color.WHITE);
        titleView.setTextSize(16);
        titleView.setTypeface(null, android.graphics.Typeface.BOLD);
        titleView.setMaxLines(1);
        titleView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        titleParams.topMargin = dp(5);
        card.addView(titleView, titleParams);

        artistView = new TextView(this);
        artistView.setText(currentArtist);
        artistView.setTextColor(Color.rgb(166, 185, 197));
        artistView.setTextSize(12);
        artistView.setMaxLines(1);
        artistView.setEllipsize(android.text.TextUtils.TruncateAt.END);
        LinearLayout.LayoutParams artistParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        artistParams.topMargin = dp(2);
        card.addView(artistView, artistParams);

        LinearLayout controls = new LinearLayout(this);
        controls.setGravity(Gravity.CENTER);
        controls.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams controlsParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        controlsParams.topMargin = dp(8);

        TextView previous = makeControl("|◀");
        previous.setOnClickListener(v -> runTuneWaveCommand("previous"));
        playPauseView = makeControl("▶");
        playPauseView.setOnClickListener(v -> runTuneWaveCommand("toggle"));
        TextView next = makeControl("▶|");
        next.setOnClickListener(v -> runTuneWaveCommand("next"));

        controls.addView(previous, new LinearLayout.LayoutParams(dp(54), dp(38)));
        controls.addView(playPauseView, new LinearLayout.LayoutParams(dp(64), dp(38)));
        controls.addView(next, new LinearLayout.LayoutParams(dp(54), dp(38)));
        card.addView(controls, controlsParams);
        return card;
    }

    private TextView makeControl(String text) {
        TextView view = new TextView(this);
        view.setText(text);
        view.setTextSize(17);
        view.setTextColor(Color.WHITE);
        view.setGravity(Gravity.CENTER);
        view.setClickable(true);
        view.setFocusable(true);
        GradientDrawable shape = new GradientDrawable();
        shape.setColor(Color.rgb(22, 34, 43));
        shape.setCornerRadius(dp(10));
        view.setBackground(shape);
        view.setContentDescription(text);
        return view;
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void setupMediaSession() {
        mediaSession = new MediaSession(this, "TuneWave");
        mediaSession.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS |
                MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { runTuneWaveCommand("play"); }
            @Override public void onPause() { runTuneWaveCommand("pause"); }
            @Override public void onSkipToNext() { runTuneWaveCommand("next"); }
            @Override public void onSkipToPrevious() { runTuneWaveCommand("previous"); }
        });
        mediaSession.setActive(true);
        updateMediaSession();
    }

    private void updateMediaSession() {
        if (mediaSession == null) return;
        mediaSession.setMetadata(new MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentArtist)
                .putString(MediaMetadata.METADATA_KEY_ALBUM, "TuneWave")
                .build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE |
                PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SKIP_TO_NEXT |
                PlaybackState.ACTION_SKIP_TO_PREVIOUS;
        mediaSession.setPlaybackState(new PlaybackState.Builder()
                .setActions(actions)
                .setState(isPlaying ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                        PlaybackState.PLAYBACK_POSITION_UNKNOWN, isPlaying ? 1f : 0f)
                .build());
    }

    private PendingIntent pipPendingIntent(String action, int requestCode) {
        Intent intent = new Intent(this, PipActionReceiver.class);
        intent.setAction(action);
        return PendingIntent.getBroadcast(this, requestCode, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private List<RemoteAction> buildPipActions() {
        List<RemoteAction> actions = new ArrayList<>();
        actions.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_previous),
                "Previous", "Previous track", pipPendingIntent(ACTION_PREVIOUS, 101)));
        if (isPlaying) {
            actions.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_pause),
                    "Pause", "Pause playback", pipPendingIntent(ACTION_PAUSE, 102)));
        } else {
            actions.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_play),
                    "Play", "Resume playback", pipPendingIntent(ACTION_PLAY, 103)));
        }
        actions.add(new RemoteAction(Icon.createWithResource(this, android.R.drawable.ic_media_next),
                "Next", "Next track", pipPendingIntent(ACTION_NEXT, 104)));
        return actions;
    }

    private void updatePipParams() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
                !getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) return;

        PictureInPictureParams.Builder builder = new PictureInPictureParams.Builder()
                .setAspectRatio(new Rational(16, 9))
                .setActions(buildPipActions());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setAutoEnterEnabled(isPlaying);
        }
        try {
            setPictureInPictureParams(builder.build());
        } catch (IllegalArgumentException ignored) {
            // Some devices reject PiP parameters during lifecycle transitions.
        }
    }

    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
                Build.VERSION.SDK_INT < Build.VERSION_CODES.S && isPlaying &&
                getPackageManager().hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            try {
                enterPictureInPictureMode(new PictureInPictureParams.Builder()
                        .setAspectRatio(new Rational(16, 9))
                        .setActions(buildPipActions())
                        .build());
            } catch (IllegalArgumentException ignored) {
                // PiP may be unavailable because of device settings or system limits.
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPipMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(inPipMode, newConfig);
        pipCard.setVisibility(inPipMode ? View.VISIBLE : View.GONE);
    }

    private void runTuneWaveCommand(String command) {
        if (webView == null) return;
        String script = "(function(){var p=window.TuneWaveAndroidControls;" +
                "if(p&&typeof p['" + command + "']==='function'){p['" + command + "']();}})();";
        webView.evaluateJavascript(script, null);
    }

    private void acceptPlaybackState(boolean playing, String title, String artist) {
        runOnUiThread(() -> {
            isPlaying = playing;
            currentTitle = title == null || title.trim().isEmpty() ? "TuneWave" : title.trim();
            currentArtist = artist == null || artist.trim().isEmpty() ? "Music" : artist.trim();
            titleView.setText(currentTitle);
            artistView.setText(currentArtist);
            playPauseView.setText(isPlaying ? "Ⅱ" : "▶");
            updateMediaSession();
            updatePipParams();
        });
    }

    final class TuneWaveBridge {
        @JavascriptInterface
        public void onPlaybackStateChanged(boolean playing, String title, String artist) {
            acceptPlaybackState(playing, title, artist);
        }
    }

    static void dispatchPipAction(Context context, String action) {
        MainActivity activity = currentActivity;
        if (activity == null) return;
        activity.runOnUiThread(() -> {
            if (ACTION_PLAY.equals(action)) activity.runTuneWaveCommand("play");
            else if (ACTION_PAUSE.equals(action)) activity.runTuneWaveCommand("pause");
            else if (ACTION_PREVIOUS.equals(action)) activity.runTuneWaveCommand("previous");
            else if (ACTION_NEXT.equals(action)) activity.runTuneWaveCommand("next");
        });
    }

    @Override
    public void onBackPressed() {
        if (!isInPictureInPictureMode() && webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (currentActivity == this) currentActivity = null;
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        if (webView != null) {
            webView.removeJavascriptInterface("TuneWaveAndroidBridge");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
