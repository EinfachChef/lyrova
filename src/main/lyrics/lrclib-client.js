// Talks to LRCLIB (https://lrclib.net) – free, no account, no API key.
// Polite: identifies itself with a User-Agent, at most one request at a time with a short gap,
// and retries temporary failures with growing pauses.

class LyricsError extends Error {
  /** @param {'offline'|'unavailable'} kind */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

const BASE = 'https://lrclib.net/api';
const MIN_GAP_MS = 400;

class LrclibClient {
  /**
   * @param {{ fetch: Function, userAgent: string, retryDelays?: number[], log?: object }} opts
   */
  constructor({ fetch, userAgent, retryDelays = [1500, 4000], log = console }) {
    this.fetch = fetch;
    this.userAgent = userAgent;
    this.retryDelays = retryDelays;
    this.log = log;
    this.queue = Promise.resolve();
    this.lastRequestAt = 0;
  }

  /** Exact lookup. Returns the record or null when LRCLIB has nothing (404). */
  async get({ title, artist, album, durationSec }) {
    const params = new URLSearchParams({ track_name: title, artist_name: artist });
    if (album) params.set('album_name', album);
    if (durationSec > 0) params.set('duration', String(Math.round(durationSec)));
    return this.request(`/get?${params}`, true);
  }

  /** Fuzzy search. Returns an array (possibly empty). */
  async search({ title, artist }) {
    const params = new URLSearchParams({ track_name: title });
    if (artist) params.set('artist_name', artist);
    const result = await this.request(`/search?${params}`, false);
    return Array.isArray(result) ? result : [];
  }

  /** Serializes requests (one at a time, small gap) and retries temporary errors. */
  request(pathAndQuery, notFoundIsNull) {
    const run = async () => {
      for (let attempt = 0; ; attempt++) {
        const wait = this.lastRequestAt + MIN_GAP_MS - Date.now();
        if (wait > 0) await sleep(wait);
        this.lastRequestAt = Date.now();
        try {
          return await this.once(pathAndQuery, notFoundIsNull);
        } catch (err) {
          const retryable = err instanceof LyricsError;
          if (!retryable || attempt >= this.retryDelays.length) throw err;
          await sleep(this.retryDelays[attempt]);
        }
      }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }

  async once(pathAndQuery, notFoundIsNull) {
    let res;
    try {
      res = await this.fetch(BASE + pathAndQuery, {
        headers: { 'User-Agent': this.userAgent, 'Lrclib-Client': this.userAgent, Accept: 'application/json' },
      });
    } catch (err) {
      throw new LyricsError('offline', err.message || 'network error');
    }
    if (res.status === 404 && notFoundIsNull) return null;
    if (res.status === 429 || res.status >= 500) throw new LyricsError('unavailable', `HTTP ${res.status}`);
    if (!res.ok) return notFoundIsNull ? null : [];
    try {
      return await res.json();
    } catch {
      throw new LyricsError('unavailable', 'invalid response');
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { LrclibClient, LyricsError };
