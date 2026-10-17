# TuneWave + SoundCloud setup

TuneWave searches Audius, Jamendo, and eligible public SoundCloud tracks. SoundCloud credentials must stay in Render environment variables, not browser JavaScript or GitHub.

## Configure SoundCloud

1. Register or open your app in the [SoundCloud Developer Portal](https://developers.soundcloud.com/).
2. Copy the app's client ID and client secret.
3. In Render, open the existing bridge service: https://dashboard.render.com/
4. Under **Environment**, add:
   - `SOUNDCLOUD_CLIENT_ID` = your SoundCloud app client ID
   - `SOUNDCLOUD_CLIENT_SECRET` = your SoundCloud app client secret
5. Save changes and redeploy the bridge.
6. Test `/health` on the bridge URL. It should include `"soundcloudConfigured":true`.
7. Search TuneWave again.

The website already points at the bridge URL in `config.js`:
`https://tunewave-gtu-rwpd-2.onrender.com`

## Notes

- The bridge caches OAuth tokens in memory and refreshes them when possible.
- Only public tracks that SoundCloud makes available for streaming are returned. Some tracks may be blocked, region-restricted, or unavailable for custom playback.
- Keep the original SoundCloud track link visible and credit SoundCloud/uploader as required by its current terms.
- Never commit the client secret to the repository or paste it into public issues.
- Official docs: https://developers.soundcloud.com/docs/api/guide
