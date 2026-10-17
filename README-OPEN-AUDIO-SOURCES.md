# TuneWave: Audius + Jamendo + Internet Archive

TuneWave searches Audius and Jamendo, plus Internet Archive audio items that identify a Creative Commons or public-domain rights statement. The Archive integration uses the existing server-side bridge; no new API key is needed.

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
