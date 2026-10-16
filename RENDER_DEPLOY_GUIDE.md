# Publish TuneWave on Render

This project is a static HTML/CSS/JavaScript website. It can be hosted as a Render Static Site; no server or build step is required.

## Before you start
- A GitHub account
- A Render account
- The contents of this project folder

## 1. Create a GitHub repository
1. Sign in to GitHub and create a new repository, for example `tunewave-gtu-rwpd`.
2. Keep it public if you want the simplest free deployment flow. Do not upload passwords, API secrets, or private data.
3. Upload the *contents* of this project folder to the repository root. `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `service-worker.js`, and the icons should be at the root (not hidden inside another nested folder).
4. Commit the files to the `main` branch.

## 2. Deploy on Render
1. Sign in at https://dashboard.render.com/.
2. Choose **New + → Static Site**.
3. Connect GitHub and choose the `tunewave-gtu-rwpd` repository.
4. Use these settings:
   - **Name:** `tunewave-gtu-rwpd` (or another available name)
   - **Branch:** `main`
   - **Root Directory:** leave blank when the project files are in the repository root
   - **Build Command:** `echo "No build step required"`
   - **Publish Directory:** `.`
5. Click **Create Static Site** and wait for the deploy to finish.
6. Open the `onrender.com` URL shown in the Render dashboard.

This project also includes `render.yaml` for a Blueprint-style setup. If using the dashboard, enter the settings above directly.

## 3. Test the live website
- Open the live URL on both desktop and Android.
- Test search and the **Open in NewPipe** handoff on Android with NewPipe installed.
- Confirm icons, manifest, and service worker load from HTTPS.
- If you change code later, commit and push to GitHub; Render can automatically redeploy from the linked branch.

## Important limitations
- A Render URL makes the website publicly accessible; it does not make TuneWave an official website of YouTube, NewPipe, or any music service.
- The NewPipe integration is a link handoff. Playback happens in NewPipe on compatible Android devices, not inside this webpage.
- Background playback depends on NewPipe, Android, and device settings.
- A free Render Static Site is suitable for this frontend, but your usage is still subject to Render's current plan and service limits.
- The default `onrender.com` URL is a hosted subdomain, not a custom domain you own. A custom domain can be configured in Render if you own one.
