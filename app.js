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
  function focusedSearchTerms(query) {
    const q = String(query || '').trim();
    const normalized = q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (/ultra\s*funk|phonk|brazilian funk|funk br|mandelao|automotivo/.test(normalized)) {
      return [...new Set([q, 'ultrafunk', 'Brazilian phonk', 'funk automotivo', 'mandelao'])].slice(0, 5);
    }
    if (/gujarati|gujrati|garba|dandiya/.test(normalized)) {
      return [...new Set([q, 'Gujarati garba', 'Gujarati folk', 'dandiya remix', 'Gujarati DJ remix'])].slice(0, 5);
    }
    if (/bollywood|hindi|desi remix|indian pop|hindustani/.test(normalized)) {
      return [...new Set([q, 'Hindi indie', 'Bollywood instrumental', 'Hindi remix', 'Indian pop'])].slice(0, 5);
    }
    return [q];
  }
  async function searchJamendoCatalog(query) {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('Jamendo bridge is not configured yet.');
    const results = await Promise.allSettled(focusedSearchTerms(query).map(term =>
      getBridgeJson(`${JAMENDO_BRIDGE_BASE}/api/jamendo/search?q=${encodeURIComponent(term)}`, 12000)
    ));
    const payloads = results.filter(result => result.status === 'fulfilled').map(result => result.value);
    const data = payloads.flatMap(payload => Array.isArray(payload?.results) ? payload.results : Array.isArray(payload?.data) ? payload.data : []);
    const tracks = uniqueTracks(data, normalizeJamendoTrack).slice(0, 35);
    if (!tracks.length && !payloads.length) throw new Error('Jamendo search is temporarily unavailable.');
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
    const payload = await getBridgeJson(`${JAMENDO_BRIDGE_BASE}/api/archive/search?q=${encodeURIComponent(query)}`, 12000);
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


  function normalizeAudiomackBridgeTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.music_id || '').trim();
    if (!/^\d{1,20}$/.test(id)) return null;
    const permalink = String(raw.permalink || 'https://audiomack.com/');
    if (!/^https:\/\/audiomack\.com\//i.test(permalink)) return null;
    return {
      uid: 'audiomack:' + id, id, audiomackId: id,
      title: String(raw.title || 'Untitled track').trim(),
      artist: String(raw.creator || raw.artist || 'Audiomack artist').trim(),
      duration: Math.max(0, Number(raw.duration || 0)),
      artwork: String(raw.artwork || ''),
      permalink, sourceUrl: permalink,
      streamUrl: '', source: 'Audiomack'
    };
  }
  function normalizeFreeToUseTrack(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.track_id || '').trim();
    const streamUrl = String(raw.streamUrl || raw.audio || raw.url || '').trim();
    if (!id || !/^https:\/\//i.test(streamUrl)) return null;
    const permalink = String(raw.permalink || raw.sourceUrl || 'https://freetouse.com/');
    return {
      uid: 'freetouse:' + id, id, freeToUseId: id,
      title: String(raw.title || raw.name || 'Untitled track').trim(),
      artist: String(raw.creator || raw.artist || raw.artist_name || 'Free To Use artist').trim(),
      duration: Math.max(0, Number(raw.duration || 0)),
      artwork: String(raw.artwork || raw.thumbnail || ''),
      permalink, sourceUrl: permalink,
      licenseUrl: String(raw.licenseUrl || 'https://freetouse.com/license'),
      licenseName: 'Free To Use License',
      streamUrl, source: 'Free To Use'
    };
  }
  async function searchFreeToUseCatalog(query) {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('The music provider bridge is not configured.');
    const payload = await getBridgeJson(JAMENDO_BRIDGE_BASE + '/api/freetouse/search?q=' + encodeURIComponent(query), 12000);
    const data = Array.isArray(payload && payload.results) ? payload.results : [];
    const tracks = uniqueTracks(data, normalizeFreeToUseTrack).slice(0, 20);
    if (!tracks.length && payload && payload.error) throw new Error(String(payload.error));
    return tracks;
  }

  function normalizeBridgeAudioTrack(raw, source) {
    if (!raw || typeof raw !== 'object') return null;
    const id = String(raw.id || raw.identifier || raw.permalink || '').trim();
    const streamUrl = String(raw.streamUrl || raw.audio || raw.url || '').trim();
    if (!id || !/^https:\/\//i.test(streamUrl)) return null;
    const permalink = String(raw.permalink || raw.sourceUrl || raw.foreign_landing_url || raw.detail_url || '');
    const sourceKey = source.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return { uid: sourceKey + ':' + id, id, title: String(raw.title || raw.name || id).trim(),
      artist: String(raw.creator || raw.artist || raw.artist_name || 'Unknown contributor').trim(),
      duration: Math.max(0, Number(raw.duration || 0)), artwork: String(raw.artwork || raw.thumbnail || ''),
      permalink, sourceUrl: permalink, licenseUrl: String(raw.licenseUrl || raw.license_url || ''),
      licenseName: String(raw.licenseName || raw.license || ''), rights: String(raw.rights || raw.attribution || ''),
      streamUrl, source };
  }
  async function searchBridgeAudioProvider(provider, source, query, timeoutMs = 12000) {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('The music provider bridge is not configured.');
    const payload = await getBridgeJson(JAMENDO_BRIDGE_BASE + '/api/' + provider + '/search?q=' + encodeURIComponent(query), timeoutMs);
    const data = Array.isArray(payload && payload.results) ? payload.results : [];
    const tracks = uniqueTracks(data, raw => normalizeBridgeAudioTrack(raw, source)).slice(0, 20);
    if (!tracks.length && payload && payload.error) throw new Error(String(payload.error));
    return tracks;
  }
  async function searchCcmixterCatalog(query) { return searchBridgeAudioProvider('ccmixter', 'ccMixter', query); }
  async function searchLocCatalog(query) { return searchBridgeAudioProvider('loc', 'Library of Congress', query); }
  async function searchOpenverseCatalog(query) { return searchBridgeAudioProvider('openverse', 'Openverse', query); }
  async function searchRadioCatalog(query) { return searchBridgeAudioProvider('radio', 'Radio Browser', query); }
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
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('The music provider bridge is not configured.');
    const url = JAMENDO_BRIDGE_BASE + '/api/audius/search?q=' + encodeURIComponent(query);
    const payload = await getBridgeJson(url, 15000);
    return uniqueTracks(payload?.results ?? payload?.data ?? payload, normalizeAudiusTrack).slice(0, 45);
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
      const payload = await getBridgeJson(`${JAMENDO_BRIDGE_BASE}/api/jamendo/track/${encodeURIComponent(id)}`, 12000);
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
      const payload = await getBridgeJson(`${JAMENDO_BRIDGE_BASE}/api/archive/track/${encodeURIComponent(id)}`, 12000);
      const streamUrl = String(payload?.track?.streamUrl || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('Internet Archive did not return a playable audio file.');
      return streamUrl;
    }
    if (source === 'free to use') {
      const streamUrl = String(track.streamUrl || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('Free To Use did not return a playable audio file.');
      return streamUrl;
    }
    if (source === 'ccmixter' || source === 'library of congress' || source === 'openverse' || source === 'radio browser') {
      const streamUrl = String(track.streamUrl || '');
      if (!/^https:\/\//i.test(streamUrl)) throw new Error('This provider did not return a playable audio file.');
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
    const attribution = (track.licenseUrl || track.sourceUrl) && ['jamendo', 'internet archive', 'wikimedia commons', 'ccmixter', 'openverse', 'library of congress', 'radio browser', 'audiomack'].includes(sourceName)
      ? `<a class="track-license-link" href="${escapeHTML(track.licenseUrl || track.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="Open the source page and check this track’s licence">${track.licenseUrl ? 'Licence ↗' : 'Source ↗'}</a>`
      : '<span class="track-license-spacer" aria-hidden="true"></span>';
    return `<div class="track-row${playing ? ' playing' : ''}" data-track-row="${id}">
      ${artHTML(track)}
      <button class="track-main track-pick" data-play-track="${id}" data-track-index="${index}" aria-label="Play ${escapeHTML(track.title)}" style="background:transparent;border:0;text-align:left;min-width:0;padding:0">
        <div class="track-name">${playing ? '♫ ' : ''}${escapeHTML(track.title)}</div><div class="track-artist">${escapeHTML(track.artist)} <span class="source-tag">· ${escapeHTML(track.source || 'Music source')}</span></div>
      </button>
      ${attribution}
      <span class="track-time">${sourceName === 'radio browser' ? 'LIVE' : (Number(track.duration) > 0 ? toDuration(track.duration) : '—')}</span>
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

  function updateExternalMusicLinks(query) {
    const q = String(query ?? searchInput.value ?? '').trim() || 'ultrafunk';
    const encoded = encodeURIComponent(q);
    const pathQuery = encoded.replace(/%20/g, '-');
    const destinations = {
      'youtube-music': 'https://music.youtube.com/search?q=' + encoded,
      'jiosaavn': 'https://www.jiosaavn.com/search/song/' + pathQuery,
      'spotify': 'https://open.spotify.com/search/' + encoded,
      'apple-music': 'https://music.apple.com/in/search?term=' + encoded,
      'amazon-music': 'https://music.amazon.in/search?keywords=' + encoded,
      'soundcloud': 'https://soundcloud.com/search/sounds?q=' + encoded,
      'bandcamp': 'https://bandcamp.com/search?q=' + encoded,
      'free-music-archive': 'https://freemusicarchive.org/search/?quicksearch=' + encoded
    };
    $$('[data-external-provider]').forEach(link => {
      const target = destinations[link.dataset.externalProvider];
      if (target) link.href = target;
    });
    const caption = $('#external-music-query');
    if (caption) caption.textContent = 'Search “' + q + '” on these official music services.';
  }

  function stopOfficialEmbed() {
    const frame = $('#official-player-frame');
    const stage = $('#official-player-stage');
    if (frame) {
      frame.removeAttribute('src');
      frame.hidden = true;
    }
    if (stage) stage.hidden = true;
  }

  function setupOfficialPlayer() {
    const form = $('#official-player-form');
    if (!form) return;
    const sourceSelect = $('#official-player-source');
    const urlInput = $('#official-player-url');
    const frame = $('#official-player-frame');
    const stage = $('#official-player-stage');
    const status = $('#official-player-status');

    form.addEventListener('submit', event => {
      event.preventDefault();
      const raw = String(urlInput?.value || '').trim();
      const provider = String(sourceSelect?.value || 'youtube');
      let parsed;
      try {
        parsed = new URL(raw);
        if (parsed.protocol !== 'https:') throw new Error('Use an HTTPS share link from the official music service.');
      } catch (_) {
        if (status) status.textContent = 'Paste a valid HTTPS share URL from the selected service.';
        return;
      }

      let embedUrl = '';
      let frameTitle = '';
      if (provider === 'youtube') {
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const validHost = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(host);
        if (!validHost) {
          if (status) status.textContent = 'Choose YouTube above and paste a YouTube or YouTube Music video/playlist link.';
          return;
        }
        const parts = parsed.pathname.split('/').filter(Boolean);
        let videoId = '';
        if (host === 'youtu.be') videoId = parts[0] || '';
        else if (['embed', 'shorts', 'live'].includes(parts[0])) videoId = parts[1] || '';
        else videoId = parsed.searchParams.get('v') || '';
        const listId = parsed.searchParams.get('list') || '';
        if (/^[A-Za-z0-9_-]{11}$/.test(videoId)) {
          embedUrl = 'https://www.youtube-nocookie.com/embed/' + videoId + '?playsinline=1&rel=0&enablejsapi=1';
          if (/^[A-Za-z0-9_-]+$/.test(listId)) embedUrl += '&list=' + encodeURIComponent(listId);
          frameTitle = 'Official YouTube music video player';
        } else if (listId && /^[A-Za-z0-9_-]+$/.test(listId)) {
          embedUrl = 'https://www.youtube-nocookie.com/embed/videoseries?list=' + encodeURIComponent(listId);
          frameTitle = 'Official YouTube playlist player';
        } else {
          if (status) status.textContent = 'That YouTube link did not include a supported video or playlist ID.';
          return;
        }
      } else if (provider === 'soundcloud') {
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (host !== 'soundcloud.com' || parts.length < 2 || parts[0] === 'search') {
          if (status) status.textContent = 'Paste a full SoundCloud track or playlist link (not a search page or short link).';
          return;
        }
        embedUrl = 'https://w.soundcloud.com/player/?url=' + encodeURIComponent(parsed.href) + '&auto_play=false&hide_related=true&show_comments=false&show_user=true&visual=true';
        frameTitle = 'Official SoundCloud embedded player';
      } else {
        if (status) status.textContent = 'Choose one of the supported official embedded players.';
        return;
      }

      stopOfficialEmbed();
      audio.pause();
      if (frame && stage) {
        frame.title = frameTitle;
        frame.src = embedUrl;
        frame.hidden = false;
        stage.hidden = false;
        if (status) status.textContent = 'Loading the official ' + (provider === 'youtube' ? 'YouTube' : 'SoundCloud') + ' player. Ads, account rules and background playback are controlled by that service and your device.';
      }
    });
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

  const BRIDGE_STARTUP_TIMEOUT_MS = 75000;
  let bridgeReadyPromise = null;
  let bridgeReadyUntil = 0;
  let bridgeHealthSnapshot = null;

  async function waitForBridgeReady() {
    if (!JAMENDO_BRIDGE_CONFIGURED) throw new Error('TuneWave music provider bridge is not configured.');
    if (bridgeHealthSnapshot && Date.now() < bridgeReadyUntil) return bridgeHealthSnapshot;
    if (!bridgeReadyPromise) {
      bridgeReadyPromise = (async () => {
        const deadline = Date.now() + BRIDGE_STARTUP_TIMEOUT_MS;
        let lastError = null;
        while (Date.now() < deadline) {
          try {
            const health = await getJson(JAMENDO_BRIDGE_BASE + '/health', 10000);
            if (health && health.ok === true && health.service === 'tunewave-jamendo-bridge') {
              bridgeHealthSnapshot = health;
              bridgeReadyUntil = Date.now() + 20000;
              return health;
            }
            lastError = new Error('Music provider bridge returned an unexpected health response.');
          } catch (error) {
            lastError = error;
          }
          const remaining = deadline - Date.now();
          if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(4000, remaining)));
        }
        bridgeHealthSnapshot = null;
        bridgeReadyUntil = 0;
        throw new Error('Music provider bridge did not wake up within 75 seconds. Please retry or check its Render deployment.');
      })().finally(() => { bridgeReadyPromise = null; });
    }
    return bridgeReadyPromise;
  }

  async function getBridgeJson(url, timeoutMs = 12000) {
    await waitForBridgeReady();
    return getJson(url, timeoutMs);
  }
  async function searchCatalog(query) {
    const q = query.trim();
    if (!q) { toast('Type the song title you want to hear.'); searchInput.focus(); return; }
    state.query = q;
    updateExternalMusicLinks(q);
    $('#results-kicker').textContent = 'SEARCHING CONNECTED MUSIC SOURCES';
    $('#results-title').textContent = `Results for “${q}”`;
    $('#search-hint').textContent = 'Searching connected music sources…';
    $('#recent-section').hidden = false;
    setLoading('Searching connected music sources…');
    state.view = 'discover'; updateNavigation();

    const [jamendoResult, audiusResult, archiveResult, commonsResult, ccmixterResult, locResult, openverseResult, radioResult, freeToUseResult] = await Promise.allSettled([
      searchJamendoCatalog(q), searchAudiusCatalog(q), searchArchiveCatalog(q), searchCommonsCatalog(q),
      searchCcmixterCatalog(q), searchLocCatalog(q), searchOpenverseCatalog(q), searchRadioCatalog(q), searchFreeToUseCatalog(q)
    ]);
    const jamendoTracks = jamendoResult.status === 'fulfilled' ? jamendoResult.value : [];
    const audiusTracks = audiusResult.status === 'fulfilled' ? audiusResult.value : [];
    const archiveTracks = archiveResult.status === 'fulfilled' ? archiveResult.value : [];
    const commonsTracks = commonsResult.status === 'fulfilled' ? commonsResult.value : [];
    const ccmixterTracks = ccmixterResult.status === 'fulfilled' ? ccmixterResult.value : [];
    const locTracks = locResult.status === 'fulfilled' ? locResult.value : [];
    const openverseTracks = openverseResult.status === 'fulfilled' ? openverseResult.value : [];
    const radioTracks = radioResult.status === 'fulfilled' ? radioResult.value : [];
    const freeToUseTracks = freeToUseResult.status === 'fulfilled' ? freeToUseResult.value : [];
    const combined = [...audiusTracks, ...freeToUseTracks, ...jamendoTracks, ...archiveTracks, ...commonsTracks, ...ccmixterTracks, ...locTracks, ...openverseTracks, ...radioTracks];
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
        freeToUseTracks.length ? `Free To Use (${freeToUseTracks.length})` : '',
        jamendoTracks.length ? `Jamendo (${jamendoTracks.length})` : '',
        archiveTracks.length ? `Internet Archive (${archiveTracks.length})` : '',
        commonsTracks.length ? `Wikimedia Commons (${commonsTracks.length})` : '',
        ccmixterTracks.length ? `ccMixter (${ccmixterTracks.length})` : '',
        locTracks.length ? `Library of Congress (${locTracks.length})` : '',
        openverseTracks.length ? `Openverse (${openverseTracks.length})` : '',
        radioTracks.length ? `Radio Browser (${radioTracks.length} stations)` : ''
      ].filter(Boolean).join(' + ');
      $('#search-hint').textContent = `Found ${tracks.length} results from ${providers}. Open-source audio results include licence/source links; check the original rights page before reuse.`;
      $('#results-kicker').textContent = 'YOUR SEARCH, MULTIPLE SOURCES';
      renderQueue(); saveState(true);
      return;
    }

    const providerRuns = [
      ['Audius', audiusResult], ['Free To Use', freeToUseResult], ['Jamendo', jamendoResult],
      ['Internet Archive', archiveResult], ['Wikimedia Commons', commonsResult],
      ['ccMixter', ccmixterResult], ['Library of Congress', locResult],
      ['Openverse', openverseResult], ['Radio Browser', radioResult]
    ];
    const failedProviders = providerRuns
      .filter(([, result]) => result.status === 'rejected')
      .map(([name, result]) => name + ': ' + String(result.reason?.message || 'request failed'));
    const failureSummary = failedProviders.length
      ? ' Unavailable sources: ' + failedProviders.join('; ') + '.'
      : '';

    if (tracks.length) {
      // (Results were already rendered above; this branch is only retained as a safeguard.)
      $('#search-hint').textContent += failureSummary;
      return;
    }

    const successfulProviderCount = providerRuns.length - failedProviders.length;
    if (successfulProviderCount > 0) {
      const title = failedProviders.length ? 'No matching tracks — some sources failed' : 'No matching tracks found';
      const copy = failedProviders.length
        ? 'Sources that responded returned no tracks for this query. ' + failureSummary + ' Try another spelling or a broader title.'
        : 'The responding music sources found no results for this query. Try a broader title such as “music”, “jazz”, or “lofi”.';
      resultsArea.innerHTML = `<div class="no-results"><strong>${escapeHTML(title)}</strong>${escapeHTML(copy)}<br><button class="outline-button" id="retry-search">Try again ↻</button></div>`;
      $('#result-count').textContent = '';
      $('#search-hint').textContent = failedProviders.length
        ? 'Some providers could not be searched. Details: ' + failureSummary
        : 'No matches from the providers that responded.';
      $('#retry-search')?.addEventListener('click', () => searchCatalog(q));
    } else {
      resultsArea.innerHTML = `<div class="error-panel"><strong>Music search is temporarily unavailable</strong>All connected music/audio providers failed. ${escapeHTML(failureSummary)}<br><button class="outline-button" id="retry-search">Try again ↻</button></div>`;
      $('#result-count').textContent = '';
      $('#search-hint').textContent = 'All provider searches failed. Details: ' + failureSummary;
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
  searchInput.addEventListener('input', () => updateExternalMusicLinks(searchInput.value));
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

  audio.addEventListener('play', () => { stopOfficialEmbed(); updateCurrentTrackUI(); saveState(true); });
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

  let providerCheckInProgress = false;

  function paintProviderStatus(provider, connectionState, description) {
    const card = $('#' + provider + '-connection');
    if (!card) return;
    card.classList.remove('source-connection-live', 'source-connection-warning',
      'source-connection-checking', 'source-connection-offline', 'source-connection-setup');
    const status = $('#' + provider + '-status');
    const indicator = card.querySelector('.connection-indicator');
    const labels = { online: 'ONLINE', checking: 'CHECKING', setup: 'SETUP', offline: 'OFFLINE' };
    if (connectionState === 'online') card.classList.add('source-connection-live');
    else if (connectionState === 'checking') card.classList.add('source-connection-checking');
    else if (connectionState === 'setup') card.classList.add('source-connection-setup');
    else card.classList.add('source-connection-warning', 'source-connection-offline');
    if (indicator) indicator.classList.toggle('connection-indicator-muted', connectionState !== 'online');
    const descriptionEl = $('#' + provider + '-description');
    if (descriptionEl) descriptionEl.textContent = description;
    if (status) {
      status.textContent = labels[connectionState] || 'CHECK';
      status.classList.toggle('connection-status-warning', connectionState !== 'online');
      status.classList.toggle('connection-status-online', connectionState === 'online');
      status.classList.toggle('connection-status-checking', connectionState === 'checking');
    }
    card.dataset.connectionState = connectionState;
  }

  function probeBridgeSearch(path, timeoutMs = 8500) {
    if (!JAMENDO_BRIDGE_CONFIGURED) return Promise.reject(new Error('bridge-url-missing'));
    const url = JAMENDO_BRIDGE_BASE + path + '?q=' + encodeURIComponent('music');
    return getJson(url, timeoutMs).then(payload => {
      if (payload && payload.error) throw new Error('provider-search-failed');
      if (payload && payload.ok === true && Number.isFinite(Number(payload.resultCount))) {
        return Number(payload.resultCount);
      }
      if (!payload || !Array.isArray(payload.results)) throw new Error('unexpected-provider-response');
      return payload.results.length;
    });
  }

  async function checkProviderConnections() {
    if (providerCheckInProgress) return;
    providerCheckInProgress = true;
    const refresh = $('#refresh-connections');
    const summary = $('#connection-summary');
    if (refresh) refresh.disabled = true;
    if (refresh) refresh.classList.add('is-checking');
    const cards = $$('.source-connection[data-provider]');
    cards.forEach(card => paintProviderStatus(card.dataset.provider, 'checking', 'Waking the free music bridge if it has been idle…'));
    if (summary) summary.textContent = 'PROBING ' + cards.length + ' SOURCES';

    const healthPromise = JAMENDO_BRIDGE_CONFIGURED
      ? waitForBridgeReady().catch(() => null)
      : Promise.resolve(null);

    const probes = [
      {
        provider: 'audius', flag: 'audiusEnabled', path: '/api/audius/search',
        online: count => count ? 'Audius catalogue responded through the bridge · ' + count + ' “music” matches.' : 'Audius API responded · no “music” matches.'
      },
      {
        provider: 'freetouse', flag: 'freeToUseEnabled', path: '/api/freetouse/search',
        online: count => count ? 'Keyless catalogue responded · ' + count + ' “music” matches.' : 'Keyless catalogue responded · no “music” matches.'
      },
      {
        provider: 'jamendo', needsJamendoKey: true, path: '/api/jamendo/search',
        online: count => count ? 'Jamendo API responded · ' + count + ' “music” matches.' : 'Jamendo API responded · no “music” matches.'
      },
      {
        provider: 'archive', flag: 'internetArchiveEnabled', path: '/api/archive/search',
        online: count => count ? 'Archive search responded · ' + count + ' “music” matches.' : 'Archive search responded · no “music” matches.'
      },
      {
        provider: 'commons', direct: true,
        check: async () => {
          const url = new URL('https://commons.wikimedia.org/w/api.php');
          url.searchParams.set('action', 'query');
          url.searchParams.set('format', 'json');
          url.searchParams.set('origin', '*');
          url.searchParams.set('generator', 'search');
          url.searchParams.set('gsrsearch', 'filetype:audio music');
          url.searchParams.set('gsrnamespace', '6');
          url.searchParams.set('gsrlimit', '1');
          url.searchParams.set('prop', 'imageinfo');
          url.searchParams.set('iiprop', 'url');
          const payload = await getJson(url.href, 7500);
          if (!payload || payload.error || typeof payload !== 'object') throw new Error('invalid response');
          // A successful MediaWiki query may omit `query` when it finds no matches.
          // Valid JSON without an API error is still a healthy endpoint response.
          return Object.keys(payload.query?.pages || {}).length;
        },
        online: count => count ? 'Wikimedia API responded · audio page found.' : 'Wikimedia API responded · no test-query matches.'
      },
      {
        provider: 'ccmixter', flag: 'ccMixterEnabled', path: '/api/ccmixter/search',
        online: count => count ? 'Creative Commons catalogue responded · ' + count + ' “music” matches.' : 'Catalogue responded · no test-query matches.'
      },
      {
        provider: 'loc', flag: 'libraryOfCongressEnabled', path: '/api/loc/status',
        online: count => 'Library of Congress audio API responded' + (count ? ' · sound-recording catalogue available.' : ' · no sample results returned.')
      },
      {
        provider: 'openverse', flag: 'openverseEnabled', path: '/api/openverse/search',
        online: count => count ? 'Open audio search responded · ' + count + ' “music” matches.' : 'Openverse responded · no “music” matches.'
      },
      {
        provider: 'radio', flag: 'radioBrowserEnabled', path: '/api/radio/search',
        online: count => count ? 'Live station directory responded · ' + count + ' matching stations.' : 'Station directory responded · no “music” matches.'
      }
    ];

    const results = await Promise.all(probes.map(async probe => {
      try {
        let count;
        if (probe.direct) {
          count = await probe.check();
        } else {
          if (!JAMENDO_BRIDGE_CONFIGURED) {
            paintProviderStatus(probe.provider, 'setup', 'Add the bridge URL to config.js.');
            return { provider: probe.provider, state: 'setup' };
          }
          const health = await healthPromise;
          if (!health || !health.ok) {
            paintProviderStatus(probe.provider, 'offline', 'TuneWave provider bridge is unreachable.');
            return { provider: probe.provider, state: 'offline' };
          }
          if (probe.needsJamendoKey && !health.configured) {
            paintProviderStatus(probe.provider, 'setup', 'Add JAMENDO_CLIENT_ID to the bridge environment on Render.');
            return { provider: probe.provider, state: 'setup' };
          }
          if (probe.flag && health[probe.flag] !== true) {
            paintProviderStatus(probe.provider, 'setup', 'This route is not enabled in the current bridge build.');
            return { provider: probe.provider, state: 'setup' };
          }
          if (probe.provider === 'loc') {
            try {
              // The lightweight status route is preferred, but fall back to the existing
              // search route if the bridge has not yet deployed that route.
              count = await probeBridgeSearch(probe.path, 15000);
            } catch (_) {
              count = await probeBridgeSearch('/api/loc/search', 15000);
            }
          } else {
            count = await probeBridgeSearch(probe.path);
          }
        }
        paintProviderStatus(probe.provider, 'online', probe.online(count));
        return { provider: probe.provider, state: 'online' };
      } catch (error) {
        const detail = String(error && error.message || '');
        const description = probe.provider === 'loc'
          ? (detail.includes('404') ? 'LOC status route missing · retrying its search route did not work.' : 'LOC endpoints failed through the bridge · check the Render service logs.')
          : 'Search endpoint did not respond · check provider bridge/API.';
        paintProviderStatus(probe.provider, 'offline', description);
        return { provider: probe.provider, state: 'offline' };
      }
    }));

    const onlineCount = results.filter(result => result.state === 'online').length;
    const setupCount = results.filter(result => result.state === 'setup').length;
    if (summary) {
      summary.textContent = onlineCount + ' / ' + results.length + ' ONLINE';
      summary.title = setupCount ? setupCount + ' provider(s) need setup.' : 'Live search endpoint checks completed.';
      summary.classList.toggle('connection-summary-warning', onlineCount < results.length);
    }
    const note = $('#provider-note');
    if (note) {
      const checkedAt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      note.textContent = 'Checked at ' + checkedAt + '. ONLINE means the search endpoint answered this test; it does not guarantee every title exists or every stream will play. Provider catalogues and usage licences vary.';
    }
    if (refresh) refresh.disabled = false;
    if (refresh) refresh.classList.remove('is-checking');
    providerCheckInProgress = false;
  }

  $('#refresh-connections')?.addEventListener('click', checkProviderConnections);

  $('#year').textContent = String(new Date().getFullYear());
  updateExternalMusicLinks(searchInput.value || 'ultrafunk');
  setupOfficialPlayer();
  readState();
  restoreSession();
  checkProviderConnections();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
