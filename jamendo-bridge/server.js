'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 10000);
const JAMENDO_CLIENT_ID = String(process.env.JAMENDO_CLIENT_ID || '').trim();
const SOUNDCLOUD_CLIENT_ID = String(process.env.SOUNDCLOUD_CLIENT_ID || '').trim();
const SOUNDCLOUD_CLIENT_SECRET = String(process.env.SOUNDCLOUD_CLIENT_SECRET || '').trim();
const soundcloudToken = { accessToken: '', refreshToken: '', expiresAt: 0 };
const DEFAULT_ORIGIN = 'https://tunewave-gtu-rwpd-1.onrender.com';
const ALLOWED_ORIGINS = new Set(
  String(process.env.ALLOWED_ORIGINS || DEFAULT_ORIGIN)
    .split(',').map(s => s.trim()).filter(Boolean).map(s => {
      try { return new URL(s).origin; } catch { return ''; }
    }).filter(Boolean)
);
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = Math.max(10, Number(process.env.RATE_LIMIT_PER_MINUTE || 45));
const rateBuckets = new Map();
const responseCache = new Map();
const CACHE_TTL_MS = 45_000;
const MAX_CACHE_ENTRIES = 120;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');
  if (!origin) return true; // health checks and command-line testing
  let canonical;
  try { canonical = new URL(origin).origin; } catch { return false; }
  if (!ALLOWED_ORIGINS.has(canonical)) return false;
  res.setHeader('Access-Control-Allow-Origin', canonical);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

function isRateLimited(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = forwarded || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.startedAt >= WINDOW_MS) {
    bucket = { startedAt: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  if (rateBuckets.size > 5000) {
    for (const [ip, value] of rateBuckets) if (now - value.startedAt >= WINDOW_MS) rateBuckets.delete(ip);
  }
  return bucket.count > MAX_PER_WINDOW;
}

function cacheGet(key) {
  const item = responseCache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) { responseCache.delete(key); return null; }
  return item.data;
}
function cacheSet(key, data) {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function trustedHttpsUrl(value, allowedHostSuffixes) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:') return '';
    if (!allowedHostSuffixes.some(suffix => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`))) return '';
    return parsed.href;
  } catch { return ''; }
}

function sanitizeLicenseUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
    const trusted = ['creativecommons.org', 'jamendo.com'].some(suffix => parsed.hostname === suffix || parsed.hostname.endsWith(`.${suffix}`));
    if (!trusted) return '';
    parsed.protocol = 'https:';
    return parsed.href;
  } catch { return ''; }
}

function sanitizeTrack(track) {
  const id = String(track?.id || '').trim();
  const audio = trustedHttpsUrl(track?.audio, ['jamendo.com']);
  if (!id || !audio) return null;
  const shareurl = trustedHttpsUrl(track?.shareurl, ['jamendo.com', 'jamen.do']);
  const shorturl = trustedHttpsUrl(track?.shorturl, ['jamendo.com', 'jamen.do']);
  const image = trustedHttpsUrl(track?.image || track?.album_image, ['jamendo.com']);
  const license = sanitizeLicenseUrl(track?.license_ccurl);
  return {
    id,
    name: String(track.name || 'Untitled track').slice(0, 250),
    artist_name: String(track.artist_name || 'Unknown artist').slice(0, 180),
    duration: Math.max(0, Number(track.duration) || 0),
    image,
    audio,
    shareurl: shareurl || shorturl || `https://www.jamendo.com/track/${encodeURIComponent(id)}`,
    shorturl: shorturl || shareurl || `https://www.jamendo.com/track/${encodeURIComponent(id)}`,
    license_ccurl: license,
    audiodownload_allowed: Boolean(track.audiodownload_allowed)
  };
}

async function soundcloudTokenRequest(grantType, refreshToken = '') {
  if (!SOUNDCLOUD_CLIENT_ID || !SOUNDCLOUD_CLIENT_SECRET) {
    const error = new Error('SoundCloud bridge needs SOUNDCLOUD_CLIENT_ID and SOUNDCLOUD_CLIENT_SECRET on Render.');
    error.statusCode = 503;
    throw error;
  }
  const body = new URLSearchParams({ grant_type: grantType });
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (grantType === 'client_credentials') {
    headers.Authorization = 'Basic ' + Buffer.from(`${SOUNDCLOUD_CLIENT_ID}:${SOUNDCLOUD_CLIENT_SECRET}`).toString('base64');
  } else {
    body.set('client_id', SOUNDCLOUD_CLIENT_ID);
    body.set('client_secret', SOUNDCLOUD_CLIENT_SECRET);
    body.set('refresh_token', refreshToken);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST', headers, body, signal: controller.signal
    });
  } catch (error) {
    const wrapped = new Error('Could not reach SoundCloud authentication.');
    wrapped.statusCode = 502;
    throw wrapped;
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const error = new Error(`SoundCloud authentication returned HTTP ${response.status}.`);
    error.statusCode = 502;
    throw error;
  }
  const payload = await response.json();
  if (!payload?.access_token) {
    const error = new Error('SoundCloud did not return an access token. Check the app credentials.');
    error.statusCode = 502;
    throw error;
  }
  soundcloudToken.accessToken = String(payload.access_token);
  if (payload.refresh_token) soundcloudToken.refreshToken = String(payload.refresh_token);
  soundcloudToken.expiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
  return soundcloudToken.accessToken;
}

async function getSoundCloudToken() {
  if (soundcloudToken.accessToken && soundcloudToken.expiresAt > Date.now() + 60000) {
    return soundcloudToken.accessToken;
  }
  if (soundcloudToken.refreshToken) {
    try {
      return await soundcloudTokenRequest('refresh_token', soundcloudToken.refreshToken);
    } catch (_) {
      soundcloudToken.accessToken = '';
      soundcloudToken.refreshToken = '';
      soundcloudToken.expiresAt = 0;
    }
  }
  return soundcloudTokenRequest('client_credentials');
}

async function soundcloudApi(urlOrPath) {
  const token = await getSoundCloudToken();
  const url = new URL(urlOrPath, 'https://api.soundcloud.com');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json; charset=utf-8', 'Authorization': `OAuth ${token}` }
    });
  } catch (error) {
    const wrapped = new Error(error?.name === 'AbortError' ? 'SoundCloud API timed out.' : 'Could not reach SoundCloud API.');
    wrapped.statusCode = 502;
    throw wrapped;
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const error = new Error(`SoundCloud API returned HTTP ${response.status}.`);
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }
  return response.json();
}

function sanitizeSoundCloudTrack(track) {
  const id = String(track?.id || '').trim();
  const permalink = trustedHttpsUrl(track?.permalink_url, ['soundcloud.com', 'on.soundcloud.com']);
  if (!id || !permalink || track?.access === 'blocked' || track?.streamable === false) return null;
  const artwork = trustedHttpsUrl(track?.artwork_url, ['sndcdn.com', 'soundcloud.com']);
  return {
    id,
    title: String(track.title || 'Untitled track').slice(0, 250),
    artist_name: String(track.user?.username || track.publisher_metadata?.artist || 'Unknown artist').slice(0, 180),
    duration: Math.max(0, Math.round((Number(track.duration) || 0) / 1000)),
    artwork_url: artwork,
    permalink_url: permalink,
    access: String(track.access || 'playable')
  };
}

async function soundcloudSearch(query) {
  const url = new URL('https://api.soundcloud.com/tracks');
  url.searchParams.set('q', query);
  url.searchParams.set('access', 'playable');
  url.searchParams.set('limit', '30');
  url.searchParams.set('linked_partitioning', 'true');
  const payload = await soundcloudApi(url.href);
  const collection = Array.isArray(payload) ? payload : (Array.isArray(payload?.collection) ? payload.collection : []);
  return collection.map(sanitizeSoundCloudTrack).filter(Boolean);
}

async function soundcloudStreamUrl(trackId) {
  const track = await soundcloudApi(`/tracks/${encodeURIComponent(trackId)}`);
  if (!track || track.access === 'blocked' || track.streamable === false) {
    const error = new Error('This SoundCloud track is not available for streaming in TuneWave.');
    error.statusCode = 404;
    throw error;
  }
  const token = await getSoundCloudToken();
  const transcodings = Array.isArray(track.media?.transcodings) ? track.media.transcodings : [];
  const progressive = transcodings.find(item => item?.format?.protocol === 'progressive');
  if (!progressive?.url) {
    const error = new Error('SoundCloud did not provide a progressive stream for this track.');
    error.statusCode = 404;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(progressive.url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json; charset=utf-8', 'Authorization': `OAuth ${token}` }
    });
  } catch (_) {
    const error = new Error('Could not resolve the SoundCloud audio stream.');
    error.statusCode = 502;
    throw error;
  } finally { clearTimeout(timer); }
  if (!response.ok) {
    const error = new Error(`SoundCloud stream resolver returned HTTP ${response.status}.`);
    error.statusCode = 502;
    throw error;
  }
  const payload = await response.json();
  const streamUrl = trustedHttpsUrl(payload?.url, ['sndcdn.com']);
  if (!streamUrl) {
    const error = new Error('SoundCloud did not return a trusted playable audio URL.');
    error.statusCode = 502;
    throw error;
  }
  return streamUrl;
}

async function jamendoRequest(params) {
  if (!JAMENDO_CLIENT_ID) {
    const error = new Error('Jamendo bridge is missing the JAMENDO_CLIENT_ID environment variable.');
    error.statusCode = 503;
    throw error;
  }
  const url = new URL('https://api.jamendo.com/v3.0/tracks/');
  url.searchParams.set('client_id', JAMENDO_CLIENT_ID);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '30');
  url.searchParams.set('audioformat', 'mp32');
  url.searchParams.set('imagesize', '500');
  url.searchParams.set('include', 'licenses');
  url.searchParams.set('type', 'single albumtrack');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TuneWave-Jamendo-Bridge/1.0' }
    });
  } catch (error) {
    const wrapped = new Error(error?.name === 'AbortError' ? 'Jamendo API timed out.' : 'Could not reach Jamendo API.');
    wrapped.statusCode = 502;
    throw wrapped;
  } finally { clearTimeout(timer); }

  if (!response.ok) {
    const error = new Error(`Jamendo API returned HTTP ${response.status}.`);
    error.statusCode = response.status === 429 ? 429 : 502;
    throw error;
  }
  const payload = await response.json();
  if (payload?.headers?.status === 'error' || (payload?.headers?.code && Number(payload.headers.code) !== 0)) {
    const error = new Error('Jamendo API rejected the request. Check the developer client ID and API plan.');
    error.statusCode = 502;
    throw error;
  }
  return (Array.isArray(payload?.results) ? payload.results : []).map(sanitizeTrack).filter(Boolean);
}

const server = http.createServer(async (req, res) => {
  if (!applyCors(req, res)) return sendJson(res, 403, { error: 'Origin is not allowed. Update ALLOWED_ORIGINS on the Render service.' });
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Only GET is supported.' });

  let requestUrl;
  try { requestUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`); }
  catch { return sendJson(res, 400, { error: 'Invalid URL.' }); }

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/health') {
    return sendJson(res, 200, {
      ok: true, service: 'tunewave-jamendo-bridge', provider: 'Jamendo',
      configured: Boolean(JAMENDO_CLIENT_ID),
      soundcloudConfigured: Boolean(SOUNDCLOUD_CLIENT_ID && SOUNDCLOUD_CLIENT_SECRET)
    });
  }

  if (requestUrl.pathname.startsWith('/api/soundcloud/')) {
    if (isRateLimited(req)) return sendJson(res, 429, { error: 'Rate limit exceeded. Wait a minute and try again.' });
    try {
      if (requestUrl.pathname === '/api/soundcloud/search') {
        const query = String(requestUrl.searchParams.get('q') || '').trim().replace(/\\s+/g, ' ');
        if (!query || query.length > 120) return sendJson(res, 400, { error: 'Provide a search query between 1 and 120 characters.' });
        const cacheKey = `soundcloud:search:${query.toLowerCase()}`;
        let results = cacheGet(cacheKey);
        if (!results) {
          results = await soundcloudSearch(query);
          cacheSet(cacheKey, results);
        }
        return sendJson(res, 200, { provider: 'SoundCloud', results });
      }
      const match = requestUrl.pathname.match(/^\\/api\\/soundcloud\\/track\\/([0-9]{1,24})$/);
      if (!match) return sendJson(res, 404, { error: 'Route not found.' });
      const streamUrl = await soundcloudStreamUrl(match[1]);
      return sendJson(res, 200, { provider: 'SoundCloud', streamUrl });
    } catch (error) {
      const code = Number(error?.statusCode) || 502;
      console.error(`[soundcloud-bridge] ${code}: ${String(error?.message || 'request failed')}`);
      return sendJson(res, code, { error: String(error?.message || 'SoundCloud request failed.') });
    }
  }

  if (!requestUrl.pathname.startsWith('/api/jamendo/')) return sendJson(res, 404, { error: 'Route not found.' });
  if (isRateLimited(req)) return sendJson(res, 429, { error: 'Rate limit exceeded. Wait a minute and try again.' });

  let params;
  let cacheKey;
  if (requestUrl.pathname === '/api/jamendo/search') {
    const query = String(requestUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
    if (!query || query.length > 120) return sendJson(res, 400, { error: 'Provide a search query between 1 and 120 characters.' });
    params = { namesearch: query };
    cacheKey = `search:${query.toLowerCase()}`;
  } else {
    const match = requestUrl.pathname.match(/^\/api\/jamendo\/track\/([0-9]{1,20})$/);
    if (!match) return sendJson(res, 404, { error: 'Route not found.' });
    params = { id: match[1] };
    cacheKey = `track:${match[1]}`;
  }

  try {
    let results = cacheGet(cacheKey);
    if (!results) {
      results = await jamendoRequest(params);
      cacheSet(cacheKey, results);
    }
    if (requestUrl.pathname === '/api/jamendo/search') return sendJson(res, 200, { provider: 'Jamendo', results });
    if (!results.length) return sendJson(res, 404, { error: 'Jamendo did not return a playable track for that ID.' });
    return sendJson(res, 200, { provider: 'Jamendo', track: results[0] });
  } catch (error) {
    const code = Number(error?.statusCode) || 502;
    // Do not log URLs or credentials; the client ID must remain server-side.
    console.error(`[jamendo-bridge] ${code}: ${String(error?.message || 'request failed')}`);
    return sendJson(res, code, { error: String(error?.message || 'Jamendo request failed.') });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`TuneWave Jamendo bridge listening on ${PORT}; client ID configured: ${Boolean(JAMENDO_CLIENT_ID)}`);
});
