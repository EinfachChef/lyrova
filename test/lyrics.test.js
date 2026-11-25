const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseLRC } = require('../src/renderer/common/lrc');
const { splitWords } = require('../src/renderer/common/words');
const { cleanTitle, cleanArtist, searchVariants } = require('../src/main/lyrics/normalize');
const { LyricsService, pickBest } = require('../src/main/lyrics/lyrics-service');
const { LrclibClient } = require('../src/main/lyrics/lrclib-client');

const quiet = { info() {}, warn() {}, error() {} };

test('LRC: times, several tags per line, metadata and offset', () => {
  const lines = parseLRC('[ar:Someone]\n[offset:+500]\n[00:01.50]First\n[00:10.00][00:20.25]Again\n[01:02.3]Late\nno tag');
  assert.deepStrictEqual(lines.map((l) => l.time), [1000, 9500, 19750, 61800]);
  assert.deepStrictEqual(lines.map((l) => l.text), ['First', 'Again', 'Again', 'Late']);
});

test('LRC: empty lines stay (instrumental breaks) and word tags are removed', () => {
  const lines = parseLRC('[00:05.00]<00:05.00>one <00:05.50>two\n[00:08.00]');
  assert.strictEqual(lines[0].text, 'one two');
  assert.strictEqual(lines[1].text, '');
});

test('titles: noise brackets, feat., remaster suffixes are removed', () => {
  assert.strictEqual(cleanTitle('Song (Official Video) [4K]'), 'Song');
  assert.strictEqual(cleanTitle('Flower In A Hurricane (feat. Tame Impala, SZA) [From GTAVI: Original Score]'), 'Flower In A Hurricane');
  assert.strictEqual(cleanTitle('Here Comes The Sun - Remastered 2009'), 'Here Comes The Sun');
  assert.strictEqual(cleanTitle('Song ft. Other Artist'), 'Song');
  assert.strictEqual(cleanTitle('Love (Part II)'), 'Love (Part II)'); // real title brackets stay
});

test('artists: channel suffixes and collaborators', () => {
  assert.strictEqual(cleanArtist('ArtistVEVO'), 'Artist');
  assert.strictEqual(cleanArtist('Artist - Topic'), 'Artist');
  assert.strictEqual(cleanArtist('Artist, Other & Third'), 'Artist');
});

test('YouTube "Artist - Title" is split when playing in a browser', () => {
  const v = searchVariants({ title: 'Daft Punk - One More Time (Official Video)', artist: 'Daft Punk', app: 'chrome.exe' });
  assert.deepStrictEqual(v[0], { title: 'One More Time', artist: 'Daft Punk' });
});

test('search hits: the matching version with similar duration wins', () => {
  const best = pickBest([
    { trackName: 'Song', artistName: 'Band', duration: 300, syncedLyrics: '[00:01.00]x' },
    { trackName: 'Song', artistName: 'Band', duration: 201, syncedLyrics: '[00:01.00]y' },
    { trackName: 'Other', artistName: 'Band', duration: 200, syncedLyrics: '[00:01.00]z' },
  ], { title: 'Song', artist: 'Band' }, 200);
  assert.strictEqual(best.duration, 201);
});

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [part, reply] of routes) {
      if (url.includes(part)) {
        if (reply === 'network') throw new Error('ENOTFOUND');
        return { status: reply.status, ok: reply.status < 300, json: async () => reply.body };
      }
    }
    return { status: 404, ok: false, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

function service(fetch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lyrova-test-'));
  const client = new LrclibClient({ fetch, userAgent: 'test', retryDelays: [1, 1], log: quiet });
  return new LyricsService({ client, cacheDir: dir, log: quiet });
}

const song = { active: true, app: 'Spotify.exe', title: 'Song', artist: 'Band', album: 'Album', durationMs: 200000 };

function nextFinal(svc) {
  return new Promise((resolve) => svc.on('lyrics', (r) => r.status !== 'loading' && resolve(r)));
}

test('service: /get hit, then cached (no second request)', async () => {
  const fetch = fakeFetch([['/get', { status: 200, body: { trackName: 'Song', artistName: 'Band', syncedLyrics: '[00:01.00]Hi' } }]]);
  const svc = service(fetch);
  let p = nextFinal(svc);
  svc.onMedia(song);
  assert.strictEqual((await p).status, 'synced');
  const before = fetch.calls.length;
  svc.media = null;
  p = nextFinal(svc);
  svc.onMedia(song);
  assert.strictEqual((await p).status, 'synced');
  assert.strictEqual(fetch.calls.length, before);
});

test('service: falls back to /search when /get has nothing', async () => {
  const fetch = fakeFetch([['/search', { status: 200, body: [{ trackName: 'Song', artistName: 'Band', duration: 200, plainLyrics: 'a\nb' }] }]]);
  const svc = service(fetch);
  const p = nextFinal(svc);
  svc.onMedia(song);
  const r = await p;
  assert.strictEqual(r.status, 'plain');
  assert.ok(fetch.calls.some((u) => u.includes('/search')));
});

test('service: no internet → "offline", nothing found → "notfound"', async () => {
  let svc = service(fakeFetch([['lrclib', 'network']]));
  let p = nextFinal(svc);
  svc.onMedia(song);
  assert.strictEqual((await p).status, 'offline');
  clearTimeout(svc.retryTimer);

  svc = service(fakeFetch([['/search', { status: 200, body: [] }]]));
  p = nextFinal(svc);
  svc.onMedia(song);
  assert.strictEqual((await p).status, 'notfound');
});

test('words: each word gets its own time, long pauses get an empty word', () => {
  const w = splitWords([{ time: 1000, text: 'one two three' }, { time: 20000, text: 'next' }]);
  assert.deepStrictEqual(w.slice(0, 3).map((x) => x.text), ['one', 'two', 'three']);
  assert.ok(w[1].time > 1000 && w[2].time > w[1].time && w[2].time < 4000);
  assert.strictEqual(w[3].text, '');
  assert.strictEqual(w[4].text, 'next');
});
