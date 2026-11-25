// Tiny translation helper.
// All UI strings live in one JSON file per language (de.json, en.json). To add a language,
// copy de.json, translate the values and add the code to LANGUAGES below.

const LANGUAGES = {
  de: require('./de.json'),
  en: require('./en.json'),
};
const FALLBACK = 'de';

/** Returns the full string table for a language (missing keys fall back to German). */
function dictionary(lang) {
  return { ...LANGUAGES[FALLBACK], ...(LANGUAGES[lang] || {}) };
}

/** Builds a translate function: t('tray.nowPlaying', { title }) → "Läuft: …" */
function translator(lang) {
  const dict = dictionary(lang);
  return (key, vars = {}) =>
    String(dict[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : `{${name}}`));
}

module.exports = { LANGUAGES: Object.keys(LANGUAGES), dictionary, translator };
