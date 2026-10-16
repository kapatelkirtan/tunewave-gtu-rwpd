# TuneWave NewPipe Bridge — GTU RWPD Code Explanation / Viva Notes

## Project idea
TuneWave is a responsive search interface. It sends a YouTube search URL to NewPipe on Android, or opens ordinary YouTube in a browser on other devices. NewPipe is the component that actually plays audio. TuneWave does not host audio or provide a streaming API.

## The connected app: NewPipe
NewPipe is a free/open-source Android front end for YouTube and other services. Its project lists background audio playback among its features. Official links:
- Home: https://newpipe.net/
- Source code: https://github.com/TeamNewPipe/NewPipe
- Install guide: https://newpipe.net/FAQ/tutorials/install-add-fdroid-repo/

NewPipe is not an official Google/YouTube app and is not embedded inside this site. The integration is a deep-link bridge. Browser and device behavior can differ.

## File explanation

### `index.html`
- Defines the responsive document and metadata.
- Presents the search form and genre/mood shortcut buttons.
- Explains that NewPipe handles external playback.
- Includes a browser fallback and the official app install-guide link.
- Loads `style.css` and `app.js`.

### `style.css`
- Defines the dark futuristic premium design and cyan/purple accents.
- Uses CSS Grid/Flexbox for layouts.
- Uses responsive media queries to change the layout on small screens.
- Styles the bridge cards, recent-search rows, and installation prompts.

### `app.js`
- Detects Android with `navigator.userAgent`.
- Uses `URL` and `URLSearchParams` to create safe YouTube search URLs.
- Builds an Android intent URI that targets package `org.schabi.newpipe`.
- Navigates to the intent only when the user presses the button; Android decides whether the app can open.
- Opens YouTube in a new tab for the browser fallback.
- Uses `localStorage` to save up to eight recent search terms on the current device.
- Registers the service worker only on localhost/HTTPS.
- Uses text nodes / `textContent` for query display rather than injecting raw HTML.

### `manifest.webmanifest`
Provides the name, theme color, icon paths, start URL and standalone display mode for supported PWA installations.

### `service-worker.js`
Caches only the website shell and assets. It does not intercept or cache YouTube/NewPipe streaming audio.

## Core JavaScript concept: URL encoding
A search query must be encoded before putting it inside a URL. The app calls `encodeURIComponent(query)` so spaces and special symbols do not break the Android intent URL.

## Core JavaScript concept: Android intent URI
The bridge creates a link with the form:

`intent://www.youtube.com/results?search_query=QUERY#Intent;scheme=https;package=org.schabi.newpipe;end`

This asks compatible Android browsers to open the matching HTTPS YouTube URL in the NewPipe package. It depends on Android and NewPipe; a webpage cannot install the app or force the OS to launch it.

## Core JavaScript concept: localStorage
Recent search terms are serialized to JSON and stored in browser storage. This is local to that browser profile/device and is not an online account or cross-device sync.

## Important limitations to say in the presentation
1. NewPipe is Android-only; PC/iOS use YouTube's normal browser experience.
2. Playback is handed to a separate app; TuneWave is not an embedded player.
3. No website can promise that every video will play, because access can be restricted, removed or changed.
4. Background playback on Android is provided by NewPipe, not forced by this website.
5. NewPipe is an independent project and can be affected by changes to YouTube interfaces.

## Viva questions and answers
**Q: Which application is connected?**  
A: NewPipe for Android, using an Android intent/deep link to pass a YouTube search URL.

**Q: Why does TuneWave not use an audio API?**  
A: This design delegates playback to the installed app rather than attempting to extract or host third-party music streams.

**Q: What does JavaScript do?**  
A: It reads the search term, encodes the URL, detects Android, launches the intent, opens the browser fallback, and saves recent searches.

**Q: Does the website itself play music with the screen locked?**  
A: No. On Android it hands the query to NewPipe, and NewPipe handles playback/media controls. The website cannot force browser background playback.

**Q: Why use localStorage?**  
A: To keep a short recent-search list without an account or backend server.

**Q: What technologies are used?**  
A: HTML5, CSS3, JavaScript, localStorage, Web App Manifest, Service Worker, and Android intent URLs.
