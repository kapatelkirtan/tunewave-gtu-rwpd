# TuneWave + Jamendo full-track catalog

## Setup
1. Create a developer app at https://developer.jamendo.com/ and copy its `client_id`.
2. Open `app.js` and replace `PASTE_YOUR_JAMENDO_CLIENT_ID_HERE` with your client ID.
3. Commit and push the updated files, then let Render redeploy.
4. Test searches such as `electronic`, `jazz`, `indie`, or `chill`.

## Important licensing notes
- This integration streams the `audio` URL returned by Jamendo; it does not use iTunes 30-second previews. Actual track length depends on the source track.
- Jamendo content is released under different licenses. The UI should credit artists and respect each track's license and attribution requirements.
- Jamendo's API terms distinguish non-commercial use from commercial use. If you add ads, monetize the site, or use it for a commercial purpose, check the current API terms and contact Jamendo for permission before launch.
- Do not use the API's download URL as a substitute for streaming. This app uses the stream URL only.
- The client ID is intended for API identification, not as a secret credential. Do not add private credentials to front-end code.

Docs: https://developer.jamendo.com/v3.0/tracks
API terms: https://devportal.jamendo.com/api_terms_of_use
