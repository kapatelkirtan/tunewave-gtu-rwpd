# TuneWave open-audio providers

TuneWave combines Audius, Jamendo, Internet Archive, Wikimedia Commons, ccMixter, rights-filtered Library of Congress audio, and Radio Browser live music stations. Openverse support is included but remains disabled until you add its API client credentials to the Render bridge service.

## Deployment

The existing Render service uses the repository's `jamendo-bridge` directory. Pushing these changes to `main` should trigger its automatic deploy. The static website should also redeploy from the repository.

After deployment, test:

- `https://tunewave-gtu-rwpd-2.onrender.com/health` — should include `"internetArchiveEnabled":true`.
- `https://tunewave-gtu-rwpd-2.onrender.com/api/archive/search?q=public%20domain%20music` — should return a JSON `results` array (results depend on Archive metadata and availability).

## Rights and catalog notes

- Internet Archive is useful for public-domain recordings, live recordings, historical audio, and openly licensed items. It is not a replacement catalogue for current commercial chart music.
- Search results are filtered to records whose metadata identifies a Creative Commons URL or a public-domain/Creative Commons rights statement. Metadata can be inaccurate; check the original item rights page before reuse.
- Audio files are streamed from the original Internet Archive item. Playback availability and supported formats vary by item.
- Audius and Jamendo remain connected as before. Jamendo credentials remain in Render environment variables.


## Wikimedia Commons integration

TuneWave also searches Wikimedia Commons through its public MediaWiki API. Results are limited to audio files with metadata indicating Creative Commons, public-domain, or another free licence, and the player uses the file URL supplied by Commons. Browser support varies by audio format (especially Ogg/Opus), so some results may not play in every browser. Open the Commons file page and confirm attribution/licence terms before reuse. No API key is required.


## Additional providers added

- **ccMixter**: uses the public ccMixter Query API RSS response and only returns entries where an audio enclosure and a source page are present. Results include a licence link when the feed provides one. Feed structure/availability can change.
- **Library of Congress**: searches its public JSON audio endpoint. The connector only returns a playable file when it finds direct audio resources and metadata explicitly indicates public domain, Creative Commons, or no known restrictions. Coverage is primarily historical and archival.
- **Openverse**: audio search is integrated behind a server-side OAuth client-credentials flow. It is intentionally disabled by default until the two Render environment variables below are set.

## Enable Openverse on Render

1. Register an application / API credentials with Openverse using its official API documentation: https://api.openverse.org/v1/
2. In the Render dashboard, open the `tunewave-jamendo-bridge` service and add:
   - `OPENVERSE_CLIENT_ID`
   - `OPENVERSE_CLIENT_SECRET`
3. Save the changes and redeploy the bridge. Do not put the client secret in `app.js`, `config.js`, or any other browser-visible file.
4. Check `/health` for `"openverseEnabled":true`, then search a term in TuneWave.

Openverse API documentation: https://api.openverse.org/v1/ . Credentials are required for the connector as implemented here.

## Rights, formats, and realistic limits

These connectors broaden search but do not guarantee every result plays in every browser. Some historical audio has restrictions, some direct URLs can expire or disappear, and browser codec support varies. Check the specific source/track licence, attribution requirements, and intended-use terms before reuse.

A list of 20 music websites is not equivalent to 20 usable streaming APIs. Free Music Archive explicitly states its API is shut down and hotlinking its hosted music is not allowed without permission, so it was deliberately not wired as a direct stream provider. Services such as Spotify, Apple Music, YouTube, SoundCloud, and Bandcamp require their own playback/embed flows, user subscriptions, API credentials, or approval; they must not be scraped or bypassed to extract audio.


- **Radio Browser**: searches its public station directory and adds direct HTTPS streams for live music stations. These are station streams rather than individual indexed songs; the station operator controls the playlist, ads, stream availability, and rights.
