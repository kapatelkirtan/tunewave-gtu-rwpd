# TuneWave + Jamendo setup

TuneWave searches Audius directly and searches Jamendo through the separate `jamendo-bridge` Render service.

## Configure Jamendo

1. Create or open your application at the [Jamendo developer portal](https://devportal.jamendo.com/).
2. Copy the application's client ID.
3. In [Render](https://dashboard.render.com/), open the Jamendo bridge service and go to **Environment**.
4. Set `JAMENDO_CLIENT_ID` to your Jamendo client ID.
5. Confirm the main website's `config.js` points to your deployed bridge, currently:
   `https://tunewave-gtu-rwpd-2.onrender.com`
6. Redeploy the bridge if you changed its environment variables.
7. Test the bridge's `/health` endpoint, then search for terms such as `electronic`, `jazz`, `indie`, or `chill`.

## Licensing notes

- TuneWave uses Jamendo's `audio` stream URL, not a short iTunes preview.
- Jamendo tracks use different licences. Keep attribution and follow each track's licence.
- Jamendo's API terms distinguish non-commercial from commercial use. If you monetize the site or add advertising, review the current terms and obtain any required permission before launch.
- Do not use a download URL as a substitute for a permitted stream.

Official docs: https://developer.jamendo.com/v3.0/tracks
API terms: https://devportal.jamendo.com/api_terms_of_use
