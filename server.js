
'use strict';

const express = require('express');
const app = express();
const PORT = Number(process.env.PORT || 10000);
const JAMENDO_CLIENT_ID = String(process.env.JAMENDO_CLIENT_ID || '').trim();
const YOUTUBE_API_KEY = String(process.env.YOUTUBE_API_KEY || '').trim();
const OPENVERSE_CLIENT_ID = String(process.env.OPENVERSE_CLIENT_ID || '').trim();
const OPENVERSE_CLIENT_SECRET = String(process.env.OPENVERSE_CLIENT_SECRET || '').trim();
const OPEN_AUDIO_BASE = 'https://open.audio';
const USER_AGENT = 'TuneWaveMusicBridge/1.0 (+https://tunewave-gtu-rwpd-1.onrender.com)';
const CACHE_TTL_MS = 25000;
const responseCache = new Map();
let openverseToken = '';
let openverseTokenExpiresAt = 0;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept,Content-Type,Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use(express.static(__dirname));

function cleanQuery(value) {
  const q = String(value || '').trim().replace(/\s+/g, ' ');
  if (!q || q.length > 200) {
    const error = new Error('Enter a search query up to 200 characters long.');
    error.status = 400;
    throw error;
  }
  return q;
}

function publicError(message, status) {
  const error = new Error(message);
  error.status = status || 502;
  return error;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 7800);
  const headers = Object.assign({
    Accept: 'application/json',
    'User-Agent': USER_AGENT
  }, options.headers || {});
  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'follow'
    });
    const text = await response.text();
    let payload;
    try { payload = text ? JSON.parse(text) : {}; }
    catch (_) { throw publicError('The music provider returned an unreadable response.', 502); }
    if (!response.ok) {
      const error = publicError('A music provider returned HTTP ' + response.status + '.', response.status === 429 ? 429 : 502);
      error.upstreamStatus = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error && error.name === 'AbortError') throw publicError('The music provider took too long to respond.', 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 7800);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: options.accept || 'application/xml,text/xml,application/rss+xml,*/*', 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow'
    });
    const body = await response.text();
    if (!response.ok) throw publicError('A music provider returned HTTP ' + response.status + '.', response.status === 429 ? 429 : 502);
    return body;
  } catch (error) {
    if (error && error.name === 'AbortError') throw publicError('The music provider took too long to respond.', 504);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function cached(key, loader, ttl = CACHE_TTL_MS) {
  const now = Date.now();
  const hit = responseCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value;
  if (hit) responseCache.delete(key);
  const value = await loader();
  responseCache.set(key, { value, expiresAt: Date.now() + ttl });
  if (responseCache.size > 180) {
    for (const [cacheKey, entry] of responseCache) {
      if (entry.expiresAt <= Date.now() || responseCache.size > 150) responseCache.delete(cacheKey);
    }
  }
  return value;
}

function listFrom(payload, keys = ['results', 'data', 'tracks', 'items']) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    const value = payload && payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const nested of ['results', 'data', 'tracks', 'items']) {
        if (Array.isArray(value[nested])) return value[nested];
      }
    }
  }
  return [];
}

function httpsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return parsed.protocol === 'https:' ? parsed.href : '';
  } catch (_) {
    return '';
  }
}

function str(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (typeof value === 'object') return str(value.name || value.title || value.url || value.value || '');
  return '';
}

function firstString(...values) {
  for (const value of values) {
    const found = str(value);
    if (found) return found;
  }
  return '';
}

function jamendoConfigured() {
  return Boolean(JAMENDO_CLIENT_ID);
}

function sourceHealth() {
  return {
    ok: true,
    service: 'tunewave-jamendo-bridge',
    configured: jamendoConfigured(),
    jamendoEnabled: jamendoConfigured(),
    youtubeSearchConfigured: Boolean(YOUTUBE_API_KEY),
    audiusEnabled: true,
    freeToUseEnabled: true,
    internetArchiveEnabled: true,
    ccMixterEnabled: true,
    funkwhaleEnabled: true,
    openverseEnabled: true,
    openverseAuthenticated: Boolean(OPENVERSE_CLIENT_ID && OPENVERSE_CLIENT_SECRET),
    radioBrowserEnabled: true,
    generatedAt: new Date().toISOString()
  };
}

app.get('/health', (req, res) => res.json(sourceHealth()));
app.get('/api/health', (req, res) => res.json({ app: 'TuneWave', status: 'ok', providers: sourceHealth() }));

function handleRoute(handler) {
  return async (req, res) => {
    try {
      const body = await handler(req);
      res.json(body);
    } catch (error) {
      const status = Number(error && error.status) || 502;
      console.warn('[TuneWave bridge] Provider route failed:', req.path, status, String(error && error.message || 'unknown error'));
      if (!res.headersSent) res.status(status).json({ error: String(error && error.message || 'Music provider request failed.') });
    }
  };
}

function requireJamendoId() {
  if (!JAMENDO_CLIENT_ID) throw publicError('Jamendo needs JAMENDO_CLIENT_ID configured on the Render bridge service.', 503);
}

async function jamendoSearch(query) {
  requireJamendoId();
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', JAMENDO_CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '25');
  url.searchParams.set('search', query);
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('include', 'licenses');
  const payload = await fetchJson(url.href);
  if (payload.headers && payload.headers.status && payload.headers.status !== 'success') {
    throw publicError('Jamendo rejected the search. Check the client ID configured on Render.', 502);
  }
  return listFrom(payload, ['results']).map(track => {
    const id = str(track.id);
    const audio = httpsUrl(track.audio);
    if (!id || !audio) return null;
    return {
      id,
      jamendoId: id,
      title: firstString(track.name, track.title, 'Untitled track'),
      artist: firstString(track.artist_name, track.artist, 'Unknown artist'),
      duration: Math.max(0, Number(track.duration || 0)),
      image: firstString(track.album_image, track.image, track.artwork),
      audio,
      shareurl: firstString(track.shareurl, track.shorturl, 'https://www.jamendo.com/track/' + encodeURIComponent(id)),
      license_ccurl: firstString(track.license_ccurl, track.license_url)
    };
  }).filter(Boolean);
}

app.get('/api/jamendo/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  const results = await cached('jamendo:' + q.toLowerCase(), () => jamendoSearch(q));
  return { query: q, total: results.length, results };
}));

app.get('/api/jamendo/track/:id', handleRoute(async req => {
  requireJamendoId();
  const id = String(req.params.id || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw publicError('Invalid Jamendo track ID.', 400);
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', JAMENDO_CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('id', id);
  url.searchParams.set('limit', '1');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('include', 'licenses');
  const payload = await fetchJson(url.href);
  const track = listFrom(payload, ['results'])[0];
  if (!track) throw publicError('Jamendo did not return that track.', 404);
  const audio = httpsUrl(track.audio);
  if (!audio) throw publicError('Jamendo did not provide a playable stream for that track.', 404);
  return { track: { id: str(track.id), audio, title: str(track.name), artist: str(track.artist_name) } };
}));

app.get('/api/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  const results = await cached('jamendo:' + q.toLowerCase(), () => jamendoSearch(q));
  return { query: q, total: results.length, results: results.map(track => ({
    id: track.id, title: track.title, artist: track.artist, album: '', artwork: track.image || '',
    audioUrl: track.audio || null, license: track.license_ccurl || null, duration: track.duration || 0, source: 'Jamendo'
  })) };
}));

app.get('/api/audius/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('audius:' + q.toLowerCase(), async () => {
    const url = new URL('https://api.audius.co/v1/tracks/search');
    url.searchParams.set('query', q);
    url.searchParams.set('limit', '35');
    url.searchParams.set('app_name', 'TuneWave');
    const payload = await fetchJson(url.href);
    const results = listFrom(payload, ['data', 'results']).map(track => {
      const id = firstString(track.id, track.track_id);
      const title = firstString(track.title, track.name);
      if (!id || !title || track.is_streamable === false) return null;
      const permalink = firstString(track.permalink, track.url);
      const user = track.user && typeof track.user === 'object' ? track.user : {};
      return {
        id,
        title,
        user: { name: firstString(user.name, user.handle, track.artist_name, track.artist, 'Unknown artist') },
        artist_name: firstString(user.name, user.handle, track.artist_name, track.artist),
        duration: Math.max(0, Number(track.duration || 0)),
        artwork: track.artwork || {},
        permalink,
        is_streamable: track.is_streamable !== false
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

app.get('/api/freetouse/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('freetouse:' + q.toLowerCase(), async () => {
    const url = new URL('https://api.freetouse.com/v3/music/tracks/search');
    url.searchParams.set('query', q);
    url.searchParams.set('limit', '30');
    url.searchParams.set('sort', 'desc');
    const payload = await fetchJson(url.href);
    const results = listFrom(payload, ['data', 'results']).map(track => {
      const id = firstString(track.id, track.uuid);
      const audio = httpsUrl(track.files && track.files.mp3) || httpsUrl(track.audio) || httpsUrl(track.url);
      if (!id || !track.title || !audio || track.is_premium === true) return null;
      const artists = Array.isArray(track.artists) ? track.artists.map(artist => Array.isArray(artist) ? artist[1] : artist) : [];
      return {
        id,
        title: firstString(track.title, track.name, 'Untitled track'),
        creator: firstString(artists.map(artist => artist && artist.name).filter(Boolean).join(', '), track.artist, track.creator, 'Free To Use artist'),
        duration: Math.max(0, Number(track.duration || 0)),
        artwork: firstString(track.thumbnails && (track.thumbnails.md || track.thumbnails.lg || track.thumbnails.sm), track.thumbnail, track.artwork),
        streamUrl: audio,
        permalink: firstString(track.permalink, track.url_page, 'https://freetouse.com/'),
        licenseUrl: 'https://freetouse.com/license',
        licenseName: 'Free To Use License',
        is_premium: false
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

function escapeLucene(value) {
  return String(value).replace(/([+\-&|!(){}\[\]^"~*?:\\/])/g, '\\$1');
}

app.get('/api/archive/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('archive:' + q.toLowerCase(), async () => {
    const term = '"' + escapeLucene(q) + '"';
    const url = new URL('https://archive.org/advancedsearch.php');
    url.searchParams.set('q', 'mediatype:audio AND (title:' + term + ' OR creator:' + term + ' OR subject:' + term + ')');
    ['identifier', 'title', 'creator', 'rights', 'licenseurl'].forEach(field => url.searchParams.append('fl[]', field));
    url.searchParams.set('rows', '25');
    url.searchParams.set('page', '1');
    url.searchParams.set('output', 'json');
    const payload = await fetchJson(url.href);
    const docs = Array.isArray(payload.response && payload.response.docs) ? payload.response.docs : [];
    const results = docs.map(doc => {
      const id = firstString(doc.identifier);
      if (!id) return null;
      return {
        id,
        identifier: id,
        title: firstString(doc.title, id),
        creator: firstString(doc.creator, 'Internet Archive contributor'),
        rights: firstString(doc.rights),
        licenseUrl: firstString(doc.licenseurl),
        permalink: 'https://archive.org/details/' + encodeURIComponent(id),
        artwork: 'https://archive.org/services/img/' + encodeURIComponent(id)
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

app.get('/api/archive/track/:id', handleRoute(async req => {
  const id = String(req.params.id || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,180}$/.test(id)) throw publicError('Invalid Internet Archive item ID.', 400);
  const payload = await cached('archive-track:' + id, () => fetchJson('https://archive.org/metadata/' + encodeURIComponent(id)));
  const files = Array.isArray(payload.files) ? payload.files : [];
  const order = ['.mp3', '.ogg', '.oga', '.opus', '.m4a', '.aac', '.wav', '.flac'];
  const candidates = files.filter(file => {
    const name = String(file.name || '');
    return name && !name.endsWith('/') && file.private !== true && order.some(ext => name.toLowerCase().endsWith(ext));
  }).sort((a,b) => {
    const extension = name => order.findIndex(ext => String(name || '').toLowerCase().endsWith(ext));
    return extension(a.name) - extension(b.name);
  });
  if (!candidates.length) throw publicError('Internet Archive has no supported public audio file for this item.', 404);
  const name = String(candidates[0].name);
  const encodedName = name.split('/').map(part => encodeURIComponent(part)).join('/');
  const streamUrl = 'https://archive.org/download/' + encodeURIComponent(id) + '/' + encodedName;
  return { track: { id, streamUrl } };
}));

app.get('/api/funkwhale/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('funkwhale:' + q.toLowerCase(), async () => {
    const queryUrl = new URL(OPEN_AUDIO_BASE + '/api/v1/tracks/');
    queryUrl.searchParams.set('q', q);
    queryUrl.searchParams.set('page_size', '30');
    let payload = null;
    let records = [];
    try {
      payload = await fetchJson(queryUrl.href, { timeoutMs: 6500 });
      records = listFrom(payload, ['results', 'tracks', 'data']);
    } catch (_) {}
    if (!records.length) {
      const searchUrl = new URL(OPEN_AUDIO_BASE + '/api/v1/search/');
      searchUrl.searchParams.set('q', q);
      searchUrl.searchParams.set('type', 'tracks');
      const searchPayload = await fetchJson(searchUrl.href, { timeoutMs: 6500 });
      records = listFrom(searchPayload, ['tracks', 'results', 'data']);
    }
    const results = records.map(track => {
      const id = firstString(track.uuid, track.listen_token, track.id);
      if (!id || track.playable === false || track.is_playable === false) return null;
      let streamUrl = firstString(track.listen_url, track.listenUrl, track.stream_url, track.audio_url, track.url);
      if (streamUrl && streamUrl.startsWith('/')) streamUrl = new URL(streamUrl, OPEN_AUDIO_BASE).href;
      if (!streamUrl && (track.listen_token || track.uuid)) {
        streamUrl = OPEN_AUDIO_BASE + '/api/v1/listen/' + encodeURIComponent(firstString(track.listen_token, track.uuid)) + '/';
      }
      streamUrl = httpsUrl(streamUrl);
      if (!streamUrl) return null;
      let artist = firstString(track.artist_name, track.artist, track.attributed_to && (track.attributed_to.name || track.attributed_to.fullUsername), track.owner && track.owner.name);
      if (track.artist && typeof track.artist === 'object') artist = firstString(track.artist.name, track.artist.artist_name, artist);
      const cover = track.cover && typeof track.cover === 'object'
        ? firstString(track.cover.urls && (track.cover.urls.original || track.cover.urls.source), track.cover.url)
        : str(track.cover);
      return {
        id,
        title: firstString(track.title, track.name, 'Untitled track'),
        creator: artist || 'Open Audio contributor',
        duration: Math.max(0, Number(track.duration || 0)),
        artwork: firstString(cover, track.album && track.album.cover && track.album.cover.urls && track.album.cover.urls.original, track.album_cover),
        streamUrl,
        permalink: firstString(track.permalink, track.fid, OPEN_AUDIO_BASE + '/library/tracks/' + encodeURIComponent(id)),
        licenseUrl: firstString(track.license_url, track.license && track.license.url),
        licenseName: firstString(track.license_name, track.license && track.license.name),
        rights: firstString(track.license, track.rights)
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

function xmlDecode(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function xmlTag(block, name) {
  const tag = String(name || '').replace(/[^a-zA-Z0-9:_-]/g, '');
  const expression = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'i');
  const match = String(block || '').match(expression);
  return match ? xmlDecode(match[1]) : '';
}

function xmlAudioUrl(block) {
  const candidates = [];
  const enclosure = String(block || '').match(/<(?:enclosure|media:content)\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
  if (enclosure) candidates.push(enclosure[1]);
  const attributes = String(block || '').match(/(?:href|url)=["']([^"']+)["']/gi) || [];
  for (const item of attributes) {
    const match = item.match(/(?:href|url)=["']([^"']+)["']/i);
    if (match && /\.(?:mp3|ogg|oga|opus|wav|flac|m4a)(?:[?#]|$)/i.test(match[1])) candidates.push(match[1]);
  }
  for (let url of candidates) {
    url = xmlDecode(url);
    try {
      const parsed = new URL(url, 'https://ccmixter.org');
      if (parsed.hostname === 'ccmixter.org' || parsed.hostname.endsWith('.ccmixter.org')) parsed.protocol = 'https:';
      if (parsed.protocol === 'https:' && (/^audio\//i.test((enclosure && (String(block).match(/type=["']([^"']+)["']/i) || [])[1]) || '') || /\.(?:mp3|ogg|oga|opus|wav|flac|m4a)(?:[?#]|$)/i.test(parsed.href) || enclosure)) return parsed.href;
    } catch (_) {}
  }
  return '';
}

app.get('/api/ccmixter/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('ccmixter:' + q.toLowerCase(), async () => {
    const url = new URL('https://ccmixter.org/api/query');
    url.searchParams.set('f', 'rss');
    url.searchParams.set('datasource', 'uploads');
    url.searchParams.set('search', q);
    url.searchParams.set('search_type', 'any');
    url.searchParams.set('limit', '25');
    url.searchParams.set('lic', 'by,by-nc,by-sa,by-nc-sa');
    const xml = await fetchText(url.href, { accept: 'application/rss+xml,application/xml,text/xml,*/*' });
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    const results = items.map((item, index) => {
      const title = xmlTag(item, 'title');
      const rawLink = xmlTag(item, 'link');
      const link = rawLink ? new URL(rawLink, 'https://ccmixter.org').href : '';
      const audio = xmlAudioUrl(item);
      if (!title || !audio) return null;
      const guid = xmlTag(item, 'guid');
      const creator = firstString(xmlTag(item, 'dc:creator'), xmlTag(item, 'author'), xmlTag(item, 'itunes:author'), 'ccMixter contributor');
      const licenseMatch = item.match(/(?:cc:license|license)\b[^>]*\b(?:rdf:resource|href)=["']([^"']+)["']/i);
      const licenseUrl = licenseMatch ? xmlDecode(licenseMatch[1]) : '';
      const id = firstString(guid, link, audio, String(index));
      return { id, title, creator, streamUrl: audio, permalink: link || 'https://ccmixter.org/', licenseUrl, licenseName: 'Creative Commons', duration: 0 };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

let openverseTokenPromise = null;
async function getOpenverseToken() {
  if (!OPENVERSE_CLIENT_ID || !OPENVERSE_CLIENT_SECRET) return '';
  if (openverseToken && Date.now() < openverseTokenExpiresAt) return openverseToken;
  if (!openverseTokenPromise) {
    openverseTokenPromise = (async () => {
      const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: OPENVERSE_CLIENT_ID,
        client_secret: OPENVERSE_CLIENT_SECRET
      });
      const payload = await fetchJson('https://api.openverse.org/v1/auth_tokens/token/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        timeoutMs: 7500
      });
      openverseToken = String(payload.access_token || '');
      openverseTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 36000) - 60) * 1000;
      return openverseToken;
    })().finally(() => { openverseTokenPromise = null; });
  }
  return openverseTokenPromise;
}

app.get('/api/openverse/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('openverse:' + q.toLowerCase(), async () => {
    const url = new URL('https://api.openverse.org/v1/audio/');
    url.searchParams.set('q', q);
    url.searchParams.set('page_size', '25');
    url.searchParams.set('page', '1');
    url.searchParams.set('license', 'by,by-sa,by-nc,by-nc-sa,pdm');
    const token = await getOpenverseToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const payload = await fetchJson(url.href, { headers });
    const results = listFrom(payload, ['results']).map(item => {
      const audio = httpsUrl(item.url || item.audio || item.audio_url);
      const id = firstString(item.id, item.identifier, item.detail_url);
      if (!id || !item.title || !audio) return null;
      return {
        id,
        title: firstString(item.title, 'Untitled audio'),
        creator: firstString(item.creator, item.author, 'Openverse contributor'),
        streamUrl: audio,
        permalink: firstString(item.foreign_landing_url, item.detail_url, 'https://openverse.org/'),
        licenseUrl: firstString(item.license_url, item.licenseUrl),
        licenseName: firstString(item.license, item.license_name),
        rights: firstString(item.attribution),
        artwork: firstString(item.thumbnail, item.thumbnail_url),
        duration: Math.max(0, Number(item.duration || 0))
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));

app.get('/api/radio/search', handleRoute(async req => {
  const q = cleanQuery(req.query.q);
  return cached('radio:' + q.toLowerCase(), async () => {
    const url = new URL('https://all.api.radio-browser.info/json/stations/search');
    url.searchParams.set('name', q);
    url.searchParams.set('tag', q);
    url.searchParams.set('limit', '25');
    url.searchParams.set('hidebroken', 'true');
    url.searchParams.set('is_https', 'true');
    url.searchParams.set('order', 'clickcount');
    url.searchParams.set('reverse', 'true');
    const payload = await fetchJson(url.href);
    const results = listFrom(payload, []).map(station => {
      const audio = httpsUrl(station.url_resolved || station.url);
      const id = firstString(station.stationuuid, station.id, station.name);
      if (!id || !audio) return null;
      const homepage = httpsUrl(station.homepage);
      return {
        id,
        title: firstString(station.name, 'Live radio station'),
        creator: firstString(station.tags, station.country, station.language, 'Internet radio'),
        streamUrl: audio,
        permalink: homepage || 'https://www.radio-browser.info/',
        artwork: httpsUrl(station.favicon),
        duration: 0,
        codec: str(station.codec),
        bitrate: Number(station.bitrate || 0)
      };
    }).filter(Boolean);
    return { query: q, total: results.length, results };
  });
}));


app.get('/api/youtube/search', handleRoute(async req => {
  const query = cleanQuery(req.query.q);
  if (!YOUTUBE_API_KEY) {
    throw publicError('YouTube in-page search is not configured yet. Add YOUTUBE_API_KEY to the music bridge service environment on Render.', 503);
  }
  return cached('youtube-search:' + query.toLowerCase(), async () => {
    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '5');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('videoSyndicated', 'true');
    url.searchParams.set('regionCode', 'IN');
    url.searchParams.set('safeSearch', 'moderate');
    url.searchParams.set('key', YOUTUBE_API_KEY);
    const payload = await fetchJson(url.href, { timeoutMs: 11000 });
    const results = (Array.isArray(payload.items) ? payload.items : []).map(item => {
      const videoId = String(item?.id?.videoId || '').trim();
      const snippet = item?.snippet || {};
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
      const thumbnail = snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '';
      return {
        videoId,
        title: String(snippet.title || 'YouTube video').slice(0, 240),
        artist: String(snippet.channelTitle || 'YouTube channel').slice(0, 160),
        thumbnail: httpsUrl(thumbnail),
        url: 'https://www.youtube.com/watch?v=' + videoId,
        embedUrl: 'https://www.youtube-nocookie.com/embed/' + videoId
      };
    }).filter(Boolean);
    return { query, total: results.length, results };
  }, 120000);
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log('TuneWave music-provider bridge listening on port ' + PORT);
});
