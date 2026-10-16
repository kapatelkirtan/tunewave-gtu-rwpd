(() => {
  'use strict';

  const API = 'https://api.jamendo.com/v3.0/tracks/';
  // Create a Jamendo developer app and paste its client_id here before deploying.
  const JAMENDO_CLIENT_ID = c854bb26;
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
    progress: $('progress'), currentTime: $('currentTime'), totalTime: $('totalTime'),
    volume: $('volumeSlider'), shuffle: $('shuffleButton'), repeat: $('repeatButton'),
    queue: $('queueButton'), toast: $('toast'), menuToggle: $('menuToggle'), sidebar: $('sidebar'),
    seeAll: $('seeAlbums'),
  };

  const gradients = [
    'linear-gradient(145deg,#ff8e9e,#5e28db)',
    'linear-gradient(145deg,#ffb36d,#9e2bd1)',
    'linear-gradient(145deg,#23d6e8,#302db6)',
    'linear-gradient(145deg,#ad41ff,#f64b9b)',
    'linear-gradient(145deg,#ffd277,#ec4d8e)',
    'linear-gradient(145deg,#4377ed,#34dbcf)',
  ];
  const symbols = ['☼', '◈', '♫', '✦', '☾', '♬'];
  const starterQueries = ['chill vibes', 'focus music', 'bollywood hits', 'night drive', 'feel good music', 'indie pop'];
  let tracks = [];
  let albums = [];
  let currentIndex = -1;
  let currentQuery = '';
  let loadingSequence = 0;
  let toastTimer = null;
  let albumExpanded = false;
  let currentView = 'home';
  let shuffleOn = false;
  let repeatOn = false;
  let toastTimeout = null;

  const readJSON = (key, fallback = []) => {
    try { const data = JSON.parse(localStorage.getItem(key) || 'null'); return Array.isArray(data) ? data : fallback; }
    catch { return fallback; }
  };
  const writeJSON = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage is optional */ } };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  };
  const durationOf = (track) => Math.round(track.duration || (track.trackTimeMillis || 0) / 1000);
  const getArtwork = (url, size = 300) => (url || '').replace(/\d+x\d+bb\.(jpg|png|jpeg)$/i, `${size}x${size}bb.$1`);
  const getLikes = () => readJSON('tw-likes');
  const getSearches = () => readJSON('tw-searches');
  const trackKey = (t) => String(t.trackId || t.id || t.collectionId || `${t.trackName}|${t.artistName}`);
  const isLiked = (track) => getLikes().some(item => trackKey(item) === trackKey(track));

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  async function apiSearch(query, entity, limit) {
    if (!JAMENDO_CLIENT_ID || JAMENDO_CLIENT_ID.includes('PASTE_YOUR')) {
      throw new Error('Add your Jamendo client ID in app.js to enable full-track music search.');
    }
    const params = new URLSearchParams({
      client_id: JAMENDO_CLIENT_ID, format: 'json', limit: String(limit),
      search: query, include: 'licenses', audioformat: 'mp32',
      // Request both singles and album tracks; the API returns full stream URLs.
      type: 'single albumtrack'
    });
    const response = await fetch(`${API}?${params.toString()}`, {headers: {Accept: 'application/json'}});
    if (!response.ok) throw new Error(`Music search is temporarily unavailable (${response.status}).`);
    const body = await response.json();
    if (body.headers?.status !== 'success') throw new Error(body.headers?.error_message || 'Jamendo could not return music results.');
    const results = Array.isArray(body.results) ? body.results : [];
    return results.map(item => ({
      ...item,
      trackId: item.id,
      trackName: item.name,
      artistName: item.artist_name,
      collectionId: item.album_id || item.id,
      collectionName: item.album_name || item.name,
      artworkUrl100: item.album_image || item.image,
      primaryGenreName: item.musicinfo?.tags?.genres?.[0] || 'Independent music',
      trackTimeMillis: (item.duration || 0) * 1000,
      previewUrl: item.audio,
      trackViewUrl: item.shareurl || item.shorturl,
      licenseUrl: item.license_ccurl || '',
      audioUrl: item.audio
    }));
  }

  function setLoading(query) {
    els.count.textContent = 'Searching…';
    els.message.classList.remove('error');
    els.message.textContent = query ? `Looking for “${query}”…` : 'Finding music for you…';
    els.rows.innerHTML = '<tr><td colspan="6" class="table-message">Finding matching songs…</td></tr>';
    els.albumGrid.innerHTML = '<div class="album-skeleton"></div><div class="album-skeleton"></div><div class="album-skeleton"></div><div class="album-skeleton"></div><div class="album-skeleton"></div><div class="album-skeleton"></div>';
  }

  function recordSearch(query) {
    const cleaned = query.trim();
    if (!cleaned) return;
    const previous = getSearches().filter(item => typeof item === 'string' && item.toLowerCase() !== cleaned.toLowerCase());
    writeJSON('tw-searches', [cleaned, ...previous].slice(0, 8));
    renderRecent();
  }

  async function runSearch(query, {fromHistory = false, mode = 'search'} = {}) {
    const clean = query.trim();
    if (!clean) { toast('Type a song, artist, album or mood first.'); els.input.focus(); return; }
    const requestNo = ++loadingSequence;
    currentQuery = clean;
    currentView = mode === 'home' ? 'home' : 'search';
    els.input.value = clean;
    els.clearSearch.hidden = false;
    els.libraryView.hidden = true;
    $('featuredSection').hidden = false;
    $('songsSection').hidden = false;
    $('recentSection').hidden = false;
    if (currentView === 'home') {
      els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';
      els.heroTitle.innerHTML = 'Discover<br><span>New Music</span>';
      els.heroDescription.textContent = 'Find your next favorite song, artist or album.';
      els.albumsHeading.textContent = 'Featured Albums';
      els.resultsHeading.textContent = 'Popular Songs';
      els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";
      setActiveNav('home');
    } else {
      els.heroKicker.textContent = 'MUSIC DISCOVERY';
      els.heroTitle.innerHTML = `Search<br><span>${esc(clean)}</span>`;
      els.heroDescription.textContent = 'Explore matching songs, artists and albums.';
      els.albumsHeading.textContent = 'Matching Albums';
      els.resultsHeading.textContent = `Songs for “${clean}”`;
      els.songsEyebrow.textContent = 'MATCHED TO YOUR SEARCH';
      setActiveNav('search');
    }
    setLoading(clean);
    if (!fromHistory) recordSearch(clean);
    try {
      const [songResults, albumResults] = await Promise.all([
        apiSearch(clean, 'song', 30),
        apiSearch(clean, 'album', 6),
      ]);
      if (requestNo !== loadingSequence) return;
      tracks = songResults.filter(item => item.wrapperType === 'track' || item.kind === 'song');
      albums = albumResults.filter(item => item.collectionId || item.collectionName);
      renderAlbums();
      renderTracks();
      els.count.textContent = `${tracks.length} ${tracks.length === 1 ? 'song' : 'songs'}`;
      if (tracks.length) {
        els.message.textContent = currentView === 'home'
          ? 'Explore the current popular search, or search above for a specific song, artist or album.'
          : `Showing music results for “${clean}”. Select a play button to stream the full available track.`;
      } else {
        els.message.textContent = `No tracks found for “${clean}”. Try a different spelling or search term.`;
      }
      els.message.classList.remove('error');
    } catch (error) {
      if (requestNo !== loadingSequence) return;
      tracks = [];
      albums = [];
      renderAlbums();
      renderTracks();
      els.count.textContent = 'Search unavailable';
      els.message.textContent = `${error instanceof Error ? error.message : 'Could not load music right now.'} Please try again in a moment.`;
      els.message.classList.add('error');
    }
  }

  function renderAlbums() {
    if (albums.length) {
      const shown = albumExpanded ? albums : albums.slice(0, 6);
      els.albumGrid.innerHTML = shown.map((album, index) => {
        const art = getArtwork(album.artworkUrl100 || '', 300);
        const gradient = gradients[index % gradients.length];
        return `<button type="button" class="album-card" data-album-index="${index}" aria-label="Search for album ${esc(album.collectionName || 'album')}">
          ${art ? `<img class="album-art" src="${esc(art)}" alt="" loading="lazy" onerror="this.outerHTML='<span class=&quot;album-art album-art-fallback&quot; style=&quot;--card-gradient:${gradient}&quot;>♫</span>'">` : `<span class="album-art album-art-fallback" style="--card-gradient:${gradient}">${symbols[index % symbols.length]}</span>`}
          <span class="album-title">${esc(album.collectionName || 'Untitled album')}</span><span class="album-subtitle">${esc(album.artistName || 'Various artists')}</span></button>`;
      }).join('');
      els.albumsHeading.textContent = currentView === 'home' ? 'Featured Albums' : 'Matching Albums';
    } else {
      const cards = currentView === 'home' ? starterQueries : starterQueries.slice(0, 3);
      els.albumGrid.innerHTML = cards.map((name, index) => `<button type="button" class="album-card" data-playlist-query="${esc(name)}"><span class="album-art album-art-fallback" style="--card-gradient:${gradients[index % gradients.length]}">${symbols[index % symbols.length]}</span><span class="album-title">${esc(titleCase(name))}</span><span class="album-subtitle">Explore the vibe</span></button>`).join('');
      els.albumsHeading.textContent = currentView === 'home' ? 'Featured Mixes' : 'Try another mood';
    }
    els.seeAll.textContent = albumExpanded ? 'Show less  ‹' : 'See all  ›';
  }

  function titleCase(text) { return text.replace(/\b\w/g, c => c.toUpperCase()); }

  function renderTracks() {
    if (!tracks.length) {
      els.rows.innerHTML = `<tr><td colspan="6" class="table-message">${currentView === 'liked' ? 'You have not liked any songs yet.' : 'No songs to display yet. Try searching for a song or artist above.'}</td></tr>`;
      return;
    }
    els.rows.innerHTML = tracks.map((track, index) => {
      const artwork = getArtwork(track.artworkUrl100 || '', 100) || '/icon-192.png';
      const duration = durationOf(track);
      return `<tr data-track-index="${index}">
        <td><span class="row-number">${index + 1}</span><button type="button" class="row-play" data-play-index="${index}" aria-label="Play ${esc(track.trackName)}">▶</button></td>
        <td><div class="track-cell"><img class="track-art" src="${esc(artwork)}" alt="" loading="lazy"><div class="track-info"><span class="track-name">${esc(track.trackName || 'Untitled track')}</span><span class="track-subname">${esc(track.primaryGenreName || 'Music')}</span></div></div></td>
        <td class="ellipsis-cell" title="${esc(track.artistName)}">${esc(track.artistName || 'Unknown artist')}</td>
        <td class="ellipsis-cell" title="${esc(track.collectionName)}">${esc(track.collectionName || 'Single')}</td>
        <td class="duration-cell">${formatTime(duration)}</td>
        <td><div class="row-actions"><button type="button" class="row-like ${isLiked(track) ? 'liked' : ''}" data-like-index="${index}" aria-label="${isLiked(track) ? 'Unlike' : 'Like'} ${esc(track.trackName)}">${isLiked(track) ? '♥' : '♡'}</button><button type="button" class="row-open" data-open-index="${index}" aria-label="Open ${esc(track.trackName)}">⋮</button></div></td>
      </tr>`;
    }).join('');
  }

  function renderRecent() {
    const items = getSearches().filter(item => typeof item === 'string');
    if (!items.length) {
      els.recent.innerHTML = '<span class="recent-empty">Your searches will appear here.</span>';
      return;
    }
    els.recent.innerHTML = items.map(query => `<button class="recent-chip" type="button" data-recent-query="${esc(query)}">⌕ &nbsp;${esc(query)}</button>`).join('');
  }

  function updateLikeCount() { els.likedCount.textContent = String(getLikes().length); }

  function renderLibrary(kind) {
    currentView = kind;
    els.libraryView.hidden = false;
    $('featuredSection').hidden = true;
    $('songsSection').hidden = true;
    $('recentSection').hidden = true;
    els.libraryHeading.textContent = kind === 'liked' ? 'Liked Songs' : kind === 'playlists' ? 'Playlists & Mixes' : 'Your Library';
    const items = kind === 'liked' ? getLikes() : kind === 'library' ? getLikes() : [];
    if (kind === 'playlists') {
      els.libraryGrid.innerHTML = starterQueries.map((name, index) => `<button type="button" class="album-card" data-playlist-query="${esc(name)}"><span class="album-art album-art-fallback" style="--card-gradient:${gradients[index % gradients.length]}">${symbols[index % symbols.length]}</span><span class="album-title">${titleCase(name)}</span><span class="album-subtitle">Search this mood</span></button>`).join('');
    } else if (items.length) {
      els.libraryGrid.innerHTML = items.map((track, index) => {
        const art = getArtwork(track.artworkUrl100 || '', 300) || '/icon-192.png';
        return `<button type="button" class="album-card" data-library-index="${index}"><img class="album-art" src="${esc(art)}" alt="" loading="lazy"><span class="album-title">${esc(track.trackName || track.collectionName || 'Saved song')}</span><span class="album-subtitle">${esc(track.artistName || 'Unknown artist')}</span></button>`;
      }).join('');
    } else {
      els.libraryGrid.innerHTML = `<div class="library-empty">${kind === 'liked' ? 'Your liked songs will appear here. Tap ♡ beside any song to save it.' : 'Your personal collection will appear here when you like songs.'}</div>`;
    }
    setActiveNav(kind);
  }

  function setActiveNav(name) {
    document.querySelectorAll('[data-nav]').forEach(button => button.classList.toggle('active', button.dataset.nav === name || (name === 'home' && button.dataset.nav === 'home')));
    if (name !== 'liked' && name !== 'library' && name !== 'playlists') {
      els.libraryView.hidden = true;
      $('featuredSection').hidden = false;
      $('songsSection').hidden = false;
      $('recentSection').hidden = false;
    }
  }

  function setPlayerTrack(index, autoplay = true) {
    if (!tracks.length || index < 0 || index >= tracks.length) return;
    currentIndex = index;
    const track = tracks[index];
    const art = getArtwork(track.artworkUrl100 || '', 300) || '/icon-192.png';
    els.playerArtwork.src = art;
    els.playerTitle.textContent = track.trackName || 'Unknown track';
    els.playerArtist.textContent = track.artistName || 'Unknown artist';
    els.totalTime.textContent = formatTime(durationOf(track) || 30);
    els.progress.value = '0';
    paintRange(els.progress, 0);
    els.currentTime.textContent = '0:00';
    els.playerLike.classList.toggle('liked', isLiked(track));
    els.playerLike.textContent = isLiked(track) ? '♥' : '♡';

    if (!track.previewUrl) {
      els.audio.pause();
      els.audio.removeAttribute('src');
      els.play.textContent = '▶';
      toast('Full-track audio is unavailable for this track. Open its source page instead.');
      if (track.trackViewUrl) window.open(track.trackViewUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    if (els.audio.src !== track.previewUrl) els.audio.src = track.previewUrl;
    els.audio.load();
    if (autoplay) {
      const result = els.audio.play();
      if (result && typeof result.then === 'function') result.then(() => { els.play.textContent = 'Ⅱ'; }).catch(() => {
        els.play.textContent = '▶';
        toast('Tap play again to start this track.');
      });
    }
    els.play.setAttribute('aria-label', autoplay ? 'Pause' : 'Play');
    if (!autoplay) els.play.textContent = '▶';
  }

  function toggleLike(track) {
    if (!track) return;
    let liked = getLikes();
    const key = trackKey(track);
    if (liked.some(item => trackKey(item) === key)) {
      liked = liked.filter(item => trackKey(item) !== key);
      toast('Removed from Liked Songs');
    } else {
      liked.unshift(track);
      liked = liked.slice(0, 100);
      toast('Added to Liked Songs');
    }
    writeJSON('tw-likes', liked);
    updateLikeCount();
    renderTracks();
    if (currentIndex >= 0 && tracks[currentIndex] && trackKey(tracks[currentIndex]) === key) {
      const status = isLiked(tracks[currentIndex]);
      els.playerLike.classList.toggle('liked', status);
      els.playerLike.textContent = status ? '♥' : '♡';
    }
    if (currentView === 'liked') renderLibrary('liked');
  }

  function paintRange(input, percent) {
    input.style.setProperty('--range-progress', `${Math.max(0, Math.min(100, percent))}%`);
  }

  function playNext() {
    if (!tracks.length) return;
    let next;
    if (shuffleOn && tracks.length > 1) {
      do { next = Math.floor(Math.random() * tracks.length); } while (next === currentIndex);
    } else next = (currentIndex + 1) % tracks.length;
    setPlayerTrack(next, true);
  }
  function playPrevious() {
    if (!tracks.length) return;
    if (els.audio.currentTime > 3) { els.audio.currentTime = 0; return; }
    setPlayerTrack((currentIndex - 1 + tracks.length) % tracks.length, true);
  }

  els.form.addEventListener('submit', event => { event.preventDefault(); runSearch(els.input.value); });
  els.input.addEventListener('input', () => { els.clearSearch.hidden = !els.input.value; });
  els.clearSearch.addEventListener('click', () => { els.input.value = ''; els.clearSearch.hidden = true; els.input.focus(); });
  els.explore.addEventListener('click', () => { els.input.focus(); if (els.input.value.trim()) runSearch(els.input.value); else runSearch('new music'); });
  els.menuToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
  els.seeAlbums.addEventListener('click', () => { albumExpanded = !albumExpanded; renderAlbums(); });
  els.clearRecent.addEventListener('click', () => { writeJSON('tw-searches', []); renderRecent(); toast('Recent searches cleared'); });

  document.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.playIndex != null) { setPlayerTrack(Number(target.dataset.playIndex), true); return; }
    if (target.dataset.likeIndex != null) { toggleLike(tracks[Number(target.dataset.likeIndex)]); return; }
    if (target.dataset.openIndex != null) {
      const track = tracks[Number(target.dataset.openIndex)];
      if (track?.trackViewUrl) window.open(track.trackViewUrl, '_blank', 'noopener,noreferrer');
      else toast('Track details are not available.');
      return;
    }
    if (target.dataset.albumIndex != null) {
      const album = albums[Number(target.dataset.albumIndex)];
      if (album) runSearch(album.collectionName || album.artistName || currentQuery || 'music');
      return;
    }
    if (target.dataset.recentQuery) { runSearch(target.dataset.recentQuery, {fromHistory: true}); return; }
    if (target.dataset.playlistQuery) { runSearch(target.dataset.playlistQuery); els.sidebar.classList.remove('open'); return; }
    if (target.dataset.libraryIndex != null) {
      const items = currentView === 'liked' ? getLikes() : getLikes();
      const chosen = items[Number(target.dataset.libraryIndex)];
      if (chosen) {
        const query = chosen.trackName || chosen.artistName || 'music';
        runSearch(query).then(() => {
          const found = tracks.findIndex(item => item.trackId && item.trackId === chosen.trackId);
          if (found >= 0) setPlayerTrack(found, true);
        });
      }
      return;
    }
  });

  document.querySelectorAll('[data-nav]').forEach(button => button.addEventListener('click', () => {
    const nav = button.dataset.nav;
    els.sidebar.classList.remove('open');
    if (nav === 'home') {
      currentView = 'home';
      els.input.value = '';
      els.clearSearch.hidden = true;
      els.heroKicker.textContent = 'YOUR NEXT FAVORITE TRACK';
      els.heroTitle.innerHTML = 'Discover<br><span>New Music</span>';
      els.heroDescription.textContent = 'Find your next favorite song, artist or album.';
      els.albumsHeading.textContent = 'Featured Albums';
      els.resultsHeading.textContent = 'Popular Songs';
      els.songsEyebrow.textContent = "WHAT'S SOUNDING GOOD";
      setActiveNav('home');
      runSearch('popular songs', {fromHistory: true, mode: 'home'});
    } else if (nav === 'search') {
      setActiveNav('search');
      els.input.focus();
      if (els.input.value.trim()) runSearch(els.input.value);
    } else renderLibrary(nav);
  }));

  els.play.addEventListener('click', () => {
    if (currentIndex < 0) {
      if (tracks.length) setPlayerTrack(0, true);
      else runSearch('popular songs');
      return;
    }
    if (els.audio.paused) {
      els.audio.play().then(() => { els.play.textContent = 'Ⅱ'; }).catch(() => toast('This track could not be played. Try another track.'));
    } else els.audio.pause();
  });
  els.prev.addEventListener('click', playPrevious);
  els.next.addEventListener('click', playNext);
  els.shuffle.addEventListener('click', () => { shuffleOn = !shuffleOn; els.shuffle.classList.toggle('on', shuffleOn); toast(shuffleOn ? 'Shuffle enabled' : 'Shuffle disabled'); });
  els.repeat.addEventListener('click', () => { repeatOn = !repeatOn; els.repeat.classList.toggle('on', repeatOn); toast(repeatOn ? 'Repeat enabled' : 'Repeat disabled'); });
  els.queue.addEventListener('click', () => toast(tracks.length ? `${tracks.length} songs in the current results` : 'Search for songs to start a queue.'));
  els.playerLike.addEventListener('click', () => { if (currentIndex >= 0) toggleLike(tracks[currentIndex]); else toast('Play a song first.'); });
  els.progress.addEventListener('input', () => {
    if (Number.isFinite(els.audio.duration) && els.audio.duration > 0) els.audio.currentTime = Number(els.progress.value) / 100 * els.audio.duration;
    paintRange(els.progress, Number(els.progress.value));
  });
  els.volume.addEventListener('input', () => { els.audio.volume = Number(els.volume.value); paintRange(els.volume, Number(els.volume.value) * 100); });
  els.audio.volume = 0.8;
  paintRange(els.volume, 80);
  els.audio.addEventListener('play', () => { els.play.textContent = 'Ⅱ'; els.play.setAttribute('aria-label', 'Pause'); });
  els.audio.addEventListener('pause', () => { els.play.textContent = '▶'; els.play.setAttribute('aria-label', 'Play'); });
  els.audio.addEventListener('timeupdate', () => {
    const duration = Number.isFinite(els.audio.duration) ? els.audio.duration : durationOf(tracks[currentIndex] || {}) || 30;
    const pct = duration > 0 ? (els.audio.currentTime / duration) * 100 : 0;
    els.progress.value = String(pct);
    paintRange(els.progress, pct);
    els.currentTime.textContent = formatTime(els.audio.currentTime);
    els.totalTime.textContent = formatTime(duration);
  });
  els.audio.addEventListener('loadedmetadata', () => { els.totalTime.textContent = formatTime(els.audio.duration); });
  els.audio.addEventListener('ended', () => { if (repeatOn) { els.audio.currentTime = 0; els.audio.play().catch(() => {}); } else playNext(); });
  els.audio.addEventListener('error', () => { if (currentIndex >= 0) toast('This track is unavailable right now. Try another song.'); });

  // Clicking a card and the keyboard shortcuts stay within the dashboard.
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); els.input.focus(); }
    if (event.key === 'Escape') els.sidebar.classList.remove('open');
  });

  renderRecent();
  updateLikeCount();
  runSearch('popular songs', {fromHistory: true, mode: 'home'});
})();
