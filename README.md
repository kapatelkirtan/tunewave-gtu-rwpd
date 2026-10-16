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
