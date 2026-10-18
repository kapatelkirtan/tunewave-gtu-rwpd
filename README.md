# TuneWave — PWA install fix

This archive is **root-ready**: `index.html`, `manifest.webmanifest`, `service-worker.js`, `assets/`, `robots.txt`, and `sitemap.xml` are directly at the archive root. Do not deploy this archive with an extra enclosing folder.

## Android APK with lock-screen playback

A native Android app project now lives in `android/`. It loads the same TuneWave site and routes direct HTTPS audio streams from the connected catalogues through Android Media3's background playback service, which provides Android media notification/lock-screen controls.

- [Download the latest TuneWave APK release](https://github.com/kapatelkirtan/tunewave-gtu-rwpd/releases/latest)
- [Android project and build notes](android/README.md)
- GitHub Actions builds a debug-signed test APK when the Android project or website bridge changes.

Pasted YouTube / YouTube Music links continue to use YouTube's official embedded player. Their background playback is controlled by YouTube and is not guaranteed by this app; TuneWave does not extract or re-host YouTube audio.

## Deploy to the existing Render Static Site

1. Extract all files from this ZIP.
2. Put the extracted files directly in the **root of the GitHub repository** (so `index.html` is at the repository root). Commit and push.
3. In Render, use the existing repository and set the Static Site **Publish Directory** to `.` if the files are in the repository root. No build command is needed for this plain static site.
4. After deployment, confirm these URLs load successfully: `/`, `/manifest.webmanifest`, `/service-worker.js`, `/assets/icon-192.png`, and `/assets/icon-512.png`.
5. Open the published site in the device's regular browser, not inside a social/chat app's embedded browser.

## How the Download App button behaves

- The top-right Download App button downloads the native Android APK from the latest GitHub release: [Download TuneWave APK](https://github.com/kapatelkirtan/tunewave-gtu-rwpd/releases/latest/download/app-debug.apk).
- On Android, open the downloaded APK and tap **Install**. If prompted, allow your browser to install unknown apps for this download.
- To install the website itself as a PWA instead, use the browser menu and choose **Install app** or **Add to Home screen**.
- The site must be served from HTTPS (Render provides HTTPS) and the manifest, icon URLs, and service worker must all be accessible from the deployed site's root.

## Important limitations

A PWA install is not an APK download. A website cannot automatically install to every operating system without a confirmation. Background playback and lock-screen controls depend on each browser/OS and the provider's stream. This does not guarantee background playback on every device.

The existing music player and “Made By Kirtan Ka.patel” footer are retained. The service worker caches the site shell only, not music tracks.


## Music sources and Free To Use

TuneWave uses public/free audio sources. Funkwhale / Open Audio is a searchable independent catalogue; it is separate from commercial streaming services and depends on anonymous access being enabled by the instance.

- Audius: direct streaming for publicly playable tracks.
- Free To Use: direct playback for eligible tracks under its licence.
- Jamendo: official API through the server-side bridge.
- Internet Archive, Wikimedia Commons, ccMixter and Openverse: results depend on rights metadata and source availability.
- Radio Browser: live radio stations rather than a searchable catalogue of individual songs.
- Funkwhale / Open Audio: a searchable catalogue of public playable uploads, with direct stream URLs when the hosting instance allows anonymous reads. Track catalogues and rights vary by upload; it is not guaranteed to have every commercial Bollywood, Hindi, Gujarati or Ultra Funk track.


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


## Automatic song search and official in-page players

- Typing at least two characters in TuneWave's main search box automatically searches its connected playable catalogues after a short pause. Pressing Enter or the Search button still works.
- Results from connected audio catalogues are played in TuneWave's built-in audio player and can use TuneWave's queue and browser Media Session controls when the source supplies a direct playable stream.
- Audiomack, HearThis.at and Bandcamp are handled using their official provider-hosted embedded players. The query-aware links update as a listener types; these providers do not expose a common public search API that TuneWave can call without provider credentials/permissions. To play their selected track on the TuneWave page, search the provider, then paste the track URL or official embed code into the player form.
- Audiomack and HearThis.at standard share URLs are converted to official embed paths where the URL format supports it. For Bandcamp, paste the iframe code copied from the track/album's Share / Embed action; its official player requires the track/album ID.
- Embedded players remain controlled by their provider, including advertisements, access restrictions, full-track availability and lock-screen support. An embedded track is not added to TuneWave's HTML-audio queue or guaranteed to expose TuneWave's lock-screen controls.
- Rapid typing won't let a slow response for an older query overwrite the results for the latest query.


## Music-provider bridge deployment

The browser app uses the separate Render Web Service configured in `config.js` as the music-provider bridge. This server implements the bridge health contract at `/health` and the provider routes consumed by the frontend.

- **Audius** and **Free To Use** use their public read/search APIs.
- **Jamendo** requires `JAMENDO_CLIENT_ID` as a secret environment variable on the bridge service. Never put it in `config.js` or browser JavaScript.
- **Internet Archive**, **ccMixter**, **Funkwhale / Open Audio**, and **Radio Browser** use their public catalogue endpoints and return HTTPS streams where available.
- **Openverse** uses anonymous search by default; optional `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` environment variables enable OAuth if needed.

In Render, the bridge service must use this repository, root directory `.`, Node runtime, and start command `npm start`. Keep the Static Site service separate and serving the repository root. The configured bridge health URL is `https://tunewave-gtu-rwpd-2.onrender.com/health`.

The source-status panel confirms endpoint responses; it cannot guarantee every song exists or that every stream will play. Jamendo will show as needing setup until `JAMENDO_CLIENT_ID` is set in the bridge service environment.


## Additional official music destinations and embedded players

The web UI keeps the nine open-catalogue endpoints separate from official destinations. The destination list includes YouTube Music, JioSaavn, Spotify, Amazon Music, Gaana, Apple Music, SoundCloud, Audiomack, HearThis.at, Bandcamp, Free Music Archive, Hungama and Saregama. Those are official search destinations; they are not represented as 13 direct-track APIs.

The in-page official-player form supports YouTube, Spotify, Apple Music, SoundCloud and Deezer share links, plus official provider iframe codes for Audiomack, HearThis.at and Bandcamp. Embedded providers continue to control playback, advertising, log-in, subscription, region and background playback. Open-catalogue search expands up to three targeted variants for Audius and Free To Use and up to two for Internet Archive to improve Ultra Funk/phonk, Hindi and Gujarati/Garba discovery.

## YouTube in-page search setup

To search YouTube and load an embeddable video into TuneWave's official player section, enable YouTube Data API v3 in a Google Cloud project and configure \`YOUTUBE_API_KEY\` on the server-side Render music bridge. Keep the key server-side, restrict it to YouTube Data API v3, and monitor quota. Users can still paste YouTube share links into the official player without enabling search-by-query.
