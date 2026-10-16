# TuneWave — Audius rebuild

A responsive, installable web music player powered by the official Audius API. This is a standalone replacement package; it has not been merged into the original GitHub repository because repository access was unavailable in the build environment.

## Features in this build

- Search Audius tracks and load weekly trending tracks.
- Audio playback, seek/progress, volume/mute, previous/next, shuffle and repeat.
- Liked tracks and playlists stored locally in the current browser.
- Add tracks to playlists using the `+` button in each track row.
- Media Session API integration for compatible browser/device lock-screen controls and metadata.
- PWA manifest with 192/512 PNG icons and iOS touch icon, versioned service-worker shell caching, and a Download App button.
- Native install prompt on supported Chromium browsers, plus Android/iOS/desktop installation guidance when the prompt is unavailable.
- Media Session action handlers (play/pause, next/previous, seek) and playback-position updates for compatible lock screens.
- No TuneWave paid tier, ad slots, ad SDKs, or ad network scripts included.
- Audius API key can be entered in Provider Settings. It is stored in this browser only. Never place an Audius bearer token in frontend code.

## Requirements and caveats

- An internet connection is required for Audius search and streaming. The app itself is free and no TuneWave premium subscription is implemented.
- Provider track availability and any track-level stream restrictions are controlled by Audius and its rights holders. This app does not include all YouTube/Spotify commercial songs.
- Media Session lock-screen buttons/background playback depend on browser, OS, battery policy, installation context, and provider stream behavior. The Download App button installs the website as a PWA where supported; it does not create an APK. Test on the target phone. A PWA cannot guarantee background playback on every device, and iOS users should add it to the Home Screen using Safari.
- Likes and playlists are stored locally in the browser and do not sync between devices. Account-based sync would require authentication and a backend/provider OAuth integration.
- The service worker caches the app shell only, not music audio. No tracks are downloaded or re-hosted.

## Run locally

Serve this directory over HTTP (service workers do not run from `file://`). For example:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`. For install prompts, serve from localhost or HTTPS (not `file://`).

## Deploy on Render as a Static Site

1. Push these files to a Git repository.
2. In Render, create a **Static Site** for that repository.
3. Build command: leave blank (no build step required).
4. Publish directory: `.` (repository root).
5. Deploy and test search/playback on your phone.

If your existing Render service is configured as a Node web service, create a Static Site for this build or adjust its service type/settings. This package has not been deployed to your Render account from this environment.

## Audius API

The app targets `https://api.audius.co/v1` and falls back to `https://discoveryprovider.audius.co/v1` if the first endpoint fails. Free API plan and credentials are documented at:

- https://docs.audius.co/
- https://docs.audius.co/api/
- https://api.audius.co/plans

