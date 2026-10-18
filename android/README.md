# TuneWave Android APK

This Android app opens the existing TuneWave website and exposes a small, first-party JavaScript bridge to a native AndroidX Media3 playback service.

## What this build supports

- The current TuneWave site, its connected open/direct-audio music providers, search, favourites, and pasted official-player links.
- Direct HTTPS audio streams returned by supported catalogue providers are delegated to Android Media3. The app now reports actual playback state and shows native player errors in the UI, helping identify a bad stream instead of displaying a false 'playing' state.
- Track title, artist and artwork are sent to Android System UI where available.
- The APK build is debug-signed for sideloading and testing.

## YouTube and other official embeds

Pasted YouTube/YouTube Music URLs continue to use the official embedded player in the TuneWave page. The app does not extract or re-host YouTube audio and cannot override YouTube's account, subscription, advertising, regional or background-playback rules. Therefore, background playback is not guaranteed for an embedded YouTube video. Direct catalogue streams use the native playback service instead.

## Build

From the repository root with JDK 17, Android SDK platform 36 and Gradle 8.11.1 available:

```sh
gradle -p android assembleDebug
```

APK output: `android/app/build/outputs/apk/debug/app-debug.apk`.

The GitHub Actions workflow builds and uploads the APK as a workflow artifact and a repository release asset when changes are pushed. Debug builds use the application id `com.kapatelkirtan.tunewave.debug`.
