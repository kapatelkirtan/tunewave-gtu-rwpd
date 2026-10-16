(() => {
  'use strict';

  // TuneWave — Jamendo full-track player
  const API = 'https://api.jamendo.com/v3.0';
  const JAMENDO_CLIENT_ID = 'c854bb26'; // Replace if this is not your valid Jamendo client ID.
  const PAGE_SIZE = 200;

  const $ = (id) => document.getElementById(id);
  const els = {
    form: $('searchForm'), input: $('searchInput'), clearSearch: $('clearSearch'),
    heroKicker: $('heroKicker'), heroTitle: $('heroTitle'), heroDescription: $('heroDescription'),
    explore: $('exploreButton'), albumGrid: $('albumGrid'), albumsHeading: $('albumsHeading'),
    seeAlbums: $('seeAlbums'), resultsHeading: $('resultsHeading'), songsEyebrow: $('songsEyebrow'),
    rows: $('songRows'), count: $('resultCount'), message: $('message'), recent: $('recentSearches'),
    clearRecent: $('clearRecent'), libraryView: $('libraryView'), libraryHeading: $('libraryHeading'),
    libraryGrid: $('libraryGrid'), likedCount: $('likedCount'), audio: $('audioPlayer'),
    playerArtwork: $('playerArtwork'), playerTitle: $('playerTitle'), playerArtist: $('playerArtist'),
    playerLike: $('playerLike'), play: $('playButton'), prev: $('previousButton'), next: $('nextButton'),
    progress: $('progress'), currentTime: $('currentTime'), totalTime: $('totalTime'), volume: $('volumeSlider'),
    shuffle: $('shuffleButton'), repeat: $('repeatButton'), queue: $('queueButton'), toast: $('toast'),
    menuToggle: $('menuToggle'), sidebar: $('sidebar')
  };

  const required = ['form', 'input', 'albumGrid', 'rows', 'message', 'audio', 'play', 'progress', 'toast'];
  const missing = required.filter((key) => !els[key]);
  if (missing.length) {
    console.error('TuneWave HTML is missing required elements:', missing);
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
  const starterQueries = ['chill', 'focus', 'electronic', 'night drive', 'feel good', 'indie pop'];

  let tracks = [];
  let albums = [];
  let currentIndex = -1;
  let currentQuery = '';
  let loadingSequence = 0;
  let nextTrackOffset = 0;
  let canLoadMore = false;
  let loadingMore = false;
  let albumExpanded = false;
  let currentView = 'home';
  let shuffleOn = false;
  let repeatOn = false;
  let toastTimeout = null;

  // ---------- Helpers ----------
  const readJSON = (key, fallback = []) => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return Array.isArray(value) ? value : fallback;
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

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };

  const durationOf = (track) => Math.round(Number(track?.duration) || (Number(track?.trackTimeMillis) || 0) / 1000);
  const getLikes = () => readJSON('tw-likes');
  const getSearches = () => readJSON('tw-searches');
  const trackKey = (track) => String(track?.trackId || track?.id || track?.collectionId || `${track?.trackName || ''}|${track?.artistName || ''}`);
  const isLiked = (track) => getLikes().some((item) => trackKey(item) === trackKey(track));
  const titleCase = (text) => String(text || '').replace(/\b\w/g, (ch) => ch.toUpperCase());

  function toast(message) {
    if (!els.toast) return;
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function paintRange(input, percent) {
    if (!input) return;
    input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
  }

  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach((button) => {
      button.classList.toggle('active', button.dataset.nav === name);
    });
    if (!['liked', 'library', 'playlists'].includes(name)) {
      if (els.libraryView) els.libraryView.hidden = true;
      const featured = $('featuredSection');
      const songs = $('songsSection');
      const recent = $('recentSection');
      if (featured) featured.hidden = false;
      if (songs) songs.hidden = false;
      if (recent) recent.hidden = false;
    }
  }

  // ---------- Jamendo API helpers ----------
  function validateClientId() {
    if (!JAMENDO_CLIENT_ID || JAMENDO_CLIENT_ID.includes('PASTE_YOUR')) {
      throw new Error('Add your valid Jamendo client ID in app.js first.');
    }
  }

  async function fetchJamendo(endpoint, params = {}) {
    validateClientId();
    const searchParams = new URLSearchParams({
      client_id: JAMENDO_CLIENT_ID,
      format: 'json',
      ...params
    });

    const response = await fetch(`${API}/${endpoint}/?${searchParams.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`Jamendo request failed (${response.status}).`);
    }

    const body = await response.json();

    if (body?.headers?.status !== 'success') {
      throw new Error(body?.headers?.error_message || 'Jamendo returned an unsuccessful response.');
    }

    return Array.isArray(body.results) ? body.results : [];
  }

  function mapTrack(item, album = {}) {
    const genres = item.musicinfo?.tags?.genres;
    const audioUrl = item.audio || '';

    return {
      ...item,
      trackId: String(item.id || item.track_id || ''),
      trackName: item.name || item.track_name || 'Untitled track',
      artistName: item.artist_name || album.artist_name || 'Unknown artist',
      collectionId: String(item.album_id || album.id || item.id || ''),
      collectionName: item.album_name || album.name || 'Single',
      artworkUrl100: item.album_image || album.image || item.image || '',
      primaryGenreName: Array.isArray(genres) && genres.length ? genres[0] : 'Independent music',
      duration: Number(item.duration) || 0,
      trackTimeMillis: (Number(item.duration) || 0) * 1000,
      audioUrl,

      // Retained for compatibility with the existing player.
      // This is the Jamendo stream URL, not an iTunes preview.
      previewUrl: audioUrl,

      trackViewUrl: item.shareurl || item.shorturl || album.shareurl || album.shorturl || '',
      licenseUrl: item.license_ccurl || ''
    };
  }

  async function apiSearch(query, limit = PAGE_SIZE, offset = 0) {
    const results = await fetchJamendo('tracks', {
      search: query,
      limit: String(limit),
      offset: String(offset),
      include: 'licenses musicinfo',
      audioformat: 'mp32',
      imagesize: '300',
      type: 'single albumtrack'
    });

    return {
      tracks: results.map((item) => mapTrack(item)).filter((track) => track.trackId),
      rawCount: results.length
    };
  }

  async function apiAlbumSearch(query, limit = 6) {
    const results = await fetchJamendo('albums', {
      namesearch: query,
      limit: String(limit),
      imagesize: '300',
      type: 'album single'
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

  // FALLBACK:
  // If the normal track search finds no results but albums match,
  // retrieve tracks belonging to matching albums.
  async function apiAlbumTrackSearch(query, limit = 10) {
    const foundAlbums = await fetchJamendo('albums/tracks', {
      namesearch: query,
      limit: String(limit),
      offset: '0',
      imagesize: '300',
      audioformat: 'mp32',
      type: 'album single'
    });

    const foundTracks = [];

    for (const album of foundAlbums) {
      const nestedTracks = Array.isArray(album.tracks) ? album.tracks : [];

      for (const item of nestedTracks) {
        const mapped = mapTrack(item, album);
        if (mapped.trackId) foundTracks.push(mapped);
      }
    }

    // Remove duplicate track IDs.
    return [...new Map(foundTracks.map((track) => [track.trackId, track])).values()];
  }

  function albumsFromTracks(trackList) {
    const unique = new Map();

    trackList.forEach((track) => {
      const id = String(track.album_id || track.collectionId || '');
      const name = String(track.album_name || track.collectionName || '');

      if (!id || !name || name === 'Single') return;

      if (!unique.has(id)) {
        unique.set(id, {
          collectionId: id,
          collectionName: name,
          artistName: track.artistName || 'Unknown artist',
          artworkUrl100: track.artworkUrl100 || '',
          trackViewUrl: track.trackViewUrl || ''
        });
      }
    });

    return Array.from(unique.values()).slice(0, 6);
  }

  // ---------- Search/history UI ----------
  function setLoading(query) {
    els.count.textContent = 'Searching…';
    els.message.classList.remove('error');
    els.message.textContent = query ? `Looking for “${query}”…` : 'Finding music for you…';
    els.rows.innerHTML = '<tr><td colspan="6" class="table-message">Finding matching songs…</td></tr>';
    els.albumGrid.innerHTML = Array(6).fill('<div class="album-skeleton"></div>').join('');
  }

  function recordSearch(query) {
    const cleaned = query.trim();
    if (!cleaned) return;

    const previous = getSearches().filter(
      (item) => typeof item === 'string' && item.toLowerCase() !== cleaned.toLowerCase()
    );

    writeJSON('tw-searches', [cleaned, ...previous].slice(0, 8));
    renderRecent();
  }

  function updateResultCount() {
    els.count.textContent = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
  }

  async function runSearch(query, { fromHistory = false, mode = 'search' } = {}) {
    const clean = String(query || '').trim();

    if (!clean) {
      toast('Type a song, artist, album or mood first.');
      els.input.focus();
      return;
    }

    const requestNo = ++loadingSequence;

    currentQuery = clean;
    currentView = mode === 'home' ? 'home' : 'search';

    nextTrackOffset = 0;
    canLoadMore = false;
    loadingMore = false;
    tracks = [];
    albums = [];

    els.input.value = clean;
    els.clearSearch.hidden = false;

    if (els.libraryView) els.libraryView.hidden = true;

    const featured = $('featuredSection');
    const songsSection = $('songsSection');
    const recentSection = $('recentSection');

    if (featured) featured.hidden = false;
    if (songsSection) songsSection.hidden = false;
    if (recentSection) recentSection.hidden = false;

    if (currentView === 'home') {
      els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';
      els.heroTitle.innerHTML = 'Discover<br><span>New Music</span>';
      els.heroDescription.textContent = 'Find your next favorite independent song, artist or album.';
      els.albumsHeading.textContent = 'Featured Albums';
      els.resultsHeading.textContent = 'Popular Songs';
      els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";
      setActiveNav('home');
    } else {
      els.heroKicker.textContent = 'MUSIC DISCOVERY';
      els.heroTitle.innerHTML = `Search<br><span>${esc(clean)}</span>`;
      els.heroDescription.textContent = 'Explore matching independent songs, artists and albums.';
      els.albumsHeading.textContent = 'Matching Albums';
      els.resultsHeading.textContent = `Songs for “${clean}”`;
      els.songsEyebrow.textContent = 'MATCHED TO YOUR SEARCH';
      setActiveNav('search');
    }

    setLoading(clean);

    if (!fromHistory) recordSearch(clean);

    try {
      const [songResult, albumResult] = await Promise.allSettled([
        apiSearch(clean, PAGE_SIZE, 0),
        apiAlbumSearch(clean, 6)
      ]);

      if (requestNo !== loadingSequence) return;
      if (songResult.status === 'rejected') throw songResult.reason;

      tracks = songResult.value.tracks;
      nextTrackOffset = songResult.value.rawCount;
      canLoadMore = songResult.value.rawCount === PAGE_SIZE;

      const matchedAlbums = albumResult.status === 'fulfilled'
        ? albumResult.value
        : [];

      albums = matchedAlbums;

      // Key fix for searches where album cards appear but song results are zero.
      if (tracks.length === 0 && matchedAlbums.length > 0) {
        els.message.textContent = 'Finding songs inside matching albums…';

        try {
          tracks = await apiAlbumTrackSearch(clean, 10);
        } catch (fallbackError) {
          console.warn('TuneWave album-track fallback failed:', fallbackError);
          tracks = [];
        }

        if (requestNo !== loadingSequence) return;

        // These results came from the album endpoint, not the regular
        // track-search page, so turn off the regular track pagination.
        nextTrackOffset = 0;
        canLoadMore = false;
      }

      if (!albums.length) albums = albumsFromTracks(tracks);

      renderAlbums();
      renderTracks();
      updateResultCount();

      if (tracks.length) {
        els.message.textContent = currentView === 'home'
          ? 'Explore the results or search for an artist, song, album or mood.'
          : `Showing available music results for “${clean}”. Select play to stream a track.`;

        els.message.classList.remove('error');
      } else {
        els.message.textContent =
          `No tracks found for “${clean}”. Try another spelling, song title, artist or genre.`;

        els.message.classList.remove('error');
      }

      if (albumResult.status === 'rejected') {
        console.warn('TuneWave album search failed:', albumResult.reason);
      }
    } catch (error) {
      if (requestNo !== loadingSequence) return;

      tracks = [];
      albums = [];
      nextTrackOffset = 0;
      canLoadMore = false;

      renderAlbums();
      renderTracks();

      els.count.textContent = 'Search unavailable';
      els.message.textContent = error instanceof Error
        ? error.message
        : 'Could not load music. Please try again.';

      els.message.classList.add('error');
      console.error('TuneWave search error:', error);
    }
  }

  // ---------- Load more songs ----------
  async function loadMoreTracks() {
    if (loadingMore || !canLoadMore || !currentQuery) return;

    const requestNo = loadingSequence;
    loadingMore = true;
    renderTracks();

    try {
      const page = await apiSearch(currentQuery, PAGE_SIZE, nextTrackOffset);

      if (requestNo !== loadingSequence) return;

      const existing = new Set(tracks.map(trackKey));
      const newTracks = page.tracks.filter((track) => !existing.has(trackKey(track)));

      tracks = [...tracks, ...newTracks];
      nextTrackOffset += page.rawCount;
      canLoadMore = page.rawCount === PAGE_SIZE;

      renderTracks();
      updateResultCount();

      if (newTracks.length) {
        toast(`Loaded ${newTracks.length} more songs`);
      } else if (page.rawCount === 0) {
        toast('No more matching songs were found.');
      } else {
        toast('No new unique tracks on this page.');
      }
    } catch (error) {
      console.error('TuneWave pagination failed:', error);
      toast(error instanceof Error ? error.message : 'Could not load more songs.');
    } finally {
      if (requestNo === loadingSequence) {
        loadingMore = false;
        renderTracks();
      }
    }
  }

  // ---------- Album cards ----------
  function renderAlbums() {
    if (albums.length) {
      const shown = albumExpanded ? albums : albums.slice(0, 6);

      els.albumGrid.innerHTML = shown.map((album, index) => {
        const art = album.artworkUrl100 || '';
        const gradient = gradients[index % gradients.length];

        return `<button type="button" class="album-card" data-album-index="${index}" aria-label="Search for album ${esc(album.collectionName || 'album')}">
          ${art
            ? `<img class="album-art" src="${esc(art)}" alt="" loading="lazy" onerror="this.style.display='none'">`
            : `<span class="album-art album-art-fallback" style="--card-gradient:${gradient}">${symbols[index % symbols.length]}</span>`}
          <span class="album-title">${esc(album.collectionName || 'Untitled album')}</span>
          <span class="album-subtitle">${esc(album.artistName || 'Various artists')}</span>
        </button>`;
      }).join('');

      els.albumsHeading.textContent = currentView === 'home'
        ? 'Featured Albums'
        : 'Matching Albums';
    } else {
      const cards = currentView === 'home' ? starterQueries : starterQueries.slice(0, 3);

      els.albumGrid.innerHTML = cards.map((name, index) => `<button type="button" class="album-card" data-playlist-query="${esc(name)}">
        <span class="album-art album-art-fallback" style="--card-gradient:${gradients[index % gradients.length]}">${symbols[index % symbols.length]}</span>
        <span class="album-title">${esc(titleCase(name))}</span>
        <span class="album-subtitle">Explore the vibe</span>
      </button>`).join('');

      els.albumsHeading.textContent = currentView === 'home'
        ? 'Explore Music'
        : 'Try another mood';
    }

    if (els.seeAlbums) {
      els.seeAlbums.textContent = albumExpanded ? 'Show less  ‹' : 'See all  ›';
    }
  }

  // ---------- Song rows ----------
  function renderTracks() {
    if (!tracks.length) {
      els.rows.innerHTML = `<tr><td colspan="6" class="table-message">${
        currentView === 'liked'
          ? 'You have not liked any songs yet.'
          : 'No songs to display yet. Try searching above.'
      }</td></tr>`;
      return;
    }

    const html = tracks.map((track, index) => {
      const artwork = track.artworkUrl100 || '/icon-192.png';
      const liked = isLiked(track);

      return `<tr data-track-index="${index}">
        <td>
          <span class="row-number">${index + 1}</span>
          <button type="button" class="row-play" data-play-index="${index}" aria-label="Play ${esc(track.trackName)}">▶</button>
        </td>
        <td>
          <div class="track-cell">
            <img class="track-art" src="${esc(artwork)}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/icon-192.png'">
            <div class="track-info">
              <span class="track-name">${esc(track.trackName || 'Untitled track')}</span>
              <span class="track-subname">${esc(track.primaryGenreName || 'Independent music')}</span>
            </div>
          </div>
        </td>
        <td class="ellipsis-cell" title="${esc(track.artistName)}">${esc(track.artistName || 'Unknown artist')}</td>
        <td class="ellipsis-cell" title="${esc(track.collectionName)}">${esc(track.collectionName || 'Single')}</td>
        <td class="duration-cell">${formatTime(durationOf(track))}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="row-like ${liked ? 'liked' : ''}" data-like-index="${index}" aria-label="${liked ? 'Unlike' : 'Like'} ${esc(track.trackName)}">${liked ? '♥' : '♡'}</button>
            <button type="button" class="row-open" data-open-index="${index}" aria-label="Open track source">⋮</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const moreRow = canLoadMore
      ? `<tr class="load-more-row"><td colspan="6" style="text-align:center;padding:20px">
          <button type="button" class="load-more-button" data-load-more="true" ${loadingMore ? 'disabled' : ''} style="border:1px solid rgba(255,255,255,.2);border-radius:24px;padding:10px 22px;color:inherit;background:rgba(255,255,255,.08);cursor:pointer">
            ${loadingMore ? 'Loading more songs…' : 'Load more songs ↓'}
          </button>
        </td></tr>`
      : '';

    els.rows.innerHTML = html + moreRow;
  }

  // ---------- Recent searches ----------
  function renderRecent() {
    if (!els.recent) return;

    const items = getSearches().filter((item) => typeof item === 'string');

    if (!items.length) {
      els.recent.innerHTML = '<span class="recent-empty">Your searches will appear here.</span>';
      return;
    }

    els.recent.innerHTML = items.map((query) =>
      `<button class="recent-chip" type="button" data-recent-query="${esc(query)}">⌕ &nbsp;${esc(query)}</button>`
    ).join('');
  }

  // ---------- Library and likes ----------
  function updateLikeCount() {
    if (els.likedCount) els.likedCount.textContent = String(getLikes().length);
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

    els.libraryHeading.textContent = kind === 'liked'
      ? 'Liked Songs'
      : kind === 'playlists'
        ? 'Playlists & Mixes'
        : 'Your Library';

    const saved = kind === 'liked' || kind === 'library' ? getLikes() : [];

    if (kind === 'playlists') {
      els.libraryGrid.innerHTML = starterQueries.map((name, index) => `<button type="button" class="album-card" data-playlist-query="${esc(name)}">
        <span class="album-art album-art-fallback" style="--card-gradient:${gradients[index % gradients.length]}">${symbols[index % symbols.length]}</span>
        <span class="album-title">${esc(titleCase(name))}</span>
        <span class="album-subtitle">Search this mood</span>
      </button>`).join('');
    } else if (saved.length) {
      els.libraryGrid.innerHTML = saved.map((track, index) => `<button type="button" class="album-card" data-library-index="${index}">
        <img class="album-art" src="${esc(track.artworkUrl100 || '/icon-192.png')}" alt="" loading="lazy" onerror="this.onerror=null;this.src='/icon-192.png'">
        <span class="album-title">${esc(track.trackName || track.collectionName || 'Saved song')}</span>
        <span class="album-subtitle">${esc(track.artistName || 'Unknown artist')}</span>
      </button>`).join('');
    } else {
      els.libraryGrid.innerHTML = `<div class="library-empty">${
        kind === 'liked'
          ? 'Your liked songs will appear here. Tap ♡ beside any song to save it.'
          : 'Your personal collection will appear here when you like songs.'
      }</div>`;
    }

    setActiveNav(kind);
  }

  function toggleLike(track) {
    if (!track) return;

    let saved = getLikes();
    const key = trackKey(track);

    if (saved.some((item) => trackKey(item) === key)) {
      saved = saved.filter((item) => trackKey(item) !== key);
      toast('Removed from Liked Songs');
    } else {
      saved.unshift(track);
      saved = saved.slice(0, 100);
      toast('Added to Liked Songs');
    }

    writeJSON('tw-likes', saved);
    updateLikeCount();
    renderTracks();

    if (currentIndex >= 0 && tracks[currentIndex] && trackKey(tracks[currentIndex]) === key && els.playerLike) {
      const liked = isLiked(tracks[currentIndex]);
      els.playerLike.classList.toggle('liked', liked);
      els.playerLike.textContent = liked ? '♥' : '♡';
    }

    if (currentView === 'liked') renderLibrary('liked');
  }

  // ---------- Playback ----------
  function setPlayerTrack(index, autoplay = true) {
    if (!tracks.length || index < 0 || index >= tracks.length) return;

    currentIndex = index;
    const track = tracks[index];

    els.playerArtwork.src = track.artworkUrl100 || '/icon-192.png';
    els.playerArtwork.alt = `${track.trackName || 'Track'} artwork`;
    els.playerTitle.textContent = track.trackName || 'Unknown track';
    els.playerArtist.textContent = track.artistName || 'Unknown artist';
    els.totalTime.textContent = formatTime(durationOf(track));
    els.progress.value = '0';
    paintRange(els.progress, 0);
    els.currentTime.textContent = '0:00';

    if (els.playerLike) {
      const liked = isLiked(track);
      els.playerLike.classList.toggle('liked', liked);
      els.playerLike.textContent = liked ? '♥' : '♡';
    }

    const audioUrl = track.audioUrl || track.previewUrl || '';

    if (!audioUrl) {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.audio.load();
      els.play.textContent = '▶';
      toast('Audio is unavailable for this track. Open its source page instead.');

      if (track.trackViewUrl) {
        window.open(track.trackViewUrl, '_blank', 'noopener,noreferrer');
      }

      return;
    }

    els.audio.pause();
    els.audio.src = audioUrl;
    els.audio.load();

    if (autoplay) {
      els.audio.play().then(() => {
        els.play.textContent = 'Ⅱ';
        els.play.setAttribute('aria-label', 'Pause');
      }).catch((error) => {
        console.warn('TuneWave playback error:', error);
        els.play.textContent = '▶';
        toast('Could not start this track. Try again or choose another track.');
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

    setPlayerTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
  }

  function openTrackSource(track) {
    if (!track) return;

    const url = track.trackViewUrl || track.licenseUrl || '';

    if (!url) {
      toast('Track source details are not available.');
      return;
    }

    window.open(url, '_blank', 'noopener,noreferrer');
  }

  // ---------- Search and dashboard events ----------
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
    runSearch(els.input.value.trim() || 'electronic');
  });

  if (els.menuToggle && els.sidebar) {
    els.menuToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
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

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;

    if (button.dataset.loadMore != null) {
      loadMoreTracks();
      return;
    }

    if (button.dataset.playIndex != null) {
      setPlayerTrack(Number(button.dataset.playIndex), true);
      return;
    }

    if (button.dataset.likeIndex != null) {
      toggleLike(tracks[Number(button.dataset.likeIndex)]);
      return;
    }

    if (button.dataset.openIndex != null) {
      openTrackSource(tracks[Number(button.dataset.openIndex)]);
      return;
    }

    if (button.dataset.albumIndex != null) {
      const album = albums[Number(button.dataset.albumIndex)];

      if (album) {
        runSearch(album.collectionName || album.artistName || currentQuery || 'independent music');
      }
      return;
    }

    if (button.dataset.recentQuery) {
      runSearch(button.dataset.recentQuery, { fromHistory: true });
      return;
    }

    if (button.dataset.playlistQuery) {
      runSearch(button.dataset.playlistQuery);
      if (els.sidebar) els.sidebar.classList.remove('open');
      return;
    }

    if (button.dataset.libraryIndex != null) {
      const saved = getLikes();
      const chosen = saved[Number(button.dataset.libraryIndex)];
      if (!chosen) return;

      const key = trackKey(chosen);

      runSearch(chosen.trackName || chosen.artistName || 'independent music').then(() => {
        const index = tracks.findIndex((track) => trackKey(track) === key);

        if (index >= 0) {
          setPlayerTrack(index, true);
        } else {
          toast('Saved track was not found in these results. Search for it again.');
        }
      });
    }
  });

  // ---------- Navigation ----------
  document.querySelectorAll('[data-nav]').forEach((button) => {
    button.addEventListener('click', () => {
      const nav = button.dataset.nav;
      if (els.sidebar) els.sidebar.classList.remove('open');

      if (nav === 'home') {
        els.input.value = '';
        els.clearSearch.hidden = true;
        els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';
        els.heroTitle.innerHTML = 'Discover<br><span>New Music</span>';
        els.heroDescription.textContent = 'Find your next favorite song, artist or album.';
        els.albumsHeading.textContent = 'Featured Albums';
        els.resultsHeading.textContent = 'Popular Songs';
        els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";
        setActiveNav('home');
        runSearch('popular music', { fromHistory: true, mode: 'home' });
      } else if (nav === 'search') {
        setActiveNav('search');
        els.input.focus();
        if (els.input.value.trim()) runSearch(els.input.value);
      } else {
        renderLibrary(nav);
      }
    });
  });

  // ---------- Player controls ----------
  els.play.addEventListener('click', () => {
    if (currentIndex < 0) {
      if (tracks.length) setPlayerTrack(0, true);
      else runSearch('popular music');
      return;
    }

    if (els.audio.paused) {
      els.audio.play().then(() => {
        els.play.textContent = 'Ⅱ';
        els.play.setAttribute('aria-label', 'Pause');
      }).catch((error) => {
        console.warn('TuneWave playback error:', error);
        toast('This track could not be played. Try another track.');
      });
    } else {
      els.audio.pause();
    }
  });

  if (els.prev) els.prev.addEventListener('click', playPrevious);
  if (els.next) els.next.addEventListener('click', playNext);

  if (els.shuffle) {
    els.shuffle.addEventListener('click', () => {
      shuffleOn = !shuffleOn;
      els.shuffle.classList.toggle('on', shuffleOn);
      toast(shuffleOn ? 'Shuffle enabled' : 'Shuffle disabled');
    });
  }

  if (els.repeat) {
    els.repeat.addEventListener('click', () => {
      repeatOn = !repeatOn;
      els.repeat.classList.toggle('on', repeatOn);
      toast(repeatOn ? 'Repeat enabled' : 'Repeat disabled');
    });
  }

  if (els.queue) {
    els.queue.addEventListener('click', () => {
      toast(tracks.length ? `${tracks.length} songs in the current results` : 'Search for songs to start a queue.');
    });
  }

  if (els.playerLike) {
    els.playerLike.addEventListener('click', () => {
      if (currentIndex >= 0) toggleLike(tracks[currentIndex]);
      else toast('Play a song first.');
    });
  }

  els.progress.addEventListener('input', () => {
    const duration = els.audio.duration;

    if (Number.isFinite(duration) && duration > 0) {
      els.audio.currentTime = Number(els.progress.value) / 100 * duration;
    }

    paintRange(els.progress, Number(els.progress.value));
  });

  if (els.volume) {
    els.volume.addEventListener('input', () => {
      els.audio.volume = Number(els.volume.value);
      paintRange(els.volume, Number(els.volume.value) * 100);
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

    const percent = duration > 0 ? els.audio.currentTime / duration * 100 : 0;

    els.progress.value = String(percent);
    paintRange(els.progress, percent);
    els.currentTime.textContent = formatTime(els.audio.currentTime);
    els.totalTime.textContent = formatTime(duration);
  });

  els.audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(els.audio.duration)) {
      els.totalTime.textContent = formatTime(els.audio.duration);
    }
  });

  els.audio.addEventListener('ended', () => {
    if (repeatOn) {
      els.audio.currentTime = 0;
      els.audio.play().catch((error) => console.warn('Repeat failed:', error));
    } else {
      playNext();
    }
  });

  els.audio.addEventListener('error', () => {
    if (currentIndex >= 0) toast('This track is unavailable. Try another track.');
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      els.input.focus();
    }

    if (event.key === 'Escape' && els.sidebar) {
      els.sidebar.classList.remove('open');
    }
  });

  // ---------- Startup ----------
  renderRecent();
  updateLikeCount();
  runSearch('popular music', { fromHistory: true, mode: 'home' });
})();