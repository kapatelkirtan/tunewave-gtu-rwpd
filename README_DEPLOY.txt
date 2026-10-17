TUNEWAVE — AUDIUS + JAMENDO WEB PROVIDER SETUP

WHAT THIS BUILD DOES
- Searches the official Audius REST API and combines those results with Jamendo results in one TuneWave list.
- Uses Audius' official track stream endpoint for Audius items.
- Uses Jamendo's official tracks API for Jamendo items, then plays the returned Jamendo stream URL inside TuneWave's HTML audio player.
- Shows each result's provider. Jamendo items have a separate link to the track-specific licence (or track page if a licence URL is not returned).
- Includes a small server-side Jamendo bridge. The Jamendo client ID is stored in a Render environment variable; it is not placed in browser-visible config.js.
- Keeps the existing player, queue, favorites, search, PWA, voice search, song-identification UI, and lock-screen metadata features.
- Removes the community Piped/YouTube source from new searches. Existing saved Piped items from older site versions may no longer be playable; search again for the item from Audius or Jamendo.

IMPORTANT ABOUT NUCLEAR
Nuclear is a desktop application with its own plugin API. It does not offer a public hosted music catalogue and browser-stream API that can simply serve every TuneWave visitor. It is therefore not wired as a TuneWave web provider. Do not expose a local Nuclear API/MCP port to the public internet. Audius + Jamendo is the supported architecture for this build.

JAMENDO LICENSING
Jamendo requires a developer client_id. Its API terms state that API use is free for non-commercial use; use that is commercial, monetized, or ad-supported requires contacting Jamendo for applicable terms. Track licences vary, so open the licence link for each Jamendo result and comply with its licence. Jamendo contains primarily independent/licensed catalog material, not a guarantee of mainstream commercial hits.

SOURCE REFERENCES
Audius API: https://docs.audius.co/api/
Jamendo tracks API: https://developer.jamendo.com/v3.0/tracks
Jamendo developer registration/authentication: https://developer.jamendo.com/v3.0/authentication
Jamendo API terms: https://devportal.jamendo.com/api_terms_of_use
Nuclear docs: https://docs.nuclearplayer.com/nuclear

DEPLOYMENT HAS TWO PARTS
Part A — Update the existing TuneWave static site
1. Extract this ZIP locally.
2. Upload/replace these root frontend files in your TuneWave GitHub repo:
   - index.html
   - style.css
   - app.js
   - config.js
   - service-worker.js
3. Keep manifest.webmanifest, the icon files, and tunewave-logo-full.png from the package/repo at the root as-is. You may upload the ZIP's copies if you prefer.
4. Upload the entire new `jamendo-bridge/` folder into the repository root, including `server.js` and `package.json`.
5. Keep the existing `backend/` folder, database, and other unrelated files unchanged.
6. Commit the changes. The existing Render static site should deploy the frontend changes.

Part B — Deploy the Jamendo bridge as a separate Render Web Service
1. Create a Jamendo developer account at https://devportal.jamendo.com/ and create an application. Copy its client_id.
   - Do not use the documentation's demo/test client_id in production.
2. In Render, choose New + > Web Service and connect the same GitHub repository containing this folder.
3. Set Root Directory to `jamendo-bridge`.
4. Set Environment to Node.
5. Build Command: `npm install`
6. Start Command: `npm start`
7. Add environment variables:
   - `JAMENDO_CLIENT_ID` = the client_id from your Jamendo developer application
   - `ALLOWED_ORIGINS` = `https://tunewave-gtu-rwpd-1.onrender.com`
     If your real website URL differs, use its exact origin (scheme + host only, no trailing slash). You can include multiple origins separated by commas.
   - `RATE_LIMIT_PER_MINUTE` = `45` (optional)
8. Deploy the service and copy its public URL, such as `https://tunewave-jamendo-bridge.onrender.com`.
9. In the site's root `config.js`, replace the empty `window.TUNEWAVE_JAMENDO_API_BASE = '';` with the new bridge URL, for example:
   `window.TUNEWAVE_JAMENDO_API_BASE = 'https://tunewave-jamendo-bridge.onrender.com';`
   This URL is public. Keep `JAMENDO_CLIENT_ID` only in Render environment variables, never in `config.js`.
10. Commit the `config.js` change and wait for the static site deploy.

TEST THE SETUP
1. Open `https://YOUR-JAMENDO-BRIDGE.onrender.com/health`.
   Expected JSON includes `"ok":true`, `"provider":"Jamendo"`, and `"configured":true`. It must not show the client_id.
2. Open TuneWave and hard refresh (on Chrome desktop Ctrl+Shift+R; on mobile, reload or use a private tab).
3. The Jamendo card should say READY. If it says OFFLINE, check the bridge service URL. If it says CONFIG, add JAMENDO_CLIENT_ID in Render. If requests are forbidden, correct ALLOWED_ORIGINS to the exact site origin.
4. Search a title that may exist in independent music catalogues, such as `lofi`, `ambient`, `electronic`, `rock instrumental`, or an original artist/title. Jamendo does not necessarily have commercial Bollywood/pop releases.
5. Pick a Jamendo result. Confirm playback, then open its CC licence link to inspect the terms. Try an Audius result too.
6. Verify that playback and lock-screen controls work on your own phone/browser. Background playback depends on browser/device policy.

SECURITY NOTES
- Jamendo client_id stays server-side in Render environment settings.
- CORS defaults to the known TuneWave Render origin; set ALLOWED_ORIGINS if your domain changes.
- The bridge limits query size, returns only whitelisted metadata/stream URLs, has a lightweight per-IP rate limit and a short cache, and does not proxy audio bytes.
- Do not publish a client secret, Jamendo client_id, AudD token, or other credentials in public GitHub files.

WHAT THIS DOES NOT GUARANTEE
- It does not make all commercial songs available. Each provider controls its catalog and playback access.
- Jamendo does not guarantee the mainstream commercial catalog. Its licences vary per track.
- It does not provide universal ad-free playback or guarantee full background/lock-screen playback on every device.
- A Render deploy only proves that deployment completed; test the provider card, search, source attribution, and audio on the live site.
