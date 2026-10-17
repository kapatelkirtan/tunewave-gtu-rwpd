# TuneWave — PWA install fix

This archive is **root-ready**: `index.html`, `manifest.webmanifest`, `service-worker.js`, `assets/`, `robots.txt`, and `sitemap.xml` are directly at the archive root. Do not deploy this archive with an extra enclosing folder.

## Deploy to the existing Render Static Site

1. Extract all files from this ZIP.
2. Put the extracted files directly in the **root of the GitHub repository** (so `index.html` is at the repository root). Commit and push.
3. In Render, use the existing repository and set the Static Site **Publish Directory** to `.` if the files are in the repository root. No build command is needed for this plain static site.
4. After deployment, confirm these URLs load successfully: `/`, `/manifest.webmanifest`, `/service-worker.js`, `/assets/icon-192.png`, and `/assets/icon-512.png`.
5. Open the published site in the device's regular browser, not inside a social/chat app's embedded browser.

## How the Download App button behaves

- Chromium browsers show their native install confirmation after the browser fires `beforeinstallprompt`. This build captures that event early and calls its prompt from the button click. The person must still confirm installation.
- If the browser does not expose an install prompt, TuneWave shows the correct fallback instructions. Web pages cannot force-install themselves or silently create a native app.
- On iPhone/iPad, use Safari's Share menu → Add to Home Screen → Add. Apple requires this user action; the website cannot trigger this installation sheet directly.
- The site must be served from HTTPS (Render provides HTTPS) and the manifest, icon URLs, and service worker must all be accessible from the deployed site's root.
- In Chrome, the browser may delay the native prompt until its installability/user-engagement heuristics are met, and it will not prompt if the app is already installed. Open Chrome's menu and choose **Install app** or **Add to Home screen** if the button falls back to instructions.

## Important limitations

A PWA install is not an APK download. A website cannot automatically install to every operating system without a confirmation. Background playback and lock-screen controls depend on each browser/OS and the provider's stream. This does not guarantee background playback on every device.

The existing music player and “Made By Kirtan Ka.patel” footer are retained. The service worker caches the site shell only, not music tracks.


## Music sources and Free To Use

TuneWave searches Free To Use alongside Audius and the other connected audio catalogs. Free To Use's official API requires no account or API key: https://freetouse.com/api. The bridge queries its public search endpoint and uses only results with a valid HTTPS MP3 URL and a non-premium track flag. Searches for Ultra Funk/phonk try related spellings, but the provider may not have every track or remix.

Free listening is not a blanket permission to redistribute or monetize the music. Review the provider's current license and conditions before using tracks outside personal listening: https://freetouse.com/license. Free To Use documents that commercial use may require a paid license.


## Mainstream music search shortcuts

TuneWave keeps its in-player results focused on sources that expose a usable free/open audio catalogue. For popular copyrighted Hindi/Bollywood, Gujarati and trending Ultra Funk tracks, the home search also updates official search links for YouTube Music, JioSaavn, Spotify, Apple Music, Amazon Music India and SoundCloud. These links open the corresponding service's own search/player; they are not presented as TuneWave streaming APIs and do not bypass that service's subscription, advertising or regional restrictions. Availability of free playback depends on each service and track.

Audius searches also expand common Ultra Funk/phonk, Gujarati/garba and Hindi/Bollywood query variants, while Free To Use searches include additional Brazilian funk/phonk aliases. Catalogue matches are not guaranteed for every song or remix.


## Indian-language and Ultra Funk discovery

TuneWave now expands targeted searches across several public/open catalogues. Ultra Funk/phonk searches try Brazilian-funk spellings; Gujarati searches try Garba, Dandiya and Indian folk variants; Hindi/Bollywood searches try Hindi indie, instrumental and Indian folk variants. These fallbacks improve discovery but do not create rights to commercial film recordings. Internet Archive and Openverse results are restricted to items with qualifying open/public-domain licensing metadata; verify the original item's rights page before redistribution or commercial use.

## Free listening and lock-screen limits

TuneWave does not inject its own audio ads into the built-in HTML audio player. This is not a guarantee that every third-party service is ad-free or that every track is available without an account. The built-in player includes Media Session metadata and play/pause/seek/next/previous controls for compatible browsers. Install TuneWave from the browser and start playback with the screen on to give the browser a user gesture; lock-screen/background behavior remains device/browser/provider dependent. TuneWave cannot legally make mainstream copyrighted Bollywood songs simultaneously free, ad-free and background playable without the rightsholder's supported access terms.


## Official YouTube and SoundCloud embedded players

TuneWave now lets a listener paste an HTTPS YouTube/YouTube Music video or playlist URL, or a full SoundCloud track/playlist URL, and load that service's official embedded player on the page. This uses the official embed players rather than extracting or re-hosting audio. It is a playback fallback for tracks that are not present in TuneWave's open catalogues; it is not a direct integration into TuneWave's HTML-audio queue. Searching YouTube/SoundCloud is still done through the official search links, and the selected result URL is then pasted into the embed form.

The embedded platforms control their own advertisements, login/premium checks, geographic availability, and player behavior. TuneWave cannot remove their ads, bypass their terms, or guarantee lock-screen/background playback through embedded players. For direct HTML-audio playback with TuneWave's Media Session controls, use results from its connected catalogues, where available. No one free service reliably provides every Ultra Funk remix and mainstream Hindi/Gujarati/Bollywood recording with all of ad-free, no-premium, and background/lock-screen playback.
