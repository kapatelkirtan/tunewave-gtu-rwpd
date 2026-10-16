# TuneWave — GTU RWPD 2026 Topic #22: Music Player

**Website:** TuneWave — Your Sound Universe  
**Connected app:** NewPipe (Android)  
**Integration type:** Android intent/link bridge, not an embedded music player  
**Technology:** HTML5, CSS3, vanilla JavaScript, Web App Manifest, Service Worker  
**Student footer:** Made By Kirtan Ka.patel

## What is connected?
TuneWave sends a YouTube search URL to the **NewPipe Android app** using an Android `intent://` URI. If Android and NewPipe are installed and the URL is accepted, NewPipe opens the search and handles playback. NewPipe's project describes it as a free/open-source Android front end for YouTube with background audio playback: https://newpipe.net/ and https://github.com/TeamNewPipe/NewPipe.

This is a link handoff only. NewPipe does not provide a conventional public embeddable web player, so the songs do **not** play inside the TuneWave webpage and the website cannot control NewPipe's player. The code does not download, extract, host or strip audio from YouTube.

## Run the website
1. Extract this ZIP.
2. Open the folder in Visual Studio Code.
3. Run the website through VS Code Live Server, or deploy to HTTPS. The PWA/service worker works only on localhost or HTTPS in normal browsers.
4. Enter a song/artist/genre or tap a quick-search chip.
5. On Android, choose **Open in NewPipe**. NewPipe must be installed separately. If the intent doesn't open, try **Open YouTube** or use the installation guide link.
6. On PC, Mac, iPhone or iPad, choose **Open YouTube**. NewPipe is Android-only.

## Free / ads / membership
- TuneWave's own interface has no ad placements, no paid tier, and no membership.
- NewPipe is free/open-source and its project advertises background playback and an ad-free experience. It is a third-party project, not an official YouTube client.
- YouTube searches are broad, but no app can guarantee that every video is available; deleted, restricted, age-gated, region-limited, or otherwise unavailable items may not play.
- The browser fallback uses regular YouTube. Ads and normal YouTube background-play restrictions can apply there. TuneWave does not block or alter YouTube ads.

## Background / lock screen
On Android, TuneWave hands the search to NewPipe; NewPipe then manages its own audio playback and system media controls. The website itself is **not** the player, so lock-screen playback depends on NewPipe and the Android device. On PC/iOS browser fallback, ad-free background playback is not guaranteed.

## Important compatibility note
NewPipe consumes YouTube pages/internal interfaces because the official YouTube API does not expose a free unrestricted full-song audio stream. These interfaces can change; NewPipe may temporarily stop working until updated. Do not confuse this bridge with an official or endorsed integration. For exact policy details, see YouTube's developer policies: https://developers.google.com/youtube/terms/developer-policies.

## Features
- Premium-looking responsive TuneWave interface.
- Query search and music-mood shortcuts.
- NewPipe Android launch handoff.
- YouTube browser fallback on all platforms.
- Recent searches saved in localStorage on the current device.
- No API key or TuneWave account needed.
- Installable PWA shell on supported browsers.
- Official NewPipe install-guide link.
- Beginner-friendly comments in JavaScript.

## Files
- `index.html` — page structure, search form, app-connection note and actions.
- `style.css` — premium responsive visual theme, bridge cards, recent searches and layouts.
- `app.js` — search URL creation, Android intent launch, YouTube fallback and local recent history.
- `manifest.webmanifest` — installable PWA metadata.
- `service-worker.js` — caches the website shell only, not music.
- `icon.svg`, `icon-192.png`, `icon-512.png` — TuneWave icon files.
- `GTU_RWPD_Topic22_Presentation.pptx` — updated seminar presentation.
- `GTU_RWPD_Topic22_Explanation.md` — code explanation and viva notes.

## Testing checklist
- [ ] Start from localhost or HTTPS.
- [ ] Type an artist or use a quick chip; see the two action cards.
- [ ] On Android with NewPipe installed, tap **Open in NewPipe** and confirm the search opens.
- [ ] Tap **Open YouTube** and confirm the browser search opens.
- [ ] Confirm recent searches persist after refresh and can be cleared.
- [ ] In NewPipe on Android, start playback and test lock-screen/background controls.
- [ ] Test browser fallback on PC and iOS; remember those platforms do not inherit NewPipe's features.
- [ ] Check the layout at phone, tablet and desktop widths.
- [ ] Install the PWA from browser menu when offered.

## Troubleshooting
- **NewPipe does not open:** Check NewPipe is installed from a trusted source; Android may not recognize the link or package handoff on every browser. Use the official installation guide and/or tap Open YouTube.
- **YouTube opens instead:** Android app-link handling may choose the browser; use the NewPipe app's open/share workflow or set compatible link handling if available.
- **Song unavailable:** It can be removed, restricted or temporarily unsupported by the source.
- **Background stops:** This is controlled by NewPipe/Android battery settings, not the TuneWave webpage.
- **Install button missing:** Installation prompts vary by browser; use its menu to add the site to your home screen.

**Verification note:** The package's static code can be syntax-checked locally, but launching NewPipe requires a real Android device with the app installed. That app handoff was not live-tested in this build environment.
