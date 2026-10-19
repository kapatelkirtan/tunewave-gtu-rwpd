# TuneWave Android mini-player (system PiP)

This optional Android app opens the existing hosted TuneWave site inside a WebView and integrates Android's native Picture-in-Picture mode. It does not replace the static website served from the repository root.

## What it provides

- While direct audio or an official YouTube embed is playing, pressing Home or swiping Home can enter a small Android PiP window.
- The PiP window shows the current title and artist with native previous, play/pause, and next actions.
- Android MediaSession metadata and transport controls are updated for the lock-screen/media panel where supported.
- The existing website remains hosted at `https://tunewave-gtu-rwpd-1.onrender.com/`.

## Build

The GitHub Actions workflow **Build TuneWave Android PiP APK** runs on pushes to the Android project or `app.js`, and can also be started manually from Actions. It uploads the debug APK as artifact `tunewave-pip-debug-apk`.

To build locally, open this `android-pip` folder in Android Studio with JDK 17 and Android SDK 35 installed, or run:

```bash
gradle -p android-pip assembleDebug
```

The APK output path is `android-pip/app/build/outputs/apk/debug/app-debug.apk`.

## Important limits

- The native Android app is required for TuneWave's own system PiP window. A website installed from Edge remains a browser/PWA and cannot force an overlay over other apps.
- Start playback by tapping Play in TuneWave before minimizing. Android/device settings must allow Picture-in-Picture for TuneWave.
- Embedded YouTube remains controlled by YouTube's player, account/access policies, and the device. This wrapper does not bypass background-playback restrictions.
- The debug APK is for testing, not a Play Store release.
