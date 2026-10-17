# TuneWave open-audio providers

TuneWave combines Audius, Jamendo, Internet Archive, Wikimedia Commons, ccMixter, rights-filtered Library of Congress audio, Radio Browser live music stations, and Audiomack through its official API connector. Openverse uses anonymous API access by default.

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

## Optional Openverse credentials

Basic Openverse search now works anonymously, so you do not need to register just to test it. Open https://api.openverse.org/v1/audio/?q=jazz in a browser to check whether the API is reachable from your network. If you later want credentials / higher request limits, use the registration endpoint described at https://api.openverse.org/v1/ and add `OPENVERSE_CLIENT_ID` and `OPENVERSE_CLIENT_SECRET` to the Render bridge service environment. Keep the secret out of client-side files. Check the bridge `/health` response; `openverseEnabled` indicates that the anonymous-capable connector is installed and `openverseAuthEnabled` indicates that credentials are configured.

## Rights, formats, and realistic limits

These connectors broaden search but do not guarantee every result plays in every browser. Some historical audio has restrictions, some direct URLs can expire or disappear, and browser codec support varies. Check the specific source/track licence, attribution requirements, and intended-use terms before reuse.

A list of 20 music websites is not equivalent to 20 usable streaming APIs. Free Music Archive explicitly states its API is shut down and hotlinking its hosted music is not allowed without permission, so it was deliberately not wired as a direct stream provider. Services such as Spotify, Apple Music, YouTube, SoundCloud, and Bandcamp require their own playback/embed flows, user subscriptions, API credentials, or approval; they must not be scraped or bypassed to extract audio.


- **Radio Browser**: searches its public station directory and adds direct HTTPS streams for live music stations. These are station streams rather than individual indexed songs; the station operator controls the playlist, ads, stream availability, and rights.


## Official Audiomack provider: Ultra Funk and phonk

Audiomack is a first-class TuneWave provider with search and in-page playback via the official API. The frontend searches for track metadata through the server-side bridge, and the bridge resolves a fresh stream URL only when a listener presses Play; Audiomack stream URLs are short-lived. The connector uses Audiomack's documented API endpoints and OAuth 1.0a consumer signing rather than scraping their website.

### Activate the official Audiomack connection

1. Open the official [Audiomack API documentation](https://audiomack.com/data-api/docs) and follow its API access / consumer-credential process. You need a valid **consumer key** and **consumer secret**. Audiomack may require its approval to issue credentials; the code cannot bypass that.
2. In Render, open the `tunewave-jamendo-bridge` service and go to **Environment**.
3. Add these environment variables:
   - `AUDIOMACK_CONSUMER_KEY`
   - `AUDIOMACK_CONSUMER_SECRET`
4. Save and redeploy the bridge.
5. Open `/health` on the bridge and check `"audiomackEnabled":true`. Until the official credentials are approved and configured, the Audiomack provider is listed in TuneWave but will show `SETUP` and cannot return API search results. Then open TuneWave and search `ultrafunk`, `ultra funk`, or `Brazilian phonk`.

Keep both values server-side. Never add them to `app.js`, `config.js`, or public GitHub content.

Audiomack offers free embeddable players for creator uploads and its API includes search and track-play endpoints. That does not mean every track can be used unrestrictedly: the catalog, ads, access, API availability, and track rights remain controlled by Audiomack and individual rights holders. See [Audiomack Creator information](https://creators.audiomack.com/about) and [API documentation](https://audiomack.com/data-api/docs).


## Removed catalogue-only providers

Deezer preview search and MusicBrainz metadata search have been removed from TuneWave. Deezer's public search integration returned short preview clips, while MusicBrainz does not host audio. TuneWave keeps its existing free/open catalogue providers, but their available music and playback rights vary by track; they cannot guarantee every commercial Bollywood, Gujarati, Hindi, or Ultra Funk release.
