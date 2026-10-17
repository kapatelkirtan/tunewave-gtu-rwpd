(() => {
  'use strict';

  // TuneWave searches and plays public tracks from Audius and Jamendo.
  // Jamendo credentials stay in the server-side bridge, never in browser code.
  const AUDIUS_API_BASE = 'https://api.audius.co/v1';
  const AUDIUS_APP_NAME = 'TuneWave';
  const JAMENDO_BRIDGE_BASE = String(window.TUNEWAVE_JAMENDO_API_BASE || '').trim().replace(/\/+$/, '');
  const JAMENDO_BRIDGE_CONFIGURED = /^https?:\/\//i.test(JAMENDO_BRIDGE_BASE) && !/YOUR[-_ ]?JAMENDO|example\.com/i.test(JAMENDO_BRIDGE_BASE);
  const STORAGE_KEY = 'tunewave-player-v4';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const audio = $('#audio-player');
  const searchForm = $('#search-form');
  const searchInput = $('#search-input');
  const resultsArea = $('#results-area');
  const toastEl = $('#toast');
  const state = {
    view: 'home', query: '', results: [], catalogResults: [], queue: [], queueIndex: -1,
    current: null, recent: [], favorites: [], position: 0, volume: 0.8,
    isSeeking: false, installPrompt: null, toastTimer: null, lastSavedAt: 0,
    recognition: null, isVoiceSearching: false, isRestoring: false, isIdentifying: false, recorder: null, identifyTimer: null, mediaStream: null
  };

  function readState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const isSupportedTrack = item => Boolean(item && (item.uid || item.videoId || item.video_id || item.audiusId || item.track_id || item.permalink));
      state.recent = Array.isArray(parsed.recent) ? parsed.recent.filter(isSupportedTrack).slice(0, 16) : [];
      state.favorites = Array.isArray(parsed.favorites) ? parsed.favorites.filter(isSupportedTrack).slice(0, 100) : [];
      state.queue = Array.isArray(parsed.queue) ? parsed.queue.filter(isSupportedTrack).slice(0, 50) : [];
      state.queueIndex = Number.isInteger(parsed.queueIndex) ? parsed.queueIndex : -1;
      state.current = isSupportedTrack(parsed.current) ? parsed.current : null;
      state.position = state.current && Number.isFinite(parsed.position) ? Math.max(0, parsed.position) : 0;
      state.volume = Number.isFinite(parsed.volume) ? Math.min(1, Math.max(0, parsed.volume)) : 0.8;
    } catch (_) {
      state.recent = []; state.favorites = []; state.queue = []; state.current = null; state.position = 0; state.volume = 0.8;
    }
  }

  function saveState(force = false) {
    const now = Date.now();
    if (!force && now - state.lastSavedAt < 3500) return;
    state.lastSavedAt = now;
    try {
      const position = Number.isFinite(audio.currentTime) && audio.currentTime > 0 ? audio.currentTime : state.position;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        recent: state.recent.slice(0, 16), favorites: state.favorites.slice(0, 100),
        queue: state.queue.slice(0, 50), queueIndex: state.queueIndex,
        current: state.current ? { ...state.current, streamUrl: '' } : null, position, volume: state.volume
      }));
    } catch (_) { /* Storage can be disabled or full; playback still works. */ }
  }

  function escapeHTML(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  }
  function toDuration(value) {
    const seconds = Math.max(0, Math.floor(Number(value) || 0));
    const minutes = Math.floor(seconds / 60);
    return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  }
  function trackId(track) {
    if (!track) return '';
    if (track.uid) return String(track.uid);
    if (String(track.source || '').toLowerCase() === 'audius') return `audius:${track.audiusId ?? track.track_id ?? track.id ?? track.permalink ?? ''}`;
    return String(track.videoId ?? track.video_id ?? track.id ?? track.track_id ?? track.permalink ?? '');
  }
  function artworkOf(raw) {
    const art = raw?.artwork;
    if (typeof art === 'string') return art;
    if (art && typeof art === 'object') return art['1000x1000'] || art['480x480'] || art['150x150'] || art['1200x1200'] || Object.values(art).find(v => typeof v === 'string') || '';
    return raw?.artwork_url || raw?.cover_art || raw?.thumbnail || raw?.image || '';
  }
  function normalizeAudiusTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id ?? raw.track_id ?? raw.trackId ?? '').trim();
    if (!id || raw.is_streamable === false) return null;
    const user = raw.user && typeof raw.user === 'object' ? raw.user : {};
    const artwork = raw.artwork || {};
    const art = artworkOf(raw) || artwork['480x480'] || artwork['150x150'] || artwork['1000x1000'] || '';
    const permalink = String(raw.permalink || '');
    let externalUrl = 'https://audius.co';
    if (permalink) {
      try { externalUrl = new URL(permalink, 'https://audius.co').href; } catch (_) {}
    }
    return {
      uid: `audius:${id}`, id, audiusId: id, title: String(raw.title || 'Untitled track').trim(),
      artist: String(user.name || user.handle || raw.artist_name || 'Unknown artist').trim(),
      duration: Math.max(0, Number(raw.duration || 0)), artwork: art, permalink: externalUrl,
      streamUrl: '', source: 'Audius', isStreamable: raw.is_streamable !== false
    };
  }
  function normalizeJamendoTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.track_id || '').trim();
    const audioUrl = String(raw.audio || raw.stream_url || '').trim();
    if (!id || !/^https:\/\//i.test(audioUrl)) return null;
    const sourceUrl = String(raw.shareurl || raw.shorturl || `https://www.jamendo.com/track/${encodeURIComponent(id)}`);
    return {
      uid: `jamendo:${id}`, id, jamendoId: id,
      title: String(raw.name || raw.title || 'Untitled track').trim(),
      artist: String(raw.artist_name || raw.artist || 'Unknown artist').trim(),
      duration: Math.max(0, Number(raw.duration || 0)),
      artwork: String(raw.image || raw.album_image || raw.artwork || ''),
      permalink: sourceUrl, sourceUrl,
      licenseUrl: String(raw.license_ccurl || raw.license_url || ''),
      streamUrl: audioUrl, source: 'Jamendo'
    };
  }
  async function searchJamendoCatalog(query) {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('Jamendo bridge is not configured yet.');
    const payload = await getJson(`${JAMENDO_BRIDGE_BASE}/api/jamendo/search?q=${encodeURIComponent(query)}`, 10000);
    const data = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : [];
    const tracks = uniqueTracks(data, normalizeJamendoTrack).slice(0, 30);
    if (!tracks.length && payload?.error) throw new Error(String(payload.error));
    return tracks;
  }
  function normalizeArchiveTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.identifier || raw.id || '').trim();
    const permalink = String(raw.permalink || (id ? `https://archive.org/details/${encodeURIComponent(id)}` : ''));
    if (!id || !/^https:\/\/archive\.org\//i.test(permalink)) return null;
    return {
      uid: `archive:${id}`, id, archiveId: id,
      title: String(raw.title || id).trim(),
      artist: String(raw.creator || raw.artist || 'Internet Archive contributor').trim(),
      duration: Math.max(0, Number(raw.duration || 0)),
      artwork: String(raw.artwork || (id ? `https://archive.org/services/img/${encodeURIComponent(id)}` : '')),
      permalink, sourceUrl: permalink, licenseUrl: String(raw.licenseUrl || ''),
      rights: String(raw.rights || ''), streamUrl: '', source: 'Internet Archive'
    };
  }
  async function searchArchiveCatalog(query) {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('The provider bridge is not configured.');
    const payload = await getJson(`${JAMENDO_BRIDGE_BASE}/api/archive/search?q=${encodeURIComponent(query)}`, 12000);
    const data = Array.isArray(payload?.results) ? payload.results : [];
    const tracks = uniqueTracks(data, normalizeArchiveTrack).slice(0, 20);
    if (!tracks.length && payload?.error) throw new Error(String(payload.error));
    return tracks;
  }

  async function searchCommonsCatalog(query) {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');
    url.searchParams.set('generator', 'search');
    url.searchParams.set('gsrsearch', 'filetype:audio ' + query);
    url.searchParams.set('gsrnamespace', '6');
    url.searchParams.set('gsrlimit', '30');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url|extmetadata');
    const payload = await getJson(url.href, 12000);
    const pages = Object.values(payload?.query?.pages || {});
    return uniqueTracks(pages, normalizeCommonsTrack).slice(0, 15);
  }
  function normalizeCommonsTrack(page) {
    if (!page || typeof page !== 'object') return null;
    const info = Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    const url = String(info?.url || '');
    if (!page.pageid || !/^https:\/\//i.test(url) || !/\.(ogg|oga|mp3|wav|flac|opus)(?:$|[?#])/i.test(url)) return null;
    const meta = info?.extmetadata || {};
    const value = key => String(meta[key]?.value || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
    const license = value('LicenseUrl');
    const licenseName = value('LicenseShortName');
    if (!/creativecommons\.org|public domain|cc0|free art license|gnu/i.test(license + ' ' + licenseName)) return null;
    const artist = value('Artist') || value('Credit') || 'Wikimedia Commons contributor';
    const title = value('ObjectName') || String(page.title || '').replace(/^File:/, '').replace(/\.[^.]+$/, '');
    const sourceUrl = 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(String(page.title || '').replace(/ /g, '_'));
    return { uid: 'commons:' + page.pageid, id: String(page.pageid), commonsId: String(page.pageid), title: title.slice(0, 250), artist: artist.slice(0, 180), duration: 0, artwork: '', permalink: sourceUrl, sourceUrl, licenseUrl: license, licenseName, streamUrl: url, source: 'Wikimedia Commons' };
  }

  function uniqueTracks(input, normalizer = normalizeJamendoTrack) {
    const data = Array.isArray(input) ? input : (input?.items ?? input?.data ?? input?.tracks ?? input?.results ?? input?.videos ?? []);
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data.map(normalizer).filter(track => {
      if (!track) return false;
      const key = trackId(track);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  async function searchAudiusCatalog(query) {
    const url = `${AUDIUS_API_BASE}/tracks/search?query=${encodeURIComponent(query)}&limit=30&filter_tracks=public&gate_condition=ungated&app_name=${encodeURIComponent(AUDIUS_APP_NAME)}`;
    const payload = await getJson(url, 8500);
    return uniqueTracks(payload?.data ?? payload, normalizeAudiusTrack).slice(0, 30);
  }
  async function resolveStreamURL(track) {
    const source = String(track?.source || '').toLowerCase();
    if (source === 'audius') {
      const id = String(track.audiusId ?? track.track_id ?? track.id ?? '').trim();
      if (!id) throw new Error('This Audius result does not include a playable track ID.');
      return `${AUDIUS_API_BASE}/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(AUDIUS_APP_NAME)}`;
    }
    if (source === 'jamendo') {
      if (track.streamUrl && /^https:\/\//i.test(track.streamUrl)) return track.streamUrl;
      const id = String(track.jamendoId ?? track.id ?? '').trim();
      if (!id || !JAMENDO_BRIDGE_CONFIGURED) throw new Error('Jamendo playback needs the configured Jamendo bridge.');
      const payload = await getJson(`${JAMENDO_BRIDGE_BASE}/api/jamendo/track/${encodeURIComponent(id)}`, 10000);
      const streamUrl = String(payload?.track?.audio || payload?.audio || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('Jamendo did not return a playable audio stream for this track.');
      return streamUrl;
    }
    if (source === 'wikimedia commons') {
      const streamUrl = String(track.streamUrl || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('Wikimedia Commons did not return a playable audio file.');
      return streamUrl;
    }
    if (source === 'internet archive') {
      const id = String(track.archiveId ?? track.id ?? '').trim();
      if (!id || !JAMENDO_BRIDGE_CONFIGURED) throw new Error('Internet Archive playback needs the configured provider bridge.');
      const payload = await getJson(`${JAMENDO_BRIDGE_BASE}/api/archive/track/${encodeURIComponent(id)}`, 12000);
      const streamUrl = String(payload?.track?.streamUrl || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('Internet Archive did not return a playable audio file.');
      return streamUrl;
    }
    throw new Error('This saved item belongs to an older or unsupported music source. Search again to find a supported track.');
  }

  function artHTML(track, className = 'track-cover') {
    const art = track?.artwork;
    if (art && /^https?:\/\//i.test(art)) return `<div class="${className}"><img src="${escapeHTML(art)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.innerHTML='♫';"></div>`;
    return `<div class="${className}"><span class="track-cover-placeholder">♫</span></div>`;
  }
  function toast(message, ms = 3000) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }
  function setLoading(message = 'Searching open music sources…') {
    resultsArea.innerHTML = `<div class="loading-results"><span class="spinner"></span><span>${escapeHTML(message)}</span></div>`;
  }
  function isLiked(track) { const id = trackId(track); return state.favorites.some(item => trackId(item) === id); }

  function trackRow(track, index, active = false) {
    const id = escapeHTML(trackId(track));
    const playing = state.current && trackId(state.current) === trackId(track);
    const sourceName = String(track.source || '').toLowerCase();
    const attribution = sourceName === 'jamendo' && (track.licenseUrl || track.sourceUrl)
      ? `<a class="track-license-link" href="${escapeHTML(track.licenseUrl || track.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="${track.licenseUrl ? 'Open this track’s licence' : 'Open the Jamendo track page to inspect its licence'}">${track.licenseUrl ? 'CC ↗' : 'Page ↗'}</a>`
      : sourceName === 'internet archive' && track.sourceUrl
        ? `<a class="track-license-link" href="${escapeHTML(track.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="Open the Internet Archive item and verify its rights">Rights ↗</a>`
        : '<span class="track-license-spacer" aria-hidden="true"></span>';
    return `<div class="track-row${playing ? ' playing' : ''}" data-track-row="${id}">
      ${artHTML(track)}
      <button class="track-main track-pick" data-play-track="${id}" data-track-index="${index}" aria-label="Play ${escapeHTML(track.title)}" style="background:transparent;border:0;text-align:left;min-width:0;padding:0">
        <div class="track-name">${playing ? '♫ ' : ''}${escapeHTML(track.title)}</div><div class="track-artist">${escapeHTML(track.artist)} <span class="source-tag">· ${escapeHTML(track.source || 'Music source')}</span></div>
      </button>
      ${attribution}
      <span class="track-time">${toDuration(track.duration)}</span>
      <button class="track-action like${isLiked(track) ? ' liked' : ''}" data-like-track="${id}" aria-label="${isLiked(track) ? 'Unlike' : 'Like'} ${escapeHTML(track.title)}" title="${isLiked(track) ? 'Remove from liked songs' : 'Add to liked songs'}">${isLiked(track) ? '♥' : '♡'}</button>
    </div>`;
  }
  function renderTrackList(tracks, options = {}) {
    state.results = tracks;
    if (!tracks.length) {
      resultsArea.innerHTML = `<div class="no-results"><strong>${escapeHTML(options.emptyTitle || 'No tracks found')}</strong>${escapeHTML(options.emptyCopy || 'Try the full song title with a different spelling.')}</div>`;
      $('#result-count').textContent = '';
      return;
    }
    resultsArea.innerHTML = `<div class="track-list">${tracks.map((track, i) => trackRow(track, i)).join('')}</div>`;
    $('#result-count').textContent = `${tracks.length} ${tracks.length === 1 ? 'track' : 'tracks'}`;
  }

  async function getJson(url, timeoutMs = 14000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!response.ok) throw new Error(`Music search returned ${response.status}`);
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  async function searchCatalog(query) {
    const q = query.trim();
    if (!q) { toast('Type the song title you want to hear.'); searchInput.focus(); return; }
    state.query = q;
    $('#results-kicker').textContent = 'SEARCHING CONNECTED MUSIC SOURCES';
    $('#results-title').textContent = `Results for “${q}”`;
    $('#search-hint').textContent = 'Searching Audius, Jamendo, Internet Archive, and Wikimedia Commons…';
    $('#recent-section').hidden = false;
    setLoading('Searching Audius, Jamendo, Internet Archive, and Wikimedia Commons audio…');
    state.view = 'discover'; updateNavigation();

    const [jamendoResult, audiusResult, archiveResult, commonsResult] = await Promise.allSettled([
      searchJamendoCatalog(q), searchAudiusCatalog(q), searchArchiveCatalog(q), searchCommonsCatalog(q)
    ]);
    const jamendoTracks = jamendoResult.status === 'fulfilled' ? jamendoResult.value : [];
    const audiusTracks = audiusResult.status === 'fulfilled' ? audiusResult.value : [];
    const archiveTracks = archiveResult.status === 'fulfilled' ? archiveResult.value : [];
    const commonsTracks = commonsResult.status === 'fulfilled' ? commonsResult.value : [];
    const combined = [...audiusTracks, ...jamendoTracks, ...archiveTracks, ...commonsTracks];
    const seen = new Set();
    const tracks = combined.filter(track => {
      const key = trackId(track);
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    }).slice(0, 55);

    if (tracks.length) {
      state.catalogResults = tracks.slice();
      state.queue = tracks.slice(0, 50);
      state.queueIndex = -1;
      renderTrackList(tracks);
      const providers = [
        audiusTracks.length ? `Audius (${audiusTracks.length})` : '',
        jamendoTracks.length ? `Jamendo (${jamendoTracks.length})` : '',
        archiveTracks.length ? `Internet Archive (${archiveTracks.length})` : '',
        commonsTracks.length ? `Wikimedia Commons (${commonsTracks.length})` : ''
      ].filter(Boolean).join(' + ');
      $('#search-hint').textContent = `Found ${tracks.length} results from ${providers}. Archive results are limited to items marked Creative Commons or public domain; check the item rights before reuse.`;
      $('#results-kicker').textContent = 'YOUR SEARCH, MULTIPLE SOURCES';
      renderQueue(); saveState(true);
      return;
    }

    const jamendoFailed = jamendoResult.status === 'rejected';
    const audiusFailed = audiusResult.status === 'rejected';
    const archiveFailed = archiveResult.status === 'rejected';
    const commonsFailed = commonsResult.status === 'rejected';
    if (!audiusFailed || !jamendoFailed || !archiveFailed || !commonsFailed) {
      resultsArea.innerHTML = `<div class="no-results"><strong>No matching tracks found</strong>Try the full song title with a different spelling, or try another search.</div>`;
      $('#result-count').textContent = '';
      $('#search-hint').textContent = 'No matching results from the providers that responded.';
    } else {
      resultsArea.innerHTML = `<div class="error-panel"><strong>Music search is temporarily unavailable</strong>Audius, Jamendo, Internet Archive, and Wikimedia Commons could not return results. Check the provider bridge and network, then retry.<br><button class="outline-button" id="retry-search">Try again ↻</button></div>`;
      $('#result-count').textContent = '';
      $('#search-hint').textContent = 'All connected search providers failed this time.';
      $('#retry-search')?.addEventListener('click', () => searchCatalog(q));
    }
  }

  function updateNavigation() {
    $$('.nav-item, .mobile-nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === state.view));
    const labels = {home:'Home', discover:'Discover', library:'Your library', favorites:'Liked songs'};
    $('#page-breadcrumb').textContent = labels[state.view] || 'Home';
    $('#favorite-count').textContent = String(state.favorites.length);
    $('#welcome-row').hidden = state.view === 'library' || state.view === 'favorites';
    const homeShelves = $('#home-shelves');
    if (homeShelves) homeShelves.hidden = state.view !== 'home';
    // Search remains available in every view.
    if (state.view === 'library') {
      $('#results-kicker').textContent = 'YOUR LISTENING HISTORY';
      $('#results-title').textContent = 'Your library';
      $('#recent-section').hidden = true;
      renderTrackList(state.recent, {emptyTitle:'Your library is waiting', emptyCopy:'Tracks you play will appear here so you can pick up where you left off.'});
    } else if (state.view === 'favorites') {
      $('#results-kicker').textContent = 'SAVED FOR LATER';
      $('#results-title').textContent = 'Liked songs';
      $('#recent-section').hidden = true;
      renderTrackList(state.favorites, {emptyTitle:'A little love goes a long way', emptyCopy:'Tap the heart next to a track to keep it in your liked songs.'});
    } else if (state.view === 'home' && !state.query) {
      $('#results-kicker').textContent = 'MADE FOR YOUR MOMENT';
      $('#results-title').textContent = 'Find your next favourite';
      $('#recent-section').hidden = false;
    } else {
      $('#recent-section').hidden = false;
    }
  }

  function normalizeImageURL(url) {
    return url && /^https?:\/\//i.test(url) ? url : 'icon-512.png';
  }
  function updateCurrentTrackUI() {
    const track = state.current;
    const title = track?.title || 'Pick a track';
    const artist = track?.artist || 'Your next listen is one search away.';
    $('#now-title').textContent = title;
    $('#now-artist').textContent = artist;
    $('#bottom-title').textContent = track?.title || 'TuneWave is ready';
    $('#bottom-artist').textContent = track?.artist || 'Search, select, and press play';
    $('#now-status').textContent = audio.paused ? (track ? 'READY TO PLAY' : 'READY WHEN YOU ARE') : 'PLAYING FROM OPEN SOURCE';
    const img = normalizeImageURL(track?.artwork);
    $('#now-art-wrap').innerHTML = `<img src="${escapeHTML(img)}" alt="" onerror="this.onerror=null;this.src='icon-512.png'"><div class="art-shine"></div>`;
    $('#bottom-art').innerHTML = `<img src="${escapeHTML(img)}" alt="" onerror="this.onerror=null;this.src='icon-192.png'">`;
    const liked = track && isLiked(track);
    $('#bottom-like-button').textContent = liked ? '♥' : '♡';
    $('#bottom-like-button').classList.toggle('liked', Boolean(liked));
    $('#bottom-like-button').disabled = !track;
    $('#main-play-icon').textContent = audio.paused ? '▶' : 'Ⅱ';
    $('#bottom-play-icon').textContent = audio.paused ? '▶' : 'Ⅱ';
    $('#main-play-button').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    $('#bottom-play-button').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    $('.equalizer-mini')?.classList.toggle('paused', audio.paused);
    renderQueue();
    if (track) updateMediaSession(track);
  }

  function rememberTrack(track) {
    const id = trackId(track);
    state.recent = [track, ...state.recent.filter(item => trackId(item) !== id)].slice(0, 16);
    renderRecent();
    saveState(true);
  }

  function updateMediaSession(track) {
    if (!('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title || 'TuneWave', artist: track.artist || 'Unknown artist', album: `TuneWave · ${track.source || 'Music source'}`,
        artwork: [96,128,192,256,512].map(size => ({ src: normalizeImageURL(track.artwork), sizes: `${size}x${size}` }))
      });
      navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
      const handlers = {
        play: () => {
          if (state.current && (!audio.src || audio.error)) playTrack(state.current, state.queueIndex, state.position);
          else audio.play().catch(() => toast('Tap Play in TuneWave to resume.'));
        },
        pause: () => audio.pause(),
        previoustrack: () => playRelative(-1),
        nexttrack: () => playRelative(1),
        seekbackward: details => { audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10)); },
        seekforward: details => { audio.currentTime = Math.min(Number.isFinite(audio.duration) ? audio.duration : audio.currentTime + 10, audio.currentTime + (details.seekOffset || 10)); },
        seekto: details => { if (Number.isFinite(details.seekTime)) audio.currentTime = details.seekTime; }
      };
      for (const [action, handler] of Object.entries(handlers)) {
        try { navigator.mediaSession.setActionHandler(action, handler); } catch (_) { /* Not every browser supports every action. */ }
      }
    } catch (_) { /* Media Session is an enhancement, never a playback requirement. */ }
  }

  async function playTrack(track, index = -1, resumeAt = 0) {
    if (!track) return;
    const sameTrack = state.current && trackId(state.current) === trackId(track);
    if (sameTrack && audio.src && !audio.error) {
      if (audio.paused) {
        try { await audio.play(); } catch (_) { toast('Tap Play again to resume playback.'); }
      } else audio.pause();
      return;
    }
    if (index >= 0 && state.queue[index] && trackId(state.queue[index]) === trackId(track)) state.queueIndex = index;
    else {
      const foundIndex = state.queue.findIndex(item => trackId(item) === trackId(track));
      if (foundIndex >= 0) state.queueIndex = foundIndex;
      else { state.queue = [track]; state.queueIndex = 0; }
    }
    state.current = { ...track, source: track.source || 'Music source', streamUrl: track.streamUrl || '' };
    state.position = Math.max(0, Number(resumeAt) || 0);
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.volume = state.volume;
    updateCurrentTrackUI();
    $('#now-status').textContent = `CONNECTING TO ${String(state.current.source || 'MUSIC SOURCE').toUpperCase()}`;
    rememberTrack(state.current);
    saveState(true);
    const requestedId = trackId(state.current);
    try {
      const playableUrl = await resolveStreamURL(state.current);
      // Ignore a slow response if the user selected a different song in the meantime.
      if (!state.current || trackId(state.current) !== requestedId) return;
      audio.volume = state.volume;
      audio.onloadedmetadata = () => {
        if (state.position > 0 && Number.isFinite(audio.duration)) audio.currentTime = Math.min(state.position, Math.max(0, audio.duration - .25));
        if (audio.paused) updateProgress();
      };
      audio.src = playableUrl;
      audio.load();
      await audio.play();
      $('#now-status').textContent = `PLAYING FROM ${String(state.current.source || 'MUSIC SOURCE').toUpperCase()}`;
      updateCurrentTrackUI();
      saveState(true);
    } catch (error) {
      if (!state.current || trackId(state.current) !== requestedId) return;
      updateCurrentTrackUI();
      const msg = error?.name === 'NotSupportedError'
        ? 'This stream format is not supported in your browser. Try another result.'
        : error?.name === 'NotAllowedError'
          ? 'Your browser blocked playback after connecting. Tap Play again to begin listening.'
          : 'The source could not provide playable audio. Try another result or retry in a moment.';
      toast(msg, 4500);
      $('#now-status').textContent = 'SOURCE UNAVAILABLE';
    }
  }

  function playRelative(step) {
    if (!state.queue.length) { toast('Search for tracks to build your queue.'); return; }
    let next = state.queueIndex;
    if (next < 0) next = 0;
    else next = (next + step + state.queue.length) % state.queue.length;
    state.queueIndex = next;
    playTrack(state.queue[next], next, 0);
  }

  function renderQueue() {
    const el = $('#queue-list');
    if (!state.queue.length) { el.innerHTML = '<p class="queue-empty">Play a search result to start your queue.</p>'; return; }
    let tracks = [];
    if (state.queueIndex >= 0) tracks = [...state.queue.slice(state.queueIndex + 1), ...state.queue.slice(0, state.queueIndex)].slice(0, 5);
    else tracks = state.queue.slice(0, 5);
    if (!tracks.length) { el.innerHTML = '<p class="queue-empty">You reached the end of this search. Use next to replay the results.</p>'; return; }
    el.innerHTML = tracks.map((track, i) => `<div class="queue-row" data-queue-track="${escapeHTML(trackId(track))}" data-queue-index="${state.queue.findIndex(item => trackId(item) === trackId(track))}" role="button" tabindex="0" aria-label="Play ${escapeHTML(track.title)}">${artHTML(track,'queue-art')}<div class="queue-text"><strong>${escapeHTML(track.title)}</strong><span>${escapeHTML(track.artist)}</span></div><span class="queue-play">▶</span></div>`).join('');
  }

  function renderRecent() {
    const grid = $('#recent-grid');
    if (!state.recent.length) {
      grid.innerHTML = '<div class="recent-empty"><span class="recent-empty-icon">↻</span><span>Your recently played music will show up here.</span></div>';
      return;
    }
    grid.innerHTML = state.recent.slice(0, 3).map((track, index) => `<button class="recent-card" data-recent-index="${index}" aria-label="Play ${escapeHTML(track.title)}"><div class="recent-cover">${track.artwork && /^https?:\/\//i.test(track.artwork) ? `<img src="${escapeHTML(track.artwork)}" alt="" loading="lazy" onerror="this.remove();this.parentElement.textContent='♫'">` : '♫'}</div><div class="recent-title">${escapeHTML(track.title)}</div><div class="recent-artist">${escapeHTML(track.artist)}</div></button>`).join('');
  }

  function toggleFavorite(track) {
    if (!track) return;
    const id = trackId(track);
    if (isLiked(track)) state.favorites = state.favorites.filter(item => trackId(item) !== id);
    else state.favorites = [track, ...state.favorites].slice(0, 100);
    $('#favorite-count').textContent = String(state.favorites.length);
    saveState(true);
    if (state.view === 'favorites') renderTrackList(state.favorites, {emptyTitle:'A little love goes a long way', emptyCopy:'Tap the heart next to a track to keep it in your liked songs.'});
    else if (state.view === 'library') renderTrackList(state.recent);
    else if (state.results.length) renderTrackList(state.results);
    renderRecent();
    updateCurrentTrackUI();
    toast(isLiked(track) ? 'Added to liked songs.' : 'Removed from liked songs.');
  }

  function navigate(view) {
    state.view = view;
    if (view === 'discover') {
      if (state.query) { $('#results-kicker').textContent = 'YOUR SEARCH, YOUR SOUND'; $('#results-title').textContent = `Results for “${state.query}”`; }
      else { $('#results-kicker').textContent = 'EXPLORE THE CATALOG'; $('#results-title').textContent = 'Discover music'; }
    }
    updateNavigation();
    if (view === 'home') {
      if (state.query && state.catalogResults.length) { $('#results-kicker').textContent = 'YOUR SEARCH, YOUR SOUND'; $('#results-title').textContent = `Results for “${state.query}”`; renderTrackList(state.catalogResults); }
      else { $('#results-kicker').textContent = 'MADE FOR YOUR MOMENT'; $('#results-title').textContent = 'Find your next favourite'; resultsArea.innerHTML = '<div class="empty-discover"><div class="empty-art"><span>♫</span><i></i><b></b></div><div><h3>Search for a song by its name.</h3><p>Type the title, say the title with Voice, or tap Identify a song by listening.</p></div><button class="outline-button" data-query="Kesariya">Try Kesariya <span>→</span></button></div>'; $('#result-count').textContent = ''; }
    } else if (view === 'library') {
      $('#results-kicker').textContent = 'YOUR LISTENING HISTORY'; $('#results-title').textContent = 'Your library'; renderTrackList(state.recent, {emptyTitle:'Your library is waiting', emptyCopy:'Tracks you play will appear here so you can pick up where you left off.'});
    } else if (view === 'favorites') {
      $('#results-kicker').textContent = 'SAVED FOR LATER'; $('#results-title').textContent = 'Liked songs'; renderTrackList(state.favorites, {emptyTitle:'A little love goes a long way', emptyCopy:'Tap the heart next to a track to keep it in your liked songs.'});
    } else if (view === 'discover' && !state.query) {
      resultsArea.innerHTML = '<div class="empty-discover"><div class="empty-art"><span>⌕</span><i></i><b></b></div><div><h3>What are you in the mood for?</h3><p>Enter a song title or choose one of the quick song searches above.</p></div><button class="outline-button" data-query="Gujarati garba">Try Gujarati garba <span>→</span></button></div>';
    }
    if (view !== 'library' && view !== 'favorites') renderRecent();
    $('.main-area')?.scrollTo({top: 0, behavior: 'smooth'});
  }

  function startVoiceSearch() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { toast('Voice search is not supported by this browser. Try Chrome on a supported device.'); return; }
    if (state.isVoiceSearching && state.recognition) { state.recognition.stop(); return; }
    const recognition = new SpeechRecognition();
    state.recognition = recognition;
    recognition.lang = 'en-IN'; recognition.interimResults = false; recognition.maxAlternatives = 1;
    state.isVoiceSearching = true;
    $('#voice-button').classList.add('listening');
    $('#search-hint').textContent = 'Listening… say the song title';
    toast('Listening. Say the song title.');
    recognition.onresult = event => {
      const transcript = String(event.results?.[0]?.[0]?.transcript || '').trim();
      if (transcript) { searchInput.value = transcript; searchCatalog(transcript); }
      else toast('I did not catch that. Try again.');
    };
    recognition.onerror = event => {
      const explanation = event.error === 'not-allowed' ? 'Allow microphone access to use voice search.' : event.error === 'no-speech' ? 'No speech heard. Tap Voice and try again.' : 'Voice search was interrupted. Please try again.';
      toast(explanation);
    };
    recognition.onend = () => {
      state.isVoiceSearching = false;
      $('#voice-button').classList.remove('listening');
      $('#search-hint').textContent = state.query ? `Last search: “${state.query}”` : 'Type a song title, say the title, or identify music you hear.';
    };
    try { recognition.start(); } catch (_) { state.isVoiceSearching = false; $('#voice-button').classList.remove('listening'); toast('Voice search could not start. Please try again.'); }
  }

  async function identifySongByListening() {
    const button = $('#identify-button');
    const status = $('#identify-status');
    if (state.isIdentifying) {
      if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast('Listening identification needs a supported browser with microphone permission over HTTPS.');
      status.textContent = 'This browser cannot record audio for identification.';
      return;
    }
    const apiBase = String(window.TUNEWAVE_API_BASE || '').trim().replace(/\/$/, '');
    if (!apiBase) {
      toast('TuneWave backend is not configured for song identification.');
      status.textContent = 'Recognition backend is not configured.';
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (error) {
      status.textContent = error?.name === 'NotAllowedError' ? 'Microphone access was denied. Allow it in browser settings and try again.' : 'Could not access the microphone.';
      toast(status.textContent);
      return;
    }
    state.mediaStream = stream;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported?.(type)) || '';
    let recorder;
    try { recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream); }
    catch (_) { stream.getTracks().forEach(track => track.stop()); state.mediaStream = null; toast('This browser cannot record an audio sample.'); return; }
    state.recorder = recorder;
    state.isIdentifying = true;
    button.classList.add('recording');
    button.querySelector('.identify-copy strong').textContent = 'Listening now… tap to stop';
    status.textContent = 'Listening for up to 10 seconds. Play the song near your phone microphone.';
    toast('Listening for 10 seconds. Keep the music playing nearby.', 3500);
    const chunks = [];
    recorder.addEventListener('dataavailable', event => { if (event.data && event.data.size) chunks.push(event.data); });
    const cleanup = () => {
      clearTimeout(state.identifyTimer);
      stream.getTracks().forEach(track => track.stop());
      state.mediaStream = null;
      state.recorder = null;
      state.isIdentifying = false;
      button.classList.remove('recording');
      button.querySelector('.identify-copy strong').textContent = 'Identify a song by listening';
    };
    recorder.addEventListener('stop', async () => {
      cleanup();
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      if (blob.size < 4000) { status.textContent = 'The sample was too short. Try again with the song playing louder.'; toast(status.textContent); return; }
      status.textContent = 'Identifying the song…';
      setLoading('Identifying the music you heard…');
      $('#results-kicker').textContent = 'MUSIC RECOGNITION';
      $('#results-title').textContent = 'Identifying your song';
      const form = new FormData();
      const ext = String(blob.type).includes('mp4') ? 'm4a' : 'webm';
      form.append('file', blob, `tunewave-sample.${ext}`);
      form.append('duration', '10');
      try {
        const response = await fetch(`${apiBase}/api/audd/recognize`, { method: 'POST', body: form, headers: { 'Accept': 'application/json' } });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const serverMessage = payload?.error || payload?.message || '';
          if (response.status === 404) throw new Error('Your backend does not have the song-recognition route yet. Recognition needs a backend route and a valid AudD token.');
          if (response.status === 401 || response.status === 403) throw new Error('The recognition service rejected its credentials. A valid AudD token is required.');
          throw new Error(serverMessage || `Recognition failed (${response.status}).`);
        }
        const result = payload?.result || payload?.song || payload?.data?.result || payload?.data || payload;
        const title = String(result?.title || result?.track?.title || '').trim();
        const artist = String(result?.artist || result?.track?.artist || '').trim();
        if (!title) {
          status.textContent = 'No song match found. Try a clearer 10-second sample with less background noise.';
          resultsArea.innerHTML = `<div class="no-results"><strong>Couldn't identify that song</strong>Try again with the song playing clearly near your microphone, or type its title in the search box.</div>`;
          $('#result-count').textContent = '';
          return;
        }
        searchInput.value = title;
        status.textContent = `Recognized: ${title}${artist ? ` — ${artist}` : ''}. Searching by song title…`;
        toast(`Recognized “${title}”. Finding playable results…`, 3500);
        await searchCatalog(title);
      } catch (error) {
        const message = error?.message || 'Song identification is unavailable right now.';
        status.textContent = message;
        resultsArea.innerHTML = `<div class="error-panel"><strong>Song identification unavailable</strong>${escapeHTML(message)}<br>Type the song title to search normally, or retry listening after the recognition backend is configured.</div>`;
        $('#result-count').textContent = '';
      }
    }, { once: true });
    try {
      recorder.start();
      state.identifyTimer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 10000);
    } catch (_) {
      cleanup();
      toast('Could not start recording. Please try again.');
    }
  }

  function updateProgress() {
    const duration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (state.current?.duration || 0);
    const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : state.position;
    const pct = duration ? Math.min(100, currentTime / duration * 100) : 0;
    $('#seek-input').value = String(pct);
    $('#bottom-current-time').textContent = toDuration(currentTime);
    $('#bottom-total-time').textContent = toDuration(duration);
    $('#now-time-current').textContent = toDuration(currentTime);
    $('#now-time-duration').textContent = toDuration(duration);
    $('#now-progress-fill').style.width = `${pct}%`;
    if ('mediaSession' in navigator && typeof navigator.mediaSession.setPositionState === 'function' && duration > 0) {
      try { navigator.mediaSession.setPositionState({ duration, playbackRate: audio.playbackRate || 1, position: Math.min(currentTime, duration) }); } catch (_) {}
    }
  }

  // Main controls and app behavior.
  searchForm.addEventListener('submit', event => { event.preventDefault(); searchCatalog(searchInput.value); });
  $('#voice-button').addEventListener('click', startVoiceSearch);
  $('#identify-button').addEventListener('click', identifySongByListening);
  document.addEventListener('click', event => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) { navigate(viewButton.dataset.view); return; }
    const queryButton = event.target.closest('[data-query]');
    if (queryButton) { const query = queryButton.dataset.query; searchInput.value = query; searchCatalog(query); return; }
    const playButton = event.target.closest('[data-play-track]');
    if (playButton) {
      const id = playButton.dataset.playTrack;
      let idx = Number(playButton.dataset.trackIndex);
      const track = state.results.find(item => trackId(item) === id) || state.queue.find(item => trackId(item) === id) || state.recent.find(item => trackId(item) === id) || state.favorites.find(item => trackId(item) === id);
      if (track) {
        if (!state.queue.some(item => trackId(item) === id) || state.queue.length !== state.results.length) { state.queue = (state.view === 'favorites' ? state.favorites : state.view === 'library' ? state.recent : state.results).slice(); }
        idx = state.queue.findIndex(item => trackId(item) === id);
        playTrack(track, idx);
      }
      return;
    }
    const likeButton = event.target.closest('[data-like-track]');
    if (likeButton) {
      const id = likeButton.dataset.likeTrack;
      const track = [...state.results, ...state.queue, ...state.recent, ...state.favorites].find(item => trackId(item) === id);
      if (track) toggleFavorite(track);
      return;
    }
    const recentButton = event.target.closest('[data-recent-index]');
    if (recentButton) { const track = state.recent[Number(recentButton.dataset.recentIndex)]; if (track) playTrack(track); return; }
    const queueButton = event.target.closest('[data-queue-track]');
    if (queueButton) { const index = Number(queueButton.dataset.queueIndex); const track = state.queue[index]; if (track) playTrack(track,index); }
  });
  document.addEventListener('keydown', event => {
    const queueButton = event.target.closest('[data-queue-track]');
    if (queueButton && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); queueButton.click(); }
  });
  $('#main-play-button').addEventListener('click', () => togglePlayback());
  $('#bottom-play-button').addEventListener('click', () => togglePlayback());
  $('#prev-button').addEventListener('click', () => playRelative(-1));
  $('#bottom-prev').addEventListener('click', () => playRelative(-1));
  $('#next-button').addEventListener('click', () => playRelative(1));
  $('#bottom-next').addEventListener('click', () => playRelative(1));
  $('#bottom-like-button').addEventListener('click', () => { if (state.current) toggleFavorite(state.current); });
  $('#clear-queue-button').addEventListener('click', () => { state.queue = state.current ? [state.current] : []; state.queueIndex = state.current ? 0 : -1; renderQueue(); saveState(true); toast('Queue cleared.'); });
  $('#about-button').addEventListener('click', () => $('#info-dialog').showModal());
  $('#settings-button').addEventListener('click', () => $('#info-dialog').showModal());
  $('#install-button').addEventListener('click', async () => {
    if (state.installPrompt) {
      state.installPrompt.prompt();
      try { await state.installPrompt.userChoice; } catch (_) {}
      state.installPrompt = null;
    } else {
      toast('To install: use your browser menu and choose “Install app” or “Add to Home screen”.', 4500);
    }
  });
  $('#volume-input').addEventListener('input', event => { state.volume = Number(event.target.value); audio.volume = state.volume; saveState(true); });
  $('#seek-input').addEventListener('input', event => {
    state.isSeeking = true;
    const dur = Number.isFinite(audio.duration) ? audio.duration : state.current?.duration || 0;
    const value = Number(event.target.value);
    $('#now-progress-fill').style.width = `${value}%`;
    $('#now-time-current').textContent = toDuration(dur * value / 100);
    $('#bottom-current-time').textContent = toDuration(dur * value / 100);
  });
  $('#seek-input').addEventListener('change', event => {
    const duration = Number.isFinite(audio.duration) ? audio.duration : state.current?.duration || 0;
    if (duration > 0) audio.currentTime = duration * Number(event.target.value) / 100;
    state.isSeeking = false; saveState(true);
  });
  function togglePlayback() {
    if (!state.current) {
      if (state.recent[0]) playTrack(state.recent[0], -1, state.position);
      else { toast('Search for a track first, then press Play.'); searchInput.focus(); }
      return;
    }
    if (audio.paused) {
      if (!audio.src || audio.error) playTrack(state.current, state.queueIndex, state.position);
      else audio.play().catch(() => toast('Playback needs a tap to start. Press Play again.'));
    } else audio.pause();
  }

  audio.addEventListener('play', () => { updateCurrentTrackUI(); saveState(true); });
  audio.addEventListener('pause', () => { state.position = audio.currentTime || state.position; updateCurrentTrackUI(); saveState(true); });
  audio.addEventListener('timeupdate', () => { updateProgress(); state.position = audio.currentTime || 0; saveState(false); });
  audio.addEventListener('loadedmetadata', () => { updateProgress(); });
  audio.addEventListener('durationchange', updateProgress);
  audio.addEventListener('ended', () => { state.position = 0; saveState(true); playRelative(1); });
  audio.addEventListener('error', () => {
    if (state.current) {
      $('#now-status').textContent = 'TRACK STREAM UNAVAILABLE';
      state.position = 0; saveState(true);
    }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); state.installPrompt = event; $('#install-button').title = 'Install TuneWave'; });
  window.addEventListener('appinstalled', () => toast('TuneWave was installed. Enjoy listening!'));
  window.addEventListener('pagehide', () => saveState(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveState(true); });

  function restoreSession() {
    audio.volume = state.volume;
    $('#volume-input').value = String(state.volume);
    renderRecent();
    $('#favorite-count').textContent = String(state.favorites.length);
    renderQueue();
    if (state.current) {
      // Restore metadata only. Signed/temporary stream URLs are refreshed on the next Play action.
      state.current = { ...state.current, streamUrl: '' };
      updateCurrentTrackUI();
      updateProgress();
    }
    updateNavigation();
  }

  function paintJamendoStatus(connected, description, label) {
    const card = $('#jamendo-connection');
    if (!card) return;
    card.classList.toggle('source-connection-live', Boolean(connected));
    card.classList.toggle('source-connection-warning', !connected);
    $('#jamendo-description').textContent = description;
    const indicator = card.querySelector('.connection-indicator');
    if (indicator) indicator.classList.toggle('connection-indicator-muted', !connected);
    const status = $('#jamendo-status');
    status.textContent = label;
    status.classList.toggle('connection-status-warning', !connected);
  }
  async function checkJamendoBridge() {
    if (!JAMENDO_BRIDGE_CONFIGURED) {
      paintJamendoStatus(false, 'Needs Jamendo bridge URL in config.js', 'SETUP');
      return;
    }
    try {
      const health = await getJson(`${JAMENDO_BRIDGE_BASE}/health`, 4500);
      if (health?.ok && health?.configured) paintJamendoStatus(true, 'Bridge online · Jamendo search/stream', 'READY');
      else if (health?.ok) paintJamendoStatus(false, 'Add JAMENDO_CLIENT_ID in Render environment', 'CONFIG');
      else paintJamendoStatus(false, 'Bridge responded but is not ready', 'CHECK');
    } catch (_) {
      paintJamendoStatus(false, 'Bridge unreachable · check Render service', 'OFFLINE');
    }
  }

  $('#year').textContent = String(new Date().getFullYear());
  readState();
  restoreSession();
  checkJamendoBridge();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
