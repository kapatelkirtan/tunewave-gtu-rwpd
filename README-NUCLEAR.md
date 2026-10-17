# TuneWave and Nuclear

TuneWave supports in-browser music search and playback through Audius and Jamendo. Nuclear is shown as a desktop companion, not as a third web music-provider API.

## Why Nuclear cannot be added as a hosted catalog provider

Nuclear is a desktop-only music player for Windows, macOS, and Linux. Its plugins provide sources and metadata to Nuclear itself. Its HTTP API / Nuclear Jam features are local or LAN remote-control APIs (for example, play/pause, next track, queue state, and playback state); they are not a public search-and-stream API that a hosted website can call to retrieve Nuclear's whole plugin catalog and play the resulting audio in every visitor's browser.

The public TuneWave website on Render cannot access music sources configured inside a visitor's private Nuclear installation. Do not expose Nuclear's local control API directly to the internet.

## Use Nuclear alongside TuneWave

- Download Nuclear from https://nuclearplayer.com/
- Use TuneWave for tracks that Audius and Jamendo permit the website to stream.
- Use Nuclear's own search/plugins in the desktop app when you want sources that are available there.
- A future optional local companion could control a Nuclear instance on your own computer/network, but it would be a separate local-control feature and would not turn Nuclear into a hosted web catalogue.

Official Nuclear project: https://github.com/nukeop/nuclear
Nuclear HTTP API documentation: https://github.com/nukeop/nuclear/blob/master/packages/docs/integrations/http-api.md
Nuclear MCP server documentation: https://github.com/nukeop/nuclear/blob/master/packages/docs/integrations/mcp-server.md
