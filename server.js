
const express = require("express");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.static(__dirname));

// Health check
app.get("/api/health", (req, res) => {
  res.json({
    app: "TuneWave",
    status: "ok"
  });
});

// Search Jamendo's music catalog
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q || q.length > 200) {
    return res.status(400).json({
      error: "Enter a search query up to 200 characters long."
    });
  }

  const clientId = process.env.JAMENDO_CLIENT_ID;

  if (!clientId) {
    return res.status(503).json({
      error: "Music search is not configured yet."
    });
  }

  try {
    const params = new URLSearchParams({
      client_id: clientId,
      format: "json",
      limit: "25",
      search: q,
      audioformat: "mp32",
      include: "licenses"
    });

    const response = await fetch(
      `https://api.jamendo.com/v3.0/tracks/?${params}`
    );

    if (!response.ok) {
      console.error("Jamendo returned HTTP status:", response.status);

      return res.status(502).json({
        error: "Music catalog is temporarily unavailable."
      });
    }

    const data = await response.json();

    if (data.headers?.status !== "success") {
      console.error(
        "Jamendo API error:",
        data.headers?.error_message || "Unknown API error"
      );

      return res.status(502).json({
        error: "Jamendo search failed. Check your API configuration."
      });
    }

    const results = (data.results || []).map(track => ({
      id: track.id,
      title: track.name,
      artist: track.artist_name,
      album: track.album_name || "",
      artwork: track.album_image || track.image || "",
      audioUrl: track.audio || null,
      license: track.license_ccurl || null,
      duration: track.duration || 0,
      source: "Jamendo"
    }));

    res.json({
      query: q,
      total: results.length,
      results
    });
  } catch (error) {
    console.error("Jamendo search error:", error.message);

    res.status(502).json({
      error: "Could not connect to the music catalog. Please try again."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TuneWave server running on port ${PORT}`);
});
