// Finds lyrics for the current song: disk cache first, then LRCLIB (/get, then /search).
// Emits 'lyrics' with a result object the wallpaper can show directly:
//   { key, status, synced, plain, title, artist }
//   status: loading | synced | plain | instrumental | notfound | offline | unavailable

const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { LyricsError } = require('./lrclib-client');
const { searchVariants, normalizeName } = require('./normalize');

const NOT_FOUND_TTL_MS = 3 * 24 * 3600 * 1000; // try "not found" songs again after 3 days
const ERROR_RETRY_MS = 60 * 1000;               // retry after a network error if the song still plays
const DEBOUNCE_MS = 600;                         // skipping through songs shouldn't spam LRCLIB

/** Identifies a track independent of playback position. */
function trackKey(media) {
  return `${media.app}|${media.title}|${media.artist}`;
}

class LyricsService extends EventEmitter {
  constructor({ client, cacheDir, log }) {
    super();
    this.client = client;
    this.cacheDir = cacheDir;
    this.log = log;
    this.current = null;     // last published result
    this.media = null;
    this.timer = null;
    this.retryTimer = null;
    this.memory = new Map();
  }

  /** Call with every media update; only a new track triggers a lookup. */
  onMedia(media) {
    if (!media || !media.active || !media.title) {
      this.media = null;
      clearTimeout(this.timer);
      return;
    }
    const key = trackKey(media);
    if (this.media && trackKey(this.media) === key) return;
    this.media = media;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    const variants = searchVariants(media);
    this.publish({ key, status: 'loading', title: variants[0]?.title || media.title, artist: variants[0]?.artist || media.artist });
    this.timer = setTimeout(() => this.lookup(media, key, variants), DEBOUNCE_MS);
  }

  async lookup(media, key, variants) {
    try {
      const found = await this.find(media, variants);
      if (!this.isCurrent(key)) return;
      this.publish({ key, ...found });
    } catch (err) {
      if (!this.isCurrent(key)) return;
      const kind = err instanceof LyricsError ? err.kind : 'unavailable';
      this.log.warn(`Lyrics lookup failed (${kind}):`, err.message);
      this.publish({ key, status: kind, title: variants[0]?.title || media.title, artist: variants[0]?.artist || media.artist });
      this.retryTimer = setTimeout(() => this.isCurrent(key) && this.lookup(media, key, variants), ERROR_RETRY_MS);
    }
  }

  isCurrent(key) {
    return this.media && trackKey(this.media) === key;
  }

  /** Cache → /get with album → /get without album → /search; per title variant. */
  async find(media, variants) {
    const durationSec = media.durationMs > 0 ? media.durationMs / 1000 : 0;
    const base = { title: variants[0].title, artist: variants[0].artist };

    const cached = this.readCache(variants[0]);
    if (cached) return { ...base, ...cached };

    for (const v of variants) {
      let rec = await this.client.get({ title: v.title, artist: v.artist, album: media.album, durationSec });
      if (!rec && media.album) rec = await this.client.get({ title: v.title, artist: v.artist, durationSec });
      if (!rec) rec = pickBest(await this.client.search(v), v, durationSec);
      if (rec) {
        const result = toResult(rec);
        this.log.info(`Lyrics found: "${rec.trackName}" – ${rec.artistName} (${result.status})`);
        this.writeCache(variants[0], result);
        return { ...base, ...result };
      }
    }
    this.log.info(`No lyrics for "${base.title}" – ${base.artist}`);
    const result = { status: 'notfound' };
    this.writeCache(variants[0], result);
    return { ...base, ...result };
  }

  // ── cache ────────────────────────────────────────────────────────────────
  cacheFile(v) {
    const hash = crypto.createHash('sha1').update(`${normalizeName(v.artist)}|${normalizeName(v.title)}`).digest('hex');
    return path.join(this.cacheDir, `${hash}.json`);
  }

  readCache(v) {
    const file = this.cacheFile(v);
    let entry = this.memory.get(file);
    if (!entry) {
      try { entry = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    }
    if (entry.status === 'notfound' && Date.now() - entry.savedAt > NOT_FOUND_TTL_MS) return null;
    this.memory.set(file, entry);
    const { savedAt, ...result } = entry;
    return result;
  }

  writeCache(v, result) {
    const file = this.cacheFile(v);
    const entry = { ...result, savedAt: Date.now() };
    this.memory.set(file, entry);
    try {
      fs.mkdirSync(this.cacheDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(entry));
    } catch (err) {
      this.log.warn('Could not write lyrics cache:', err.message);
    }
  }

  /** Deletes all cached lyrics; returns how many were removed. */
  clearCache() {
    this.memory.clear();
    let count = 0;
    try {
      for (const f of fs.readdirSync(this.cacheDir)) {
        if (f.endsWith('.json')) { fs.unlinkSync(path.join(this.cacheDir, f)); count++; }
      }
    } catch { /* no cache yet */ }
    // look the current song up again
    if (this.media) { const m = this.media; this.media = null; this.onMedia(m); }
    return count;
  }

  publish(result) {
    this.current = result;
    this.emit('lyrics', result);
  }
}

/** LRCLIB record → our result. */
function toResult(rec) {
  if (rec.instrumental) return { status: 'instrumental' };
  if (rec.syncedLyrics) return { status: 'synced', synced: rec.syncedLyrics, plain: rec.plainLyrics || '' };
  if (rec.plainLyrics) return { status: 'plain', plain: rec.plainLyrics };
  return { status: 'notfound' };
}

/** Picks the most plausible search hit: same title/artist, similar duration, synced preferred. */
function pickBest(results, wanted, durationSec) {
  let best = null;
  let bestScore = -Infinity;
  const wt = normalizeName(wanted.title);
  const wa = normalizeName(wanted.artist);
  for (const r of results) {
    if (!r || (!r.syncedLyrics && !r.plainLyrics && !r.instrumental)) continue;
    const rt = normalizeName(r.trackName);
    const ra = normalizeName(r.artistName);
    let score = 0;
    if (rt === wt) score += 50; else if (rt.includes(wt) || wt.includes(rt)) score += 25; else continue;
    if (wa && (ra === wa || ra.includes(wa) || wa.includes(ra))) score += 30;
    if (durationSec > 0 && r.duration) {
      const diff = Math.abs(r.duration - durationSec);
      if (diff > 15) continue;           // clearly another version
      score += 20 - diff;
    }
    if (r.syncedLyrics) score += 15;
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

module.exports = { LyricsService, trackKey, pickBest, toResult };
