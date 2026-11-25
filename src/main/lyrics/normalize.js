// Cleans up titles and artists from media players, so LRCLIB can find them.
// Examples:
//   "Song (Official Video) [4K]"                → "Song"
//   "Song (feat. Someone) [From XY: Score]"     → "Song"
//   "Artist - Song" (YouTube, artist "ArtistVEVO") → title "Song", artist "Artist"
//   "Song - Remastered 2011"                    → "Song"

// Words that mark a bracket as "noise" rather than part of the title
const NOISE = /\b(official|video|audio|lyrics?|lyric video|visuali[sz]er|music video|mv|hd|hq|4k|explicit|clean|remaster(ed)?|from|prod\.?|ft\.?|feat\.?|featuring|with|version|edit|sped up|slowed|reverb|nightcore|live)\b/i;

const BROWSER_APPS = /chrome|msedge|firefox|opera|brave|vivaldi|arc/i;

function collapse(s) {
  return s.replace(/\s{2,}/g, ' ').trim();
}

/** Removes noisy (…) / […] / 【…】 parts, "feat." tails and " - Remastered" suffixes. */
function cleanTitle(title) {
  let t = String(title || '');
  t = t.replace(/[([【]([^)\]】]*)[)\]】]/g, (m, inner) => (NOISE.test(inner) ? ' ' : m));
  t = t.replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '');
  t = t.replace(/\s+-\s+((\d{4}\s+)?remaster(ed)?.*|radio edit|single version|mono|stereo|live.*|bonus track)$/i, '');
  t = t.replace(/\s*\|.*$/, '');                // "Song | Some Channel"
  t = t.replace(/["“”]/g, '');
  return collapse(t);
}

/** Removes channel suffixes and collaborators; returns the main artist. */
function cleanArtist(artist) {
  let a = String(artist || '');
  a = a.replace(/\s*-\s*topic$/i, '').replace(/vevo$/i, '').replace(/\s*official$/i, '');
  a = a.split(/\s*(?:,|&|\bx\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bund\b|\band\b)\s*/i)[0];
  return collapse(a);
}

/** Lowercase, without accents and punctuation – for comparing names. */
function normalizeName(s) {
  return String(s || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Builds the search variants for a media session, best guess first.
 * @returns {{title:string, artist:string}[]}
 */
function searchVariants({ title, artist, app }) {
  const variants = [];
  const add = (t, a) => {
    const v = { title: cleanTitle(t), artist: cleanArtist(a) };
    if (v.title && !variants.some((x) => x.title === v.title && x.artist === v.artist)) variants.push(v);
  };
  const rawTitle = String(title || '');
  // YouTube & co.: the "title" often is "Artist - Song", the artist is the channel name
  const dash = rawTitle.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash && (BROWSER_APPS.test(app || '') || /vevo|topic|official/i.test(artist || ''))) {
    add(dash[2], dash[1]);
  }
  add(rawTitle, artist);
  if (dash) add(dash[2], dash[1]);
  // "Song - Hardstyle", "Song - Sped Up", "Song - Acoustic": also try without the short suffix
  const suffix = rawTitle.match(/^(.+?)\s+[-–—]\s+([^-–—]{2,30})$/);
  if (suffix && suffix[2].trim().split(/\s+/).length <= 3) add(suffix[1], artist);
  return variants;
}

module.exports = { cleanTitle, cleanArtist, normalizeName, searchVariants };
