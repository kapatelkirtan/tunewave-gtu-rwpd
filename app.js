(() => {
  'use strict';

  // ============================================================
  // TuneWave — Jamendo full-track music integration
  // ============================================================

  const API = 'https://api.jamendo.com/v3.0';

  // Use the real client_id from your Jamendo developer app.
  // This is a public API client ID, not a password.
  const JAMENDO_CLIENT_ID = 'c854bb26';

  const $ = (id) => document.getElementById(id);

  const els = {
    form: $('searchForm'),
    input: $('searchInput'),
    clearSearch: $('clearSearch'),
    heroKicker: $('heroKicker'),
    heroTitle: $('heroTitle'),
    heroDescription: $('heroDescription'),
    explore: $('exploreButton'),
    albumGrid: $('albumGrid'),
    albumsHeading: $('albumsHeading'),
    seeAlbums: $('seeAlbums'),
    resultsHeading: $('resultsHeading'),
    songsEyebrow: $('songsEyebrow'),
    rows: $('songRows'),
    count: $('resultCount'),
    message: $('message'),
    recent: $('recentSearches'),
    clearRecent: $('clearRecent'),
    libraryView: $('libraryView'),
    libraryHeading: $('libraryHeading'),
    libraryGrid: $('libraryGrid'),
    likedCount: $('likedCount'),
    audio: $('audioPlayer'),
    playerArtwork: $('playerArtwork'),
    playerTitle: $('playerTitle'),
    playerArtist: $('playerArtist'),
    playerLike: $('playerLike'),
    play: $('playButton'),
    prev: $('previousButton'),
    next: $('nextButton'),
    progress: $('progress'),
    currentTime: $('currentTime'),
    totalTime: $('totalTime'),
    volume: $('volumeSlider'),
    shuffle: $('shuffleButton'),
    repeat: $('repeatButton'),
    queue: $('queueButton'),
    toast: $('toast'),
    menuToggle: $('menuToggle'),
    sidebar: $('sidebar')
  };

  // Fail early with a useful message if the HTML doesn't match.
  const requiredElements = [
    'form', 'input', 'albumGrid', 'rows', 'message',
    'audio', 'play', 'progress', 'toast'
  ];

  const missingElements = requiredElements.filter(
    (key) => !els[key]
  );

  if (missingElements.length) {
    console.error(
      'TuneWave is missing required HTML elements:',
      missingElements
    );
    return;
  }

  const gradients = [
    'linear-gradient(145deg,#ff8e9e,#5e28db)',
    'linear-gradient(145deg,#ffb36d,#9e2bd1)',
    'linear-gradient(145deg,#23d6e8,#302db6)',
    'linear-gradient(145deg,#ad41ff,#f64b9b)',
    'linear-gradient(145deg,#ffd277,#ec4d8e)',
    'linear-gradient(145deg,#4377ed,#34dbcf)'
  ];

  const symbols = ['☼', '◈', '♫', '✦', '☾', '♬'];

  const starterQueries = [
    'chill',
    'focus',
    'electronic',
    'night drive',
    'feel good',
    'indie pop'
  ];

  let tracks = [];
  let albums = [];
  let currentIndex = -1;
  let currentQuery = '';
  let loadingSequence = 0;
  let albumExpanded = false;
  let currentView = 'home';
  let shuffleOn = false;
  let repeatOn = false;
  let toastTimeout = null;

  // ============================================================
  // General helpers
  // ============================================================

  const readJSON = (key, fallback = []) => {
    try {
      const data = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(data) ? data : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJSON = (key, value) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local storage is optional.
    }
  };

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[character]));

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) {
      return '0:00';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  const durationOf = (track) =>
    Math.round(
      Number(track?.duration) ||
      (Number(track?.trackTimeMillis) || 0) / 1000
    );

  // TuneWave originally supported artwork URLs from another provider.
  // Jamendo artwork URLs also work with this helper.
  const getArtwork = (url) => url || '';

  const getLikes = () => readJSON('tw-likes');
  const getSearches = () => readJSON('tw-searches');

  const trackKey = (track) =>
    String(
      track?.trackId ||
      track?.id ||
      track?.collectionId ||
      `${track?.trackName || ''}|${track?.artistName || ''}`
    );

  const isLiked = (track) =>
    getLikes().some((item) => trackKey(item) === trackKey(track));

  function titleCase(text) {
    return String(text || '').replace(/\b\w/g, (character) =>
      character.toUpperCase()
    );
  }

  function toast(message) {
    if (!els.toast) return;

    els.toast.textContent = message;
    els.toast.classList.add('show');

    clearTimeout(toastTimeout);

    toastTimeout = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 2600);
  }

  function paintRange(input, percent) {
    if (!input) return;

    const safePercent = Math.max(0, Math.min(100, percent));

    input.style.setProperty(
      '--range-progress',
      `${safePercent}%`
    );
  }

  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach((button) => {
      button.classList.toggle(
        'active',
        button.dataset.nav === name
      );
    });

    if (
      name !== 'liked' &&
      name !== 'library' &&
      name !== 'playlists'
    ) {
      if (els.libraryView) els.libraryView.hidden = true;

      const featured = $('featuredSection');
      const songs = $('songsSection');
      const recent = $('recentSection');

      if (featured) featured.hidden = false;
      if (songs) songs.hidden = false;
      if (recent) recent.hidden = false;
    }
  }

  // ============================================================
  // Jamendo API — full-track search
  // ============================================================

  function validateClientId() {
    if (
      !JAMENDO_CLIENT_ID ||
      JAMENDO_CLIENT_ID.includes('PASTE_YOUR') ||
      JAMENDO_CLIENT_ID.trim() === ''
    ) {
      throw new Error(
        'Add your actual Jamendo client ID in app.js before searching.'
      );
    }
  }

  async function fetchJamendo(endpoint, params) {
    validateClientId();

    const searchParams = new URLSearchParams({
      client_id: JAMENDO_CLIENT_ID,
      format: 'json',
      ...params
    });

    const url = `${API}/${endpoint}/?${searchParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(
        `Jamendo API request failed (${response.status}).`
      );
    }

    const body = await response.json();

    if (body?.headers?.status !== 'success') {
      throw new Error(
        body?.headers?.error_message ||
        'Jamendo returned an unsuccessful response.'
      );
    }

    return Array.isArray(body.results) ? body.results : [];
  }

  /**
   * Search full-length Jamendo tracks.
   *
   * Jamendo's `audio` property is the stream URL.
   * We keep the legacy `previewUrl` property too because the existing
   * TuneWave player already reads it. Despite the old name, this is
   * the Jamendo track stream, not an iTunes 30-second preview.
   */
  async function apiSearch(query, limit = 30) {
    const results = await fetchJamendo('tracks', {
      limit: String(limit),
      search: query,
      include: 'licenses musicinfo',
      audioformat: 'mp32',
      imagesize: '300',
      type: 'single albumtrack'
    });

    return results.map((item) => {
      const audioUrl = item.audio || '';

      const genres =
        item.musicinfo?.tags?.genres;

      const genre = Array.isArray(genres) && genres.length
        ? genres[0]
        : 'Independent music';

      return {
        ...item,

        // TuneWave-compatible identifiers and display fields.
        trackId: String(item.id || ''),
        trackName: item.name || 'Untitled track',
        artistName: item.artist_name || 'Unknown artist',

        collectionId: String(item.album_id || item.id || ''),
        collectionName: item.album_name || 'Single',

        artworkUrl100: item.album_image || item.image || '',

        primaryGenreName: genre,
        trackTimeMillis: (Number(item.duration) || 0) * 1000,

        // Full stream URL from Jamendo.
        audioUrl,
        previewUrl: audioUrl,

        trackViewUrl: item.shareurl || item.shorturl || '',
        licenseUrl: item.license_ccurl || '',

        // Keep source permissions in the returned track object.
        audiodownloadAllowed: item.audiodownload_allowed === true,
        audiodownloadUrl: item.audiodownload || ''
      };
    }).filter((track) => track.trackId);
  }

  /**
   * Search the separate Jamendo albums endpoint.
   *
   * The albums API does not use the same free-text search field
   * as the tracks API, so this uses namesearch for album titles.
   */
  async function apiAlbumSearch(query, limit = 6) {
    const results = await fetchJamendo('albums', {
      limit: String(limit),
      namesearch: query,
      imagesize: '300',
      type: 'album single',
      order: 'popularity_total_desc'
    });

    return results.map((item) => ({
      ...item,

      collectionId: String(item.id || ''),
      collectionName: item.name || 'Untitled album',
      artistName: item.artist_name || 'Unknown artist',
      artworkUrl100: item.image || '',

      trackViewUrl: item.shareurl || item.shorturl || ''
    }));
  }

  /**
   * If the albums endpoint finds no album title matching the query,
   * create album cards from albums returned alongside matching tracks.
   */
  function albumsFromTracks(trackList) {
    const uniqueAlbums = new Map();

    trackList.forEach((track) => {
      const albumId = String(track.album_id || '');
      const albumName = String(track.album_name || '');

      // Singles may not belong to an album.
      if (!albumId || !albumName) return;

      if (!uniqueAlbums.has(albumId)) {
        uniqueAlbums.set(albumId, {
          collectionId: albumId,
          collectionName: albumName,
          artistName: track.artistName || track.artist_name || 'Unknown artist',
          artworkUrl100:
            track.artworkUrl100 ||
            track.album_image ||
            track.image ||
            '',
          trackViewUrl: track.trackViewUrl || ''
        });
      }
    });

    return Array.from(uniqueAlbums.values()).slice(0, 6);
  }

  // ============================================================
  // Loading and search history
  // ============================================================

  function setLoading(query) {
    els.count.textContent = 'Searching…';

    els.message.classList.remove('error');

    els.message.textContent = query
      ? `Looking for “${query}”…`
      : 'Finding music for you…';

    els.rows.innerHTML = `
      <tr>
        <td colspan="6" class="table-message">
          Finding matching songs…
        </td>
      </tr>
    `;

    els.albumGrid.innerHTML = Array(6)
      .fill('<div class="album-skeleton"></div>')
      .join('');
  }

  function recordSearch(query) {
    const cleaned = query.trim();

    if (!cleaned) return;

    const previous = getSearches().filter(
      (item) =>
        typeof item === 'string' &&
        item.toLowerCase() !== cleaned.toLowerCase()
    );

    writeJSON(
      'tw-searches',
      [cleaned, ...previous].slice(0, 8)
    );

    renderRecent();
  }

  // ============================================================
  // Main search action
  // ============================================================

  async function runSearch(
    query,
    { fromHistory = false, mode = 'search' } = {}
  ) {
    const clean = String(query || '').trim();

    if (!clean) {
      toast('Type a song, artist, album or mood first.');
      els.input.focus();
      return;
    }

    const requestNo = ++loadingSequence;

    currentQuery = clean;
    currentView = mode === 'home' ? 'home' : 'search';

    els.input.value = clean;
    els.clearSearch.hidden = false;

    const libraryView = $('libraryView');
    const featuredSection = $('featuredSection');
    const songsSection = $('songsSection');
    const recentSection = $('recentSection');

    if (libraryView) libraryView.hidden = true;
    if (featuredSection) featuredSection.hidden = false;
    if (songsSection) songsSection.hidden = false;
    if (recentSection) recentSection.hidden = false;

    if (currentView === 'home') {
      els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';

      els.heroTitle.innerHTML =
        'Discover<br><span>New Music</span>';

      els.heroDescription.textContent =
        'Find your next favorite independent song, artist or album.';

      els.albumsHeading.textContent = 'Featured Albums';
      els.resultsHeading.textContent = 'Popular Songs';
      els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";

      setActiveNav('home');
    } else {
      els.heroKicker.textContent = 'MUSIC DISCOVERY';

      els.heroTitle.innerHTML =
        `Search<br><span>${esc(clean)}</span>`;

      els.heroDescription.textContent =
        'Explore matching independent songs, artists and albums.';

      els.albumsHeading.textContent = 'Matching Albums';
      els.resultsHeading.textContent = `Songs for “${clean}”`;
      els.songsEyebrow.textContent = 'MATCHED TO YOUR SEARCH';

      setActiveNav('search');
    }

    setLoading(clean);

    if (!fromHistory) {
      recordSearch(clean);
    }

    try {
      // If album lookup fails, song search can still succeed.
      const [songResult, albumResult] = await Promise.allSettled([
        apiSearch(clean, 30),
        apiAlbumSearch(clean, 6)
      ]);

      // Ignore outdated results when the user makes another search.
      if (requestNo !== loadingSequence) return;

      if (songResult.status === 'rejected') {
        throw songResult.reason;
      }

      // The API adapter already maps Jamendo tracks to TuneWave tracks.
      // Do NOT filter them using the old iTunes wrapperType/kind fields.
      tracks = songResult.value;

      const apiAlbums = albumResult.status === 'fulfilled'
        ? albumResult.value
        : [];

      albums = apiAlbums.length
        ? apiAlbums
        : albumsFromTracks(tracks);

      renderAlbums();
      renderTracks();

      els.count.textContent =
        `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;

      if (tracks.length) {
        els.message.textContent =
          currentView === 'home'
            ? 'Explore the results or search for an artist, song, album or mood.'
            : `Showing music results for “${clean}”. Select play to stream the available full track.`;

        els.message.classList.remove('error');
      } else {
        els.message.textContent =
          `No tracks found for “${clean}”. Try another spelling, artist or genre.`;

        els.message.classList.remove('error');
      }

      // Album lookup is optional, so don't treat its failure as a
      // failed song search.
      if (
        albumResult.status === 'rejected' &&
        !albums.length
      ) {
        console.warn('TuneWave album search:', albumResult.reason);
      }
    } catch (error) {
      if (requestNo !== loadingSequence) return;

      tracks = [];
      albums = [];

      renderAlbums();
      renderTracks();

      els.count.textContent = 'Search unavailable';

      els.message.textContent =
        error instanceof Error
          ? error.message
          : 'Could not load music right now. Please try again.';

      els.message.classList.add('error');

      console.error('TuneWave search error:', error);
    }
  }

  // ============================================================
  // Album cards
  // ============================================================

  function renderAlbums() {
    if (albums.length) {
      const shown = albumExpanded
        ? albums
        : albums.slice(0, 6);

      els.albumGrid.innerHTML = shown.map((album, index) => {
        const art = getArtwork(album.artworkUrl100);
        const gradient = gradients[index % gradients.length];

        return `
          <button
            type="button"
            class="album-card"
            data-album-index="${index}"
            aria-label="Search for album ${esc(album.collectionName || 'album')}"
          >
            ${
              art
                ? `
                  <img
                    class="album-art"
                    src="${esc(art)}"
                    alt=""
                    loading="lazy"
                    onerror="this.style.display='none'"
                  >
                `
                : `
                  <span
                    class="album-art album-art-fallback"
                    style="--card-gradient:${gradient}"
                  >${symbols[index % symbols.length]}</span>
                `
            }

            <span class="album-title">
              ${esc(album.collectionName || 'Untitled album')}
            </span>

            <span class="album-subtitle">
              ${esc(album.artistName || 'Various artists')}
            </span>
          </button>
        `;
      }).join('');

      els.albumsHeading.textContent =
        currentView === 'home'
          ? 'Featured Albums'
          : 'Matching Albums';
    } else {
      const cards = currentView === 'home'
        ? starterQueries
        : starterQueries.slice(0, 3);

      els.albumGrid.innerHTML = cards.map((name, index) => `
        <button
          type="button"
          class="album-card"
          data-playlist-query="${esc(name)}"
        >
          <span
            class="album-art album-art-fallback"
            style="--card-gradient:${gradients[index % gradients.length]}"
          >${symbols[index % symbols.length]}</span>

          <span class="album-title">${esc(titleCase(name))}</span>
          <span class="album-subtitle">Explore the vibe</span>
        </button>
      `).join('');

      els.albumsHeading.textContent =
        currentView === 'home'
          ? 'Explore Music'
          : 'Try another mood';
    }

    if (els.seeAlbums) {
      els.seeAlbums.textContent = albumExpanded
        ? 'Show less  ‹'
        : 'See all  ›';
    }
  }

  // ============================================================
  // Song table
  // ============================================================

  function renderTracks() {
    if (!tracks.length) {
      els.rows.innerHTML = `
        <tr>
          <td colspan="6" class="table-message">
            ${
              currentView === 'liked'
                ? 'You have not liked any songs yet.'
                : 'No songs to display yet. Try searching for a song or artist above.'
            }
          </td>
        </tr>
      `;

      return;
    }

    els.rows.innerHTML = tracks.map((track, index) => {
      const artwork =
        getArtwork(track.artworkUrl100) || '/icon-192.png';

      const duration = durationOf(track);
      const liked = isLiked(track);

      return `
        <tr data-track-index="${index}">
          <td>
            <span class="row-number">${index + 1}</span>

            <button
              type="button"
              class="row-play"
              data-play-index="${index}"
              aria-label="Play ${esc(track.trackName)}"
            >▶</button>
          </td>

          <td>
            <div class="track-cell">
              <img
                class="track-art"
                src="${esc(artwork)}"
                alt=""
                loading="lazy"
                onerror="this.onerror=null;this.src='/icon-192.png'"
              >

              <div class="track-info">
                <span class="track-name">
                  ${esc(track.trackName || 'Untitled track')}
                </span>

                <span class="track-subname">
                  ${esc(track.primaryGenreName || 'Independent music')}
                </span>
              </div>
            </div>
          </td>

          <td
            class="ellipsis-cell"
            title="${esc(track.artistName)}"
          >
            ${esc(track.artistName || 'Unknown artist')}
          </td>

          <td
            class="ellipsis-cell"
            title="${esc(track.collectionName)}"
          >
            ${esc(track.collectionName || 'Single')}
          </td>

          <td class="duration-cell">
            ${formatTime(duration)}
          </td>

          <td>
            <div class="row-actions">
              <button
                type="button"
                class="row-like ${liked ? 'liked' : ''}"
                data-like-index="${index}"
                aria-label="${liked ? 'Unlike' : 'Like'} ${esc(track.trackName)}"
              >${liked ? '♥' : '♡'}</button>

              <button
                type="button"
                class="row-open"
                data-open-index="${index}"
                aria-label="Open source and track information for ${esc(track.trackName)}"
              >⋮</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ============================================================
  // Recent searches
  // ============================================================

  function renderRecent() {
    if (!els.recent) return;

    const items = getSearches().filter(
      (item) => typeof item === 'string'
    );

    if (!items.length) {
      els.recent.innerHTML = `
        <span class="recent-empty">
          Your searches will appear here.
        </span>
      `;

      return;
    }

    els.recent.innerHTML = items.map((query) => `
      <button
        class="recent-chip"
        type="button"
        data-recent-query="${esc(query)}"
      >⌕ &nbsp;${esc(query)}</button>
    `).join('');
  }

  // ============================================================
  // Likes and personal library
  // ============================================================

  function updateLikeCount() {
    if (els.likedCount) {
      els.likedCount.textContent = String(getLikes().length);
    }
  }

  function renderLibrary(kind) {
    currentView = kind;

    if (els.libraryView) els.libraryView.hidden = false;

    const featured = $('featuredSection');
    const songs = $('songsSection');
    const recent = $('recentSection');

    if (featured) featured.hidden = true;
    if (songs) songs.hidden = true;
    if (recent) recent.hidden = true;

    els.libraryHeading.textContent =
      kind === 'liked'
        ? 'Liked Songs'
        : kind === 'playlists'
          ? 'Playlists & Mixes'
          : 'Your Library';

    const items = kind === 'liked' || kind === 'library'
      ? getLikes()
      : [];

    if (kind === 'playlists') {
      els.libraryGrid.innerHTML = starterQueries.map((name, index) => `
        <button
          type="button"
          class="album-card"
          data-playlist-query="${esc(name)}"
        >
          <span
            class="album-art album-art-fallback"
            style="--card-gradient:${gradients[index % gradients.length]}"
          >${symbols[index % symbols.length]}</span>

          <span class="album-title">${esc(titleCase(name))}</span>
          <span class="album-subtitle">Search this mood</span>
        </button>
      `).join('');
    } else if (items.length) {
      els.libraryGrid.innerHTML = items.map((track, index) => {
        const art =
          getArtwork(track.artworkUrl100) || '/icon-192.png';

        return `
          <button
            type="button"
            class="album-card"
            data-library-index="${index}"
          >
            <img
              class="album-art"
              src="${esc(art)}"
              alt=""
              loading="lazy"
              onerror="this.onerror=null;this.src='/icon-192.png'"
            >

            <span class="album-title">
              ${esc(track.trackName || track.collectionName || 'Saved song')}
            </span>

            <span class="album-subtitle">
              ${esc(track.artistName || 'Unknown artist')}
            </span>
          </button>
        `;
      }).join('');
    } else {
      els.libraryGrid.innerHTML = `
        <div class="library-empty">
          ${
            kind === 'liked'
              ? 'Your liked songs will appear here. Tap ♡ beside any song to save it.'
              : 'Your personal collection will appear here when you like songs.'
          }
        </div>
      `;
    }

    setActiveNav(kind);
  }

  function toggleLike(track) {
    if (!track) return;

    let liked = getLikes();
    const key = trackKey(track);

    if (liked.some((item) => trackKey(item) === key)) {
      liked = liked.filter((item) => trackKey(item) !== key);
      toast('Removed from Liked Songs');
    } else {
      liked.unshift(track);
      liked = liked.slice(0, 100);
      toast('Added to Liked Songs');
    }

    writeJSON('tw-likes', liked);

    updateLikeCount();
    renderTracks();

    if (
      currentIndex >= 0 &&
      tracks[currentIndex] &&
      trackKey(tracks[currentIndex]) === key
    ) {
      const status = isLiked(tracks[currentIndex]);

      els.playerLike.classList.toggle('liked', status);
      els.playerLike.textContent = status ? '♥' : '♡';
    }

    if (currentView === 'liked') {
      renderLibrary('liked');
    }
  }

  // ============================================================
  // Player controls
  // ============================================================

  function setPlayerTrack(index, autoplay = true) {
    if (
      !tracks.length ||
      index < 0 ||
      index >= tracks.length
    ) {
      return;
    }

    currentIndex = index;

    const track = tracks[index];

    const art =
      getArtwork(track.artworkUrl100) || '/icon-192.png';

    els.playerArtwork.src = art;
    els.playerArtwork.alt = `${track.trackName || 'Track'} artwork`;

    els.playerTitle.textContent =
      track.trackName || 'Unknown track';

    els.playerArtist.textContent =
      track.artistName || 'Unknown artist';

    els.totalTime.textContent =
      formatTime(durationOf(track));

    els.progress.value = '0';

    paintRange(els.progress, 0);

    els.currentTime.textContent = '0:00';

    const liked = isLiked(track);

    els.playerLike.classList.toggle('liked', liked);
    els.playerLike.textContent = liked ? '♥' : '♡';

    // Prefer Jamendo's full audio stream URL.
    // previewUrl is retained for compatibility with the original UI.
    const audioUrl = track.audioUrl || track.previewUrl || '';

    if (!audioUrl) {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();

      els.play.textContent = '▶';

      toast('Audio is unavailable for this track. Open its source page.');

      if (track.trackViewUrl) {
        window.open(
          track.trackViewUrl,
          '_blank',
          'noopener,noreferrer'
        );
      }

      return;
    }

    // Always reload the selected stream.
    els.audio.pause();
    els.audio.src = audioUrl;
    els.audio.load();

    if (autoplay) {
      els.audio.play()
        .then(() => {
          els.play.textContent = 'Ⅱ';
          els.play.setAttribute('aria-label', 'Pause');
        })
        .catch((error) => {
          console.warn('TuneWave playback error:', error);

          els.play.textContent = '▶';

          toast(
            'Could not start this track. Try tapping play again or select another track.'
          );
        });
    } else {
      els.play.textContent = '▶';
      els.play.setAttribute('aria-label', 'Play');
    }
  }

  function playNext() {
    if (!tracks.length) return;

    let next;

    if (shuffleOn && tracks.length > 1) {
      do {
        next = Math.floor(Math.random() * tracks.length);
      } while (next === currentIndex);
    } else {
      next = (currentIndex + 1) % tracks.length;
    }

    setPlayerTrack(next, true);
  }

  function playPrevious() {
    if (!tracks.length) return;

    if (els.audio.currentTime > 3) {
      els.audio.currentTime = 0;
      return;
    }

    const previous =
      (currentIndex - 1 + tracks.length) % tracks.length;

    setPlayerTrack(previous, true);
  }

  function openTrackSource(track) {
    if (!track) return;

    if (track.trackViewUrl) {
      window.open(
        track.trackViewUrl,
        '_blank',
        'noopener,noreferrer'
      );

      return;
    }

    if (track.licenseUrl) {
      window.open(
        track.licenseUrl,
        '_blank',
        'noopener,noreferrer'
      );

      return;
    }

    toast('Source information is not available for this track.');
  }

  // ============================================================
  // Search form and navigation events
  // ============================================================

  els.form.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch(els.input.value);
  });

  els.input.addEventListener('input', () => {
    els.clearSearch.hidden = !els.input.value;
  });

  els.clearSearch.addEventListener('click', () => {
    els.input.value = '';
    els.clearSearch.hidden = true;
    els.input.focus();
  });

  els.explore.addEventListener('click', () => {
    els.input.focus();

    if (els.input.value.trim()) {
      runSearch(els.input.value);
    } else {
      runSearch('electronic');
    }
  });

  if (els.menuToggle && els.sidebar) {
    els.menuToggle.addEventListener('click', () => {
      els.sidebar.classList.toggle('open');
    });
  }

  if (els.seeAlbums) {
    els.seeAlbums.addEventListener('click', () => {
      albumExpanded = !albumExpanded;
      renderAlbums();
    });
  }

  if (els.clearRecent) {
    els.clearRecent.addEventListener('click', () => {
      writeJSON('tw-searches', []);
      renderRecent();
      toast('Recent searches cleared');
    });
  }

  // Central handler for dynamically generated buttons.
  document.addEventListener('click', (event) => {
    const target = event.target.closest('button');

    if (!target) return;

    if (target.dataset.playIndex != null) {
      setPlayerTrack(Number(target.dataset.playIndex), true);
      return;
    }

    if (target.dataset.likeIndex != null) {
      toggleLike(tracks[Number(target.dataset.likeIndex)]);
      return;
    }

    if (target.dataset.openIndex != null) {
      openTrackSource(tracks[Number(target.dataset.openIndex)]);
      return;
    }

    if (target.dataset.albumIndex != null) {
      const album = albums[Number(target.dataset.albumIndex)];

      if (album) {
        // Search the album title in the track catalogue.
        runSearch(
          album.collectionName ||
          album.artistName ||
          currentQuery ||
          'independent music'
        );
      }

      return;
    }

    if (target.dataset.recentQuery) {
      runSearch(target.dataset.recentQuery, {
        fromHistory: true
      });

      return;
    }

    if (target.dataset.playlistQuery) {
      runSearch(target.dataset.playlistQuery);

      if (els.sidebar) {
        els.sidebar.classList.remove('open');
      }

      return;
    }

    if (target.dataset.libraryIndex != null) {
      const saved = getLikes();
      const chosen = saved[Number(target.dataset.libraryIndex)];

      if (!chosen) return;

      const chosenKey = trackKey(chosen);

      // Search by artist/title, then play the matching Jamendo track.
      const searchFor =
        chosen.trackName ||
        chosen.artistName ||
        'independent music';

      runSearch(searchFor).then(() => {
        const found = tracks.findIndex(
          (item) => trackKey(item) === chosenKey
        );

        if (found >= 0) {
          setPlayerTrack(found, true);
        } else {
          toast(
            'This saved track was not found in the current results. Try searching for it again.'
          );
        }
      });

      return;
    }
  });

  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const nav = button.dataset.nav;

      if (els.sidebar) {
        els.sidebar.classList.remove('open');
      }

      if (nav === 'home') {
        currentView = 'home';

        els.input.value = '';
        els.clearSearch.hidden = true;

        els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';

        els.heroTitle.innerHTML =
          'Discover<br><span>New Music</span>';

        els.heroDescription.textContent =
          'Find your next favorite independent song, artist or album.';

        els.albumsHeading.textContent = 'Featured Albums';
        els.resultsHeading.textContent = 'Popular Songs';
        els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";

        setActiveNav('home');

        runSearch('popular music', {
          fromHistory: true,
          mode: 'home'
        });
      } else if (nav === 'search') {
        setActiveNav('search');
        els.input.focus();

        if (els.input.value.trim()) {
          runSearch(els.input.value);
        }
      } else {
        renderLibrary(nav);
      }
    });
  });

  // ============================================================
  // Player button events
  // ============================================================

  els.play.addEventListener('click', () => {
    if (currentIndex < 0) {
      if (tracks.length) {
        setPlayerTrack(0, true);
      } else {
        runSearch('popular music');
      }

      return;
    }

    if (els.audio.paused) {
      els.audio.play()
        .then(() => {
          els.play.textContent = 'Ⅱ';
          els.play.setAttribute('aria-label', 'Pause');
        })
        .catch((error) => {
          console.warn('TuneWave playback error:', error);
          toast('This track could not be played. Try another track.');
        });
    } else {
      els.audio.pause();
    }
  });

  if (els.prev) {
    els.prev.addEventListener('click', playPrevious);
  }

  if (els.next) {
    els.next.addEventListener('click', playNext);
  }

  if (els.shuffle) {
    els.shuffle.addEventListener('click', () => {
      shuffleOn = !shuffleOn;

      els.shuffle.classList.toggle('on', shuffleOn);

      toast(
        shuffleOn ? 'Shuffle enabled' : 'Shuffle disabled'
      );
    });
  }

  if (els.repeat) {
    els.repeat.addEventListener('click', () => {
      repeatOn = !repeatOn;

      els.repeat.classList.toggle('on', repeatOn);

      toast(
        repeatOn ? 'Repeat enabled' : 'Repeat disabled'
      );
    });
  }

  if (els.queue) {
    els.queue.addEventListener('click', () => {
      toast(
        tracks.length
          ? `${tracks.length} songs in the current results`
          : 'Search for songs to start a queue.'
      );
    });
  }

  if (els.playerLike) {
    els.playerLike.addEventListener('click', () => {
      if (currentIndex >= 0) {
        toggleLike(tracks[currentIndex]);
      } else {
        toast('Play a song first.');
      }
    });
  }

  // ============================================================
  // Progress, volume, and audio events
  // ============================================================

  els.progress.addEventListener('input', () => {
    const duration = els.audio.duration;

    if (Number.isFinite(duration) && duration > 0) {
      const percent = Number(els.progress.value);

      els.audio.currentTime = (percent / 100) * duration;
    }

    paintRange(
      els.progress,
      Number(els.progress.value)
    );
  });

  if (els.volume) {
    els.volume.addEventListener('input', () => {
      els.audio.volume = Number(els.volume.value);

      paintRange(
        els.volume,
        Number(els.volume.value) * 100
      );
    });

    els.audio.volume = 0.8;
    paintRange(els.volume, 80);
  }

  els.audio.addEventListener('play', () => {
    els.play.textContent = 'Ⅱ';
    els.play.setAttribute('aria-label', 'Pause');
  });

  els.audio.addEventListener('pause', () => {
    els.play.textContent = '▶';
    els.play.setAttribute('aria-label', 'Play');
  });

  els.audio.addEventListener('timeupdate', () => {
    const duration = Number.isFinite(els.audio.duration)
      ? els.audio.duration
      : durationOf(tracks[currentIndex] || {});

    const percent = duration > 0
      ? (els.audio.currentTime / duration) * 100
      : 0;

    els.progress.value = String(percent);

    paintRange(els.progress, percent);

    els.currentTime.textContent =
      formatTime(els.audio.currentTime);

    els.totalTime.textContent =
      formatTime(duration);
  });

  els.audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(els.audio.duration)) {
      els.totalTime.textContent =
        formatTime(els.audio.duration);
    }
  });

  els.audio.addEventListener('ended', () => {
    if (repeatOn) {
      els.audio.currentTime = 0;

      els.audio.play().catch((error) => {
        console.warn('Could not repeat this track:', error);
      });
    } else {
      playNext();
    }
  });

  els.audio.addEventListener('error', () => {
    if (currentIndex >= 0) {
      toast(
        'This track could not be streamed. Try another track or open its source page.'
      );
    }
  });

  // ============================================================
  // Keyboard shortcuts
  // ============================================================

  document.addEventListener('keydown', (event) => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === 'k'
    ) {
      event.preventDefault();
      els.input.focus();
    }

    if (
      event.key === 'Escape' &&
      els.sidebar
    ) {
      els.sidebar.classList.remove('open');
    }
  });

  // ============================================================
  // Initial setup
  // ============================================================

  renderRecent();
  updateLikeCount();

  // Load a selection on the home page when the dashboard starts.
  runSearch('popular music', {
    fromHistory: true,
    mode: 'home'
  });
})();