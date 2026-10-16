// TuneWave Link Bridge — hands YouTube search URLs to NewPipe on Android.
// This webpage does not scrape or stream music itself. The external app owns playback.

const INSTALL_GUIDE = "https://newpipe.net/FAQ/tutorials/install-add-fdroid-repo/";
const recentSearchesKey = "tunewave-newpipe-recent-v1";
const searchForm = document.querySelector("#searchForm");
const searchInput = document.querySelector("#searchInput");
const resultsHeading = document.querySelector("#resultsHeading");
const message = document.querySelector("#message");
const deviceStatus = document.querySelector("#deviceStatus");
const recentSearchesEl = document.querySelector("#recentSearches");
const clearRecentButton = document.querySelector("#clearRecent");
const installButton = document.querySelector("#installButton");
const isAndroid = /Android/i.test(navigator.userAgent);
let deferredInstallPrompt = null;
let activeQuery = "Arijit Singh best songs";

// Safely read the local recent-search list; storage might be disabled in private browsing.
function readRecentSearches() {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentSearchesKey) || "[]");
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === "string") : [];
  } catch (error) {
    return [];
  }
}

// Save only query terms on this device; no account or server is used.
function saveRecentSearch(query) {
  const normalized = query.trim().replace(/\s+/g, " ").slice(0, 160);
  if (!normalized) return;
  const updated = [normalized, ...readRecentSearches().filter(item => item.toLowerCase() !== normalized.toLowerCase())].slice(0, 8);
  try { localStorage.setItem(recentSearchesKey, JSON.stringify(updated)); } catch (error) { /* Continue if storage is unavailable. */ }
  renderRecentSearches();
}

// Make an official YouTube search URL for fallback browsers and desktop/iOS devices.
function youtubeSearchUrl(query) {
  const url = new URL("https://www.youtube.com/results");
  url.searchParams.set("search_query", query);
  return url.toString();
}

// Android's intent URI asks Android to route the YouTube search URL to the NewPipe package.
// It works only when Android and a compatible NewPipe installation are available.
function newPipeIntentUrl(query) {
  const encodedQuery = encodeURIComponent(query).replace(/%20/g, "+");
  return `intent://www.youtube.com/results?search_query=${encodedQuery}#Intent;scheme=https;package=org.schabi.newpipe;end`;
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function updateDeviceMessage() {
  if (isAndroid) {
    deviceStatus.textContent = "Android detected";
    showMessage("Android detected. If NewPipe is installed, use Open in NewPipe; otherwise use the YouTube fallback or install NewPipe.");
  } else {
    deviceStatus.textContent = "Browser mode";
    showMessage("This device cannot launch NewPipe directly from the website. Search will open YouTube in your browser; NewPipe is Android-only.");
  }
}

// Show a single search with two possible destinations rather than pretending the website streams it.
function renderSearchActions(query) {
  activeQuery = query;
  resultsHeading.textContent = `Search: “${query}”`;
  const resultGrid = document.querySelector("#results");
  resultGrid.replaceChildren();

  const newPipeCard = document.createElement("article");
  newPipeCard.className = "bridge-card featured-card";
  const newPipeArt = document.createElement("div");
  newPipeArt.className = "bridge-card-art art-cyan";
  newPipeArt.textContent = "♫";
  const newPipeCopy = document.createElement("div");
  newPipeCopy.className = "bridge-card-copy";
  const newPipeKicker = document.createElement("span");
  newPipeKicker.className = "bridge-kicker";
  newPipeKicker.textContent = "ANDROID · EXTERNAL APP";
  const newPipeTitle = document.createElement("h3");
  newPipeTitle.textContent = "Open in NewPipe";
  const newPipeDesc = document.createElement("p");
  newPipeDesc.textContent = `Send “${query}” to NewPipe for Android background playback.`;
  newPipeCopy.append(newPipeKicker, newPipeTitle, newPipeDesc);
  const newPipeButton = document.createElement("button");
  newPipeButton.type = "button";
  newPipeButton.className = "primary-action";
  newPipeButton.append(document.createTextNode(isAndroid ? "Open in NewPipe " : "Android only "));
  const arrowOne = document.createElement("span");
  arrowOne.textContent = "↗";
  newPipeButton.append(arrowOne);
  newPipeButton.addEventListener("click", () => openInNewPipe(query));
  newPipeCard.append(newPipeArt, newPipeCopy, newPipeButton);

  const youtubeCard = document.createElement("article");
  youtubeCard.className = "bridge-card";
  const youtubeArt = document.createElement("div");
  youtubeArt.className = "bridge-card-art art-purple";
  youtubeArt.textContent = "▶";
  const youtubeCopy = document.createElement("div");
  youtubeCopy.className = "bridge-card-copy";
  const youtubeKicker = document.createElement("span");
  youtubeKicker.className = "bridge-kicker";
  youtubeKicker.textContent = "ALL DEVICES · BROWSER";
  const youtubeTitle = document.createElement("h3");
  youtubeTitle.textContent = "Open on YouTube";
  const youtubeDesc = document.createElement("p");
  youtubeDesc.textContent = `Show YouTube search results for “${query}”. Normal YouTube playback rules apply.`;
  youtubeCopy.append(youtubeKicker, youtubeTitle, youtubeDesc);
  const youtubeButton = document.createElement("button");
  youtubeButton.type = "button";
  youtubeButton.className = "secondary-action";
  youtubeButton.append(document.createTextNode("Open YouTube "));
  const arrowTwo = document.createElement("span");
  arrowTwo.textContent = "↗";
  youtubeButton.append(arrowTwo);
  youtubeButton.addEventListener("click", () => window.open(youtubeSearchUrl(query), "_blank", "noopener,noreferrer"));
  youtubeCard.append(youtubeArt, youtubeCopy, youtubeButton);

  resultGrid.append(newPipeCard, youtubeCard);
  saveRecentSearch(query);
}

function openInNewPipe(query) {
  if (!isAndroid) {
    showMessage("NewPipe runs on Android only. Use Open YouTube on this device, or install NewPipe on an Android device.");
    return;
  }
  showMessage("Trying to open NewPipe. If it is not installed or the link is not recognized, use Open YouTube or the install guide.");
  // This is a user-triggered intent navigation; the Android OS/app decides whether it can open.
  window.location.href = newPipeIntentUrl(query);
}

function renderRecentSearches() {
  const searches = readRecentSearches();
  recentSearchesEl.replaceChildren();
  if (!searches.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Your recent searches will appear here on this device.";
    recentSearchesEl.append(empty);
    return;
  }
  searches.forEach(query => {
    const row = document.createElement("div");
    row.className = "recent-item";
    const text = document.createElement("button");
    text.type = "button";
    text.className = "recent-query";
    text.textContent = query;
    text.addEventListener("click", () => {
      searchInput.value = query;
      renderSearchActions(query);
      document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const newPipe = document.createElement("button");
    newPipe.type = "button";
    newPipe.className = "recent-open";
    newPipe.textContent = "NewPipe ↗";
    newPipe.addEventListener("click", () => openInNewPipe(query));
    const youtube = document.createElement("button");
    youtube.type = "button";
    youtube.className = "recent-open secondary";
    youtube.textContent = "YouTube ↗";
    youtube.addEventListener("click", () => window.open(youtubeSearchUrl(query), "_blank", "noopener,noreferrer"));
    row.append(text, newPipe, youtube);
    recentSearchesEl.append(row);
  });
}

searchForm.addEventListener("submit", event => {
  event.preventDefault();
  const query = searchInput.value.trim();
  if (!query) {
    showMessage("Enter a song, artist, album or mood first.", true);
    searchInput.focus();
    return;
  }
  renderSearchActions(query);
  showMessage(isAndroid ? "Search prepared. Choose Open in NewPipe to hand it to the Android app, or use YouTube in the browser." : "Search prepared. Choose Open YouTube; NewPipe is available on Android only.");
});

document.querySelectorAll(".quick-chip").forEach(button => {
  button.addEventListener("click", () => {
    searchInput.value = button.dataset.query || "";
    renderSearchActions(searchInput.value);
    document.querySelector("#results").scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

document.querySelectorAll('[data-action="newpipe"]').forEach(button => button.addEventListener("click", () => openInNewPipe(button.dataset.query || activeQuery)));
document.querySelectorAll('[data-action="youtube"]').forEach(button => button.addEventListener("click", () => window.open(youtubeSearchUrl(button.dataset.query || activeQuery), "_blank", "noopener,noreferrer")));

clearRecentButton.addEventListener("click", () => {
  try { localStorage.removeItem(recentSearchesKey); } catch (error) { /* Storage may be disabled. */ }
  renderRecentSearches();
  showMessage("Recent searches cleared from this browser.");
});

// Progressive Web App installation prompt; availability varies by browser.
window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});
installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(() => {}));
}

// Make the initial sample card honest about Android-only app launching.
document.querySelectorAll('[data-action="newpipe"]').forEach(button => {
  button.textContent = isAndroid ? "Try NewPipe ↗" : "Android only";
});

updateDeviceMessage();
renderRecentSearches();
