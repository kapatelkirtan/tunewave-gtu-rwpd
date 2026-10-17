'use strict';

const http = require('node:http');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 10000);
const JAMENDO_CLIENT_ID = String(process.env.JAMENDO_CLIENT_ID || '').trim();
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

function isOpenlyLicensedArchiveItem(item) {
  const licenseUrl = String(item?.licenseurl || item?.license_url || '').toLowerCase();
  const rights = String(item?.rights || '').toLowerCase();
  return licenseUrl.includes('creativecommons.org/')
    || /public domain|creative commons|\bcc[- ]?(by|by-sa|by-nc|by-nd|zero|0)\b|cc0\b/.test(rights);
}

function normalizeArchiveSearchItem(item) {
  const identifier = String(item?.identifier || '').trim();
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(identifier) || !isOpenlyLicensedArchiveItem(item)) return null;
  const title = Array.isArray(item.title) ? item.title[0] : item.title;
  const creator = Array.isArray(item.creator) ? item.creator[0] : item.creator;
  const licenseUrl = String(item.licenseurl || item.license_url || '');
  return {
    id: identifier,
    identifier,
    title: String(title || identifier).slice(0, 250),
    creator: String(creator || 'Unknown creator').slice(0, 180),
    year: String(item.year || '').slice(0, 12),
    licenseUrl,
    rights: String(item.rights || '').slice(0, 300),
    permalink: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    artwork: `https://archive.org/services/img/${encodeURIComponent(identifier)}`
  };
}

async function archiveJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TuneWave-Open-Audio-Bridge/1.0' }
    });
    if (!response.ok) {
      const error = new Error(`Internet Archive returned HTTP ${response.status}.`);
      error.statusCode = response.status === 429 ? 429 : 502;
      throw error;
    }
    return await response.json();
  } catch (error) {
    if (error.statusCode) throw error;
    const wrapped = new Error(error?.name === 'AbortError' ? 'Internet Archive request timed out.' : 'Could not reach Internet Archive.');
    wrapped.statusCode = 502;
    throw wrapped;
  } finally { clearTimeout(timer); }
}

function isMusicArchiveItem(item) {
  const title = String(Array.isArray(item?.title) ? item.title.join(' ') : item?.title || '');
  const identifier = String(item?.identifier || '');
  const subjects = (Array.isArray(item?.subject) ? item.subject : [item?.subject])
    .filter(Boolean).join(' ');
  const collection = (Array.isArray(item?.collection) ? item.collection : [item?.collection])
    .filter(Boolean).join(' ');

  // Normalize separators; many Archive identifiers encode words without spaces.
  const normalize = value => String(value || '').toLowerCase().replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ');
  const normalizedIdAndCollection = normalize(identifier + ' ' + collection);
  const normalizedTitle = normalize(title);
  const searchableMetadata = normalize(title + ' ' + subjects + ' ' + collection);

  // Specific spoken-word, broadcast, radio drama, nature and effects collections.
  const nonMusic = /\b(audiobook|audio book|librivox|speech|sermon|lecture|radio show|radio program|old time radio|radio drama|radio mystery|mystery theater|mystery theatre|dramatization|novel|short stories|interview|news broadcast|quran recitation|selected letters|how to sing|stories of great composers|performing arts|nonfiction collection|audio bible|complete broadcast|broadcast day|harry lime|animal sounds?|nature sounds?|field recordings?|sound effects?)\b/i;
  if (nonMusic.test(normalizedIdAndCollection) || nonMusic.test(normalizedTitle)) return false;
  // This Archive item is a LibriVox spoken reading despite not including "librivox" in its identifier.
  if (normalizedIdAndCollection.includes('carol collection 0912') || normalizedTitle === 'christmas carol collection 2009') return false;

  const musicTerms = /\b(music|song|songs|soundtrack|jazz|blues|classical|folk|rock|pop|electronic|ambient|instrumental|orchestra|symphony|concert|album|ep|single|reggae|country|hip hop|rap|funk|soul|metal|punk|trance|techno|house|disco|dance|opera|guitar|piano|violin|viola|cello|mandolin|flute|trumpet|saxophone|drum|percussion|choir|choral|celtic|bluegrass|r&b|rhythm and blues|carol|carols|hymn|hymns|rag|ragtime|march|sonata|concerto|quartet|quintet|etude|prelude|nocturne|overture|musical recording|netlabel|musopen|fox trot|foxtrot)\b/i;
  return musicTerms.test(searchableMetadata);
}
async function archiveSearch(query) {
  const url = new URL('https://archive.org/advancedsearch.php');
  // Keep the broad audio search: the Archive does not consistently tag music with genre subjects.
  // Relevance filtering happens on each result's title/subject/collection metadata below.
  url.searchParams.set('q', '(' + query + ') AND mediatype:audio');
  for (const field of ['identifier', 'title', 'creator', 'year', 'licenseurl', 'rights', 'subject', 'collection']) {
    url.searchParams.append('fl[]', field);
  }
  url.searchParams.set('rows', '100');
  url.searchParams.set('page', '1');
  url.searchParams.set('output', 'json');
  url.searchParams.append('sort[]', 'downloads desc');
  const payload = await archiveJson(url.href);
  const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  return docs.filter(isMusicArchiveItem).map(normalizeArchiveSearchItem).filter(Boolean).slice(0, 20);
}
async function archivePlayableFile(identifier) {
  if (!/^[A-Za-z0-9_-]{3,80}$/.test(identifier)) {
    const error = new Error('Invalid Internet Archive item identifier.');
    error.statusCode = 400;
    throw error;
  }
  const payload = await archiveJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`);
  const metadata = payload?.metadata || {};
  if (!isOpenlyLicensedArchiveItem(metadata)) {
    const error = new Error('This Internet Archive item does not clearly identify a Creative Commons or public-domain licence.');
    error.statusCode = 403;
    throw error;
  }
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const candidates = files.filter(file => {
    const name = String(file?.name || '');
    const lower = name.toLowerCase();
    const format = String(file?.format || '').toLowerCase();
    const audioExtension = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/i.test(lower);
    const audioFormat = /audio|mp3|mpeg|ogg vorbis|flac|aac|wave/i.test(format);
    return (audioExtension || audioFormat)
      && !/\.(xml|json|txt|jpg|jpeg|png|gif|pdf|torrent)$/i.test(lower)
      && !/(sample|spectrogram|thumbnail|_meta|metadata)/i.test(name)
      && file?.private !== 'true';
  });
  const priority = file => {
    const name = String(file?.name || '').toLowerCase();
    if (/\.mp3$/i.test(name)) return 0;
    if (/\.m4a$/i.test(name) || /\.aac$/i.test(name)) return 1;
    if (/\.ogg$/i.test(name) || /\.oga$/i.test(name)) return 2;
    if (/\.opus$/i.test(name)) return 3;
    if (/\.flac$/i.test(name)) return 4;
    if (/\.wav$/i.test(name)) return 5;
    return 6;
  };
  candidates.sort((a, b) => priority(a) - priority(b));
  const file = candidates[0];
  if (!file?.name) {
    const error = new Error('No supported audio file was found for this openly licensed Archive.org item.');
    error.statusCode = 404;
    throw error;
  }
  const filename = String(file.name).split('/').map(encodeURIComponent).join('/');
  const streamUrl = trustedHttpsUrl(`https://archive.org/download/${encodeURIComponent(identifier)}/${filename}`, ['archive.org']);
  if (!streamUrl) {
    const error = new Error('Internet Archive did not return a trusted audio URL.');
    error.statusCode = 502;
    throw error;
  }
  return {
    id: identifier,
    title: String(metadata.title || identifier).slice(0, 250),
    creator: String(metadata.creator || 'Unknown creator').slice(0, 180),
    duration: 0,
    streamUrl,
    permalink: `https://archive.org/details/${encodeURIComponent(identifier)}`,
    licenseUrl: String(metadata.licenseurl || metadata.license_url || ''),
    rights: String(metadata.rights || '').slice(0, 300)
  };
}


const OPENVERSE_CLIENT_ID = String(process.env.OPENVERSE_CLIENT_ID || '').trim();
const OPENVERSE_CLIENT_SECRET = String(process.env.OPENVERSE_CLIENT_SECRET || '').trim();
let openverseToken = '';
let openverseTokenExpiresAt = 0;

async function sourceFetch(url, sourceName, timeoutMs = 10000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: { 'Accept': 'application/json', 'User-Agent': 'TuneWave-Open-Audio-Bridge/1.0', ...(options.headers || {}) }
    });
    if (!response.ok) {
      const error = new Error(sourceName + ' returned HTTP ' + response.status + '.');
      error.statusCode = response.status === 429 ? 429 : 502;
      throw error;
    }
    return response;
  } catch (error) {
    if (error.statusCode) throw error;
    const wrapped = new Error(error && error.name === 'AbortError' ? sourceName + ' request timed out.' : 'Could not reach ' + sourceName + '.');
    wrapped.statusCode = 502;
    throw wrapped;
  } finally { clearTimeout(timer); }
}

function firstText(value) {
  if (Array.isArray(value)) return firstText(value[0]);
  if (value && typeof value === 'object') return String(value.value || value.name || '');
  return String(value || '');
}
function decodeXml(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'").replace(/&#x([0-9a-f]+);/gi, function(_, n) { return String.fromCodePoint(parseInt(n, 16)); })
    .replace(/&#(\d+);/g, function(_, n) { return String.fromCodePoint(Number(n)); })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function xmlTag(block, name) {
  const match = block.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)<\\/' + name + '\\s*>', 'i'));
  return match ? decodeXml(match[1]) : '';
}
function xmlAttribute(block, tag, attribute) {
  const match = block.match(new RegExp('<' + tag + '\\b[^>]*\\b' + attribute + '\\s*=\\s*["\\x27]([^"\\x27]+)', 'i'));
  return match ? decodeXml(match[1]) : '';
}

async function ccMixterSearch(query) {
  const url = new URL('https://ccmixter.org/api/query');
  url.searchParams.set('tags', query);
  url.searchParams.set('type', 'any');
  url.searchParams.set('sort', 'rank');
  url.searchParams.set('f', 'rss');
  const response = await sourceFetch(url.href, 'ccMixter', 10000, { headers: { 'Accept': 'application/rss+xml, application/xml, text/xml' } });
  const xml = await response.text();
  const items = Array.from(xml.matchAll(/<item\b[\s\S]*?<\/item>/gi), function(match) { return match[0]; });
  const tracks = [];
  for (const block of items) {
    const title = xmlTag(block, 'title');
    const permalink = trustedHttpsUrl(xmlTag(block, 'link'), ['ccmixter.org']);
    const enclosure = xmlAttribute(block, 'enclosure', 'url') || xmlAttribute(block, 'media:content', 'url');
    const streamUrl = trustedHttpsUrl(enclosure, ['ccmixter.org']);
    if (!title || !permalink || !streamUrl) continue;
    const rawLicense = xmlAttribute(block, 'cc:license', 'rdf:resource') ||
      xmlAttribute(block, 'cc:license', 'href') ||
      ((block.match(/https?:\/\/creativecommons\.org\/licenses\/[^"' <]+/i) || [])[0] || '');
    const licenseUrl = sanitizeLicenseUrl(rawLicense);
    tracks.push({
      id: permalink, title: title.slice(0, 250),
      creator: (xmlTag(block, 'dc:creator') || xmlTag(block, 'author') || 'ccMixter artist').slice(0, 180),
      duration: 0, streamUrl: streamUrl, permalink: permalink, licenseUrl: licenseUrl,
      licenseName: licenseUrl ? 'Creative Commons' : 'Check source page',
      provider: 'ccMixter'
    });
    if (tracks.length >= 20) break;
  }
  return tracks;
}

function locRightsOkay(record) {
  const item = record && record.item || record || {};
  const text = [item.rights_advisory, item.rights_information, item.rights, item.usage,
    record && record.rights_advisory, record && record.rights_information, record && record.rights]
    .flat(Infinity).filter(Boolean).join(' ').toLowerCase();
  if (/copyright|permission required|restricted|rights status not evaluated|may be under copyright/.test(text)) return false;
  return /public domain|no known restrictions|no known copyright restrictions|creative commons|cc0|rights[- ]free|unrestricted/.test(text);
}
function collectLocFiles(node, out = [], seen = new Set(), depth = 0) {
  if (!node || depth > 8) return out;
  if (Array.isArray(node)) { for (const item of node) collectLocFiles(item, out, seen, depth + 1); return out; }
  if (typeof node !== 'object') return out;
  for (const key of ['download', 'audio', 'filename', 'url']) {
    const candidate = node[key];
    if (typeof candidate === 'string' && /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:$|[?#])/i.test(candidate)) {
      const safe = trustedHttpsUrl(candidate, ['loc.gov']);
      const mime = String(node.mimetype || node.mime_type || node.type || '').toLowerCase();
      if (safe && (!mime || /audio|mpeg|mp3|ogg|flac|wave|aac/.test(mime))) {
        const keyUrl = safe.split('?')[0];
        if (!seen.has(keyUrl)) {
          seen.add(keyUrl);
          out.push({ url: safe, duration: Number(node.duration) || 0, restricted: node.rights_restricted === true || node.download_restricted === true });
        }
      }
    }
  }
  for (const value of Object.values(node)) collectLocFiles(value, out, seen, depth + 1);
  return out;
}
async function locJson(url) {
  const response = await sourceFetch(url, 'Library of Congress', 9000);
  return response.json();
}
async function libraryOfCongressSearch(query) {
  const searchUrl = new URL('https://www.loc.gov/audio/');
  searchUrl.searchParams.set('q', query);
  searchUrl.searchParams.set('fo', 'json');
  searchUrl.searchParams.set('c', '12');
  const search = await locJson(searchUrl.href);
  const items = Array.isArray(search && search.results) ? search.results.slice(0, 10) : [];
  const settled = await Promise.allSettled(items.map(async function(result) {
    let detail = result;
    let files = collectLocFiles(result);
    if (!files.length && result && result.id) {
      let itemUrl;
      try { itemUrl = new URL(result.id); itemUrl.protocol = 'https:'; itemUrl.searchParams.set('fo', 'json'); }
      catch { return null; }
      if (itemUrl.hostname !== 'www.loc.gov' || !itemUrl.pathname.startsWith('/item/')) return null;
      detail = await locJson(itemUrl.href);
      files = collectLocFiles(detail);
    }
    if (!locRightsOkay(detail) || (detail && detail.item && detail.item.access_restricted === true)) return null;
    const playable = files.find(function(file) { return !file.restricted; });
    if (!playable) return null;
    const item = detail && detail.item || result && result.item || result || {};
    const title = firstText(item.title || result.title || detail.title);
    if (!title) return null;
    return {
      id: String(item.id || result.id || title), title: title.slice(0, 250),
      creator: firstText(item.contributor_names || item.creators || item.contributors || item.creator || 'Library of Congress'),
      duration: playable.duration, streamUrl: playable.url,
      permalink: trustedHttpsUrl(item.url || result.id, ['loc.gov']) || 'https://www.loc.gov/audio/',
      licenseUrl: '', rights: firstText(item.rights_advisory || item.rights_information || item.rights || 'No known restrictions'),
      provider: 'Library of Congress'
    };
  }));
  return settled.filter(function(x) { return x.status === 'fulfilled' && x.value; }).map(function(x) { return x.value; }).slice(0, 10);
}

async function getOpenverseToken() {
  if (!OPENVERSE_CLIENT_ID || !OPENVERSE_CLIENT_SECRET) {
    const error = new Error('Openverse is not enabled. Add OPENVERSE_CLIENT_ID and OPENVERSE_CLIENT_SECRET in Render environment variables.');
    error.statusCode = 503;
    throw error;
  }
  if (openverseToken && Date.now() < openverseTokenExpiresAt) return openverseToken;
  const body = new URLSearchParams({ client_id: OPENVERSE_CLIENT_ID, client_secret: OPENVERSE_CLIENT_SECRET, grant_type: 'client_credentials' });
  const response = await sourceFetch('https://api.openverse.org/v1/auth_tokens/token/', 'Openverse authentication', 9000, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' }, body: body.toString()
  });
  const payload = await response.json();
  if (!payload || !payload.access_token) {
    const error = new Error('Openverse did not issue an access token. Check its credentials.');
    error.statusCode = 502;
    throw error;
  }
  openverseToken = String(payload.access_token);
  openverseTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000 - 30000;
  return openverseToken;
}
async function openverseSearch(query) {
  const token = await getOpenverseToken();
  const url = new URL('https://api.openverse.org/v1/audio/');
  url.searchParams.set('q', query);
  url.searchParams.set('page_size', '20');
  url.searchParams.set('license', 'cc0,pdm,by,by-sa,by-nc,by-nc-sa,by-nd,by-nc-nd');
  const response = await sourceFetch(url.href, 'Openverse', 10000, { headers: { 'Authorization': 'Bearer ' + token } });
  const payload = await response.json();
  return (Array.isArray(payload && payload.results) ? payload.results : []).map(function(item) {
    const directUrl = (function() {
      try { const u = new URL(String(item.url || '')); return u.protocol === 'https:' ? u.href : ''; }
      catch { return ''; }
    })();
    const license = String(item.license_url || '');
    if (!directUrl || !license || !/creativecommons\.org|publicdomain|creativecommons/i.test(license)) return null;
    const durationValue = Number(item.duration) || 0;
    return {
      id: String(item.id || item.detail_url || directUrl), title: String(item.title || 'Untitled audio').slice(0, 250),
      creator: String(item.creator || 'Openverse contributor').slice(0, 180),
      duration: Math.max(0, Math.round(durationValue > 10000 ? durationValue / 1000 : durationValue)),
      streamUrl: directUrl, permalink: String(item.foreign_landing_url || item.detail_url || ''), licenseUrl: license,
      licenseName: String(item.license || ''), rights: String(item.attribution || ''), provider: 'Openverse'
    };
  }).filter(Boolean).slice(0, 20);
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
      internetArchiveEnabled: true,
      ccMixterEnabled: true,
      libraryOfCongressEnabled: true,
      openverseEnabled: Boolean(OPENVERSE_CLIENT_ID && OPENVERSE_CLIENT_SECRET)
    });
  }


  if (requestUrl.pathname.startsWith('/api/ccmixter/') || requestUrl.pathname.startsWith('/api/loc/') || requestUrl.pathname.startsWith('/api/openverse/')) {
    if (isRateLimited(req)) return sendJson(res, 429, { error: 'Rate limit exceeded. Wait a minute and try again.' });
    const provider = requestUrl.pathname.startsWith('/api/ccmixter/') ? 'ccmixter'
      : requestUrl.pathname.startsWith('/api/loc/') ? 'loc' : 'openverse';
    if (requestUrl.pathname !== '/api/' + provider + '/search') return sendJson(res, 404, { error: 'Route not found.' });
    const query = String(requestUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
    if (!query || query.length > 100) return sendJson(res, 400, { error: 'Provide a search query between 1 and 100 characters.' });
    const cacheKey = provider + ':search:' + query.toLowerCase();
    try {
      let results = cacheGet(cacheKey);
      if (!results) {
        results = provider === 'ccmixter' ? await ccMixterSearch(query)
          : provider === 'loc' ? await libraryOfCongressSearch(query)
          : await openverseSearch(query);
        cacheSet(cacheKey, results);
      }
      const providerName = provider === 'ccmixter' ? 'ccMixter' : provider === 'loc' ? 'Library of Congress' : 'Openverse';
      return sendJson(res, 200, { provider: providerName, results });
    } catch (error) {
      const code = Number(error && error.statusCode) || 502;
      console.error('[' + provider + '-bridge] ' + code + ': ' + String(error && error.message || 'request failed'));
      return sendJson(res, code, { error: String(error && error.message || provider + ' request failed.') });
    }
  }

  if (requestUrl.pathname.startsWith('/api/archive/')) {
    if (isRateLimited(req)) return sendJson(res, 429, { error: 'Rate limit exceeded. Wait a minute and try again.' });
    try {
      if (requestUrl.pathname === '/api/archive/search') {
        const query = String(requestUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ');
        if (!query || query.length > 100) return sendJson(res, 400, { error: 'Provide a search query between 1 and 100 characters.' });
        const cacheKey = `archive:search:${query.toLowerCase()}`;
        let results = cacheGet(cacheKey);
        if (!results) {
          results = await archiveSearch(query);
          cacheSet(cacheKey, results);
        }
        return sendJson(res, 200, { provider: 'Internet Archive', results });
      }
      const match = requestUrl.pathname.match(/^\/api\/archive\/track\/([A-Za-z0-9_-]{3,80})$/);
      if (!match) return sendJson(res, 404, { error: 'Route not found.' });
      const cacheKey = `archive:track:${match[1]}`;
      let track = cacheGet(cacheKey);
      if (!track) {
        track = await archivePlayableFile(match[1]);
        cacheSet(cacheKey, track);
      }
      return sendJson(res, 200, { provider: 'Internet Archive', track });
    } catch (error) {
      const code = Number(error?.statusCode) || 502;
      console.error(`[archive-bridge] ${code}: ${String(error?.message || 'request failed')}`);
      return sendJson(res, code, { error: String(error?.message || 'Internet Archive request failed.') });
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
