
/*
 * TuneWave — in-page music search and playback.
 * Searches the TuneWave backend and plays available Jamendo tracks
 * directly on this website. No YouTube or NewPipe redirects.
 */

const recentSearchesKey = "tunewave-recent-v2";

const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const resultsHeading = document.querySelector("#resultsHeading");
const message = document.querySelector("#message");
const deviceStatus = document.querySelector("#deviceStatus");
const recentSearchesEl = document.querySelector("#recentSearches");
const clearRecentButton = document.querySelector("#clearRecent");
const installButton = document.querySelector("#installButton");
const resultsEl = document.querySelector("#results");

let deferredInstallPrompt = null;
let activeQuery = "";
let tracks = [];
let currentTrackIndex = -1;
let searchRequestId = 0;

const audio = new Audio();
audio.preload = "metadata";

// ---------- Messages ----------

function showMessage(text, isError = false) {
  if (!message) return;

  message.textContent = text;
  message.classList.toggle("error", isError);
}

function setDeviceStatus() {
  if (!deviceStatus) return;

  deviceStatus.textContent =
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      ? "Mobile browser"
      : "Web player";
}

// ---------- Recent searches ----------

function readRecentSearches() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(recentSearchesKey) || "[]"
    );

    return Array.isArray(saved)
      ? saved.filter(item => typeof item === "string").slice(0, 8)
      : [];
  } catch {
    return [];
  }
}

function saveRecentSearch(query) {
  const normalized = query.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalized) return;

  const updated = [
    normalized,
    ...readRecentSearches().filter(
      item => item.toLowerCase() !== normalized.toLowerCase()
    )
  ].slice(0, 8);

  try {
    localStorage.setItem(recentSearchesKey, JSON.stringify(updated));
  } catch {
    // Search still works when local storage is unavailable.
  }

  renderRecentSearches();
}

function renderRecentSearches() {
  if (!recentSearchesEl) return;

  recentSearchesEl.replaceChildren();

  const searches = readRecentSearches();

  if (!searches.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your recent searches will appear here.";
    recentSearchesEl.append(empty);
    return;
  }

  searches.forEach(query => {
    const row = document.createElement("div");
    row.className = "recent-item";

    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-query";
    button.textContent = query;

    button.addEventListener("click", () => {
      if (searchInput) searchInput.value = query;
      searchTracks(query);
      resultsEl?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    row.append(button);
    recentSearchesEl.append(row);
  });
}

// ---------- Player UI ----------

function createPlayer() {
  let player = document.querySelector("#tuneWavePlayer");
  if (player) return player;

  player = document.createElement("section");
  player.id = "tuneWavePlayer";
  player.className = "tunewave-player";
  player.setAttribute("aria-label", "Music player");

  const artwork = document.createElement("img");
  artwork.className = "player-artwork";
  artwork.alt = "Album artwork";
  artwork.hidden = true;

  const details = document.createElement("div");
  details.className = "player-details";

  const title = document.createElement("div");
  title.className = "player-title";
  title.textContent = "Choose a song";

  const artist = document.createElement("div");
  artist.className = "player-artist";
  artist.textContent = "TuneWave";

  details.append(title, artist);

  const controls = document.createElement("div");
  controls.className = "player-controls";

  const previous = document.createElement("button");
  previous.type = "button";
  previous.textContent = "⏮";
  previous.setAttribute("aria-label", "Previous song");
  previous.addEventListener("click", playPrevious);

  const playPause = document.createElement("button");
  playPause.type = "button";
  playPause.textContent = "▶";
  playPause.setAttribute("aria-label", "Play or pause");
  playPause.addEventListener("click", togglePlayback);

  const next = document.createElement("button");
  next.type = "button";
  next.textContent = "⏭";
  next.setAttribute("aria-label", "Next song");
  next.addEventListener("click", playNext);

  controls.append(previous, playPause, next);

  const nativeControls = document.createElement("div");
  nativeControls.className = "player-audio-controls";
  nativeControls.append(audio);

  player.append(artwork, details, controls, nativeControls);
  document.body.append(player);

  return player;
}

const player = createPlayer();

function updatePlayerDetails(track) {
  player.querySelector(".player-title").textContent = track.title;
  player.querySelector(".player-artist").textContent = track.artist;

  const artwork = player.querySelector(".player-artwork");

  if (track.artwork) {
    artwork.src = track.artwork;
    artwork.hidden = false;
  } else {
    artwork.removeAttribute("src");
    artwork.hidden = true;
  }
}

function updatePlayButton() {
  const button = player.querySelector(
    '[aria-label="Play or pause"]'
  );

  button.textContent = audio.paused ? "▶" : "⏸";
  button.setAttribute(
    "aria-label",
    audio.paused ? "Play" : "Pause"
  );
}

async function playTrack(index) {
  const track = tracks[index];

  if (!track || !track.audioUrl) {
    showMessage(
      "This track does not have an available playable audio stream.",
      true
    );
    return;
  }

  currentTrackIndex = index;
  updatePlayerDetails(track);

  audio.pause();
  audio.src = track.audioUrl;
  audio.load();

  try {
    await audio.play();
    showMessage(`Now playing: ${track.title} — ${track.artist}`);
  } catch (error) {
    console.error("Playback error:", error);
    showMessage(
      "Playback could not start. Try another track or check your connection.",
      true
    );
  }

  updatePlayButton();
}

function togglePlayback() {
  if (!audio.src) {
    if (tracks.length) {
      const firstPlayable = tracks.findIndex(track => track.audioUrl);
      if (firstPlayable !== -1) playTrack(firstPlayable);
      else showMessage("No playable tracks in these results.", true);
    } else {
      showMessage("Search for a song first.", true);
    }
    return;
  }

  if (audio.paused) {
    audio.play()
      .then(updatePlayButton)
      .catch(() => showMessage("Unable to resume playback.", true));
  } else {
    audio.pause();
    updatePlayButton();
  }
}

function playNext() {
  if (!tracks.length) return;

  for (let step = 1; step <= tracks.length; step++) {
    const index = (currentTrackIndex + step + tracks.length) % tracks.length;
    if (tracks[index].audioUrl) {
      playTrack(index);
      return;
    }
  }

  showMessage("No playable tracks in these results.", true);
}

function playPrevious() {
  if (!tracks.length) return;

  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }

  for (let step = 1; step <= tracks.length; step++) {
    const index =
      (currentTrackIndex - step + tracks.length) % tracks.length;

    if (tracks[index].audioUrl) {
      playTrack(index);
      return;
    }
  }
}

audio.addEventListener("play", updatePlayButton);
audio.addEventListener("pause", updatePlayButton);
audio.addEventListener("ended", playNext);

audio.addEventListener("error", () => {
  updatePlayButton();
  showMessage(
    "This track could not be played. Try another available track.",
    true
  );
});

// ---------- Search results ----------

function makeElement(tag, className, text) {
  const element = document.createElement(tag);

  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;

  return element;
}

function renderTracks() {
  if (!resultsEl) return;

  resultsEl.replaceChildren();

  if (!tracks.length) {
    resultsEl.append(
      makeElement(
        "p",
        "empty-state",
        "No songs found. Try another song title or artist."
      )
    );
    return;
  }

  tracks.forEach((track, index) => {
    const card = makeElement("article", "bridge-card song-card");

    const art = makeElement("div", "bridge-card-art art-purple");

    if (track.artwork) {
      const image = document.createElement("img");
      image.src = track.artwork;
      image.alt = `${track.title} album artwork`;
      image.loading = "lazy";
      image.onerror = () => {
        image.remove();
        art.textContent = "♫";
      };
      art.append(image);
    } else {
      art.textContent = "♫";
    }

    const copy = makeElement("div", "bridge-card-copy");
    copy.append(
      makeElement("span", "bridge-kicker", track.source || "MUSIC"),
      makeElement("h3", "", track.title),
      makeElement("p", "", track.artist)
    );

    if (track.album) {
      copy.append(makeElement("p", "song-album", track.album));
    }

    if (track.license) {
      const licenseLink = document.createElement("a");
      licenseLink.href = track.license;
      licenseLink.target = "_blank";
      licenseLink.rel = "noopener noreferrer";
      licenseLink.textContent = "License";
      licenseLink.className = "song-license";
      copy.append(licenseLink);
    }

    const playButton = makeElement(
      "button",
      "primary-action",
      track.audioUrl ? "▶ Play" : "Unavailable"
    );

    playButton.type = "button";
    playButton.disabled = !track.audioUrl;
    playButton.addEventListener("click", () => playTrack(index));

    card.append(art, copy, playButton);
    resultsEl.append(card);
  });
}

async function searchTracks(query) {
  const normalized = String(query || "").trim().replace(/\s+/g, " ");

  if (!normalized) {
    showMessage("Enter a song title or artist first.", true);
    searchInput?.focus();
    return;
  }

  if (normalized.length > 200) {
    showMessage("Please keep your search under 200 characters.", true);
    return;
  }

  const requestId = ++searchRequestId;
  activeQuery = normalized;

  if (resultsHeading) {
    resultsHeading.textContent = `Searching for “${normalized}”…`;
  }

  resultsEl?.replaceChildren();
  showMessage("Searching the music catalog…");

  try {
    const response = await fetch(
      `/api/search?q=${encodeURIComponent(normalized)}`,
      {
        headers: { Accept: "application/json" }
      }
    );

    const data = await response.json();

    // Ignore older requests that finish after a newer search.
    if (requestId !== searchRequestId) return;

    if (!response.ok) {
      throw new Error(data.error || "Music search failed.");
    }

    tracks = Array.isArray(data.results) ? data.results : [];

    if (resultsHeading) {
      resultsHeading.textContent = `Results for “${normalized}”`;
    }

    renderTracks();
    saveRecentSearch(normalized);

    showMessage(
      tracks.length
        ? `Found ${tracks.length} tracks. Choose Play to listen here.`
        : "No matching tracks found. Try a different search."
    );
  } catch (error) {
    if (requestId !== searchRequestId) return;

    console.error("TuneWave search error:", error);

    tracks = [];
    renderTracks();

    if (resultsHeading) {
      resultsHeading.textContent = `Search: “${normalized}”`;
    }

    showMessage(
      error.message || "Could not search right now. Please try again.",
      true
    );
  }
}

// ---------- Search form and quick searches ----------

searchForm?.addEventListener("submit", event => {
  event.preventDefault();
  searchTracks(searchInput?.value || "");
});

document.querySelectorAll(".quick-chip").forEach(button => {
  button.addEventListener("click", () => {
    const query = button.dataset.query || "";
    if (searchInput) searchInput.value = query;
    searchTracks(query);
    resultsEl?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  });
});

clearRecentButton?.addEventListener("click", () => {
  try {
    localStorage.removeItem(recentSearchesKey);
  } catch {
    // Continue if storage is unavailable.
  }

  renderRecentSearches();
  showMessage("Recent searches cleared from this browser.");
});

// ---------- PWA installation ----------

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;

  if (installButton) installButton.hidden = false;
});

installButton?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) {
    showMessage(
      "To install TuneWave, open your browser menu and choose Install app or Add to Home Screen."
    );
    return;
  }

  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;

  deferredInstallPrompt = null;
  installButton.hidden = true;
});

// ---------- Service worker ----------

if (
  "serviceWorker" in navigator &&
  (location.protocol === "https:" ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1")
) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./service-worker.js")
      .catch(error => {
        console.error("Service worker registration failed:", error);
      });
  });
}

// ---------- Start ----------

setDeviceStatus();
renderRecentSearches();
updatePlayButton();
