
const express = require("express");
const app = express();
const path = require("path");

const PORT = process.env.PORT || 10000;

app.use(express.json());

// Serve website files from this repository folder
app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({
    app: "TuneWave",
    status: "ok"
  });
});

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim();

  if (!q) {
    return res.status(400).json({
      error: "Please provide a search query using ?q="
    });
  }

  res.json({
    query: q,
    results: [],
    message: "TuneWave demo API is running."
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`TuneWave server running on port ${PORT}`);
});
