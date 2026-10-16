
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({ app: "TuneWave", status: "ok" });
});

app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({
      error: "Enter a song or artist using ?q="
    });
  }

  if (q.length > 200) {
    return res.status(400).json({
      error: "Search query must be 200 characters or fewer."
    });
  }

  try {
    const params = new URLSearchParams({
      term: q,
      media: "music",
      entity: "song",
      country: "IN",
      limit: "25"
    });

    const response = await fetch(
      `https://itunes.apple.com/search?${params}`
    );

    if (!response.ok) {
      return res.status(502).json({
        error: "Music catalog is temporarily unavailable."
      });
    }

    const data = await response.json();

    const results = (data.results || []).map(song => ({
      id: song.trackId,
      title: song.trackName,
      artist: song.artistName,
      album: song.collectionName,
      artwork: song.artworkUrl100,
      previewUrl: song.previewUrl || null,
      listenUrl: song.trackViewUrl || null,
      durationMs: song.trackTimeMillis || null
    }));

    res.json({
      query: q,
      total: results.length,
      results
    });
  } catch (error) {
    console.error("Music search failed:", error.message);

    res.status(502).json({
      error: "Could not connect to the music catalog. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TuneWave server running on port ${PORT}`);
});
