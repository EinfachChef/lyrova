// Every setting Lyrova knows, with its default and how it is validated.
// Used by the main process (settings store) and by the tests. Unknown or invalid values are
// silently replaced by the default, so a broken settings.json can never break the app.

const BACKGROUNDS = ['waves', 'particles', 'stars', 'cover', 'image', 'video'];
const ROLES = ['lyrics', 'clock', 'background', 'off'];

const SCHEMA = {
  language: { default: 'de', oneOf: ['de', 'en'] },

  // What each display shows: { "<display id>": 'lyrics' | 'clock' | 'background' | 'off' }.
  // Displays without an entry: primary → lyrics, all others → clock.
  screens: { default: {}, type: 'screens' },

  // Lyrics screen: background
  background: { default: 'waves', oneOf: BACKGROUNDS },
  backgroundImage: { default: '', type: 'path' },   // copied into the app's data folder
  backgroundVideo: { default: '', type: 'path' },
  backgroundDim: { default: 0.3, min: 0, max: 0.85 },

  // Lyrics appearance
  lyricsStyle: { default: 'column', oneOf: ['column', 'spread', 'karaoke', 'word', 'pixel', 'typewriter', 'neon'] },
  fontFamily: { default: 'Segoe UI Variable Display', type: 'font' },
  fontSize: { default: 1, min: 0.6, max: 1.8 },
  textColor: { default: '#ffffff', type: 'color' },
  accentColor: { default: '#ff9a2e', type: 'color' },
  position: { default: 'center', oneOf: ['center', 'left', 'top', 'bottom'] },
  showSongInfo: { default: true, type: 'boolean' },
  offsetMs: { default: 0, min: -5000, max: 5000 },

  // Bass-reactive effects: 0 = off … 2 = double strength
  glowAmount: { default: 1, min: 0, max: 2 },
  pulseAmount: { default: 1, min: 0, max: 2 },
  particlesAmount: { default: 1, min: 0, max: 2 },
  edgeAmount: { default: 1, min: 0, max: 2 },       // glowing screen border
  edgeColor: { default: '#33ffaa', type: 'color' },
  shakeAmount: { default: 0.6, min: 0, max: 2 },    // whole picture shakes slightly

  // Clock screen (e.g. second display)
  clockStyle: { default: 'modern', oneOf: ['modern', 'glass', 'flip', 'analog', 'words', 'pixel', 'neon'] },
  clockBackground: { default: 'stars', oneOf: BACKGROUNDS },
  clockBackgroundImage: { default: '', type: 'path' },
  clockBackgroundVideo: { default: '', type: 'path' },
  clockColor: { default: '#ffffff', type: 'color' },
  clockSize: { default: 1, min: 0.5, max: 1.8 },
  clockPosition: { default: 'center', oneOf: ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right'] },
  clockSeconds: { default: false, type: 'boolean' },
  clockDate: { default: true, type: 'boolean' },
  clockGreeting: { default: true, type: 'boolean' },
  clockSongCard: { default: true, type: 'boolean' },
  clockLyricLine: { default: true, type: 'boolean' },
  clockText: { default: '', type: 'text' },

  // System
  autostart: { default: true, type: 'boolean' },
  pauseOnFullscreen: { default: true, type: 'boolean' },
  throttleOnBattery: { default: true, type: 'boolean' },
  fps: { default: 60, oneOf: [30, 60] },
  autoUpdate: { default: true, type: 'boolean' },
};

const DEFAULTS = Object.fromEntries(Object.entries(SCHEMA).map(([k, v]) => [k, v.default]));

/** Returns the cleaned value, or undefined if the value is not acceptable. */
function validate(key, value) {
  const rule = SCHEMA[key];
  if (!rule) return undefined;
  if (rule.oneOf) return rule.oneOf.includes(value) ? value : undefined;
  if (rule.min !== undefined) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
    return Math.min(rule.max, Math.max(rule.min, value));
  }
  switch (rule.type) {
    case 'boolean':
      return typeof value === 'boolean' ? value : undefined;
    case 'color':
      return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
    case 'font': {
      if (typeof value !== 'string') return undefined;
      const clean = value.replace(/["'\\;{}<>]/g, '').trim().slice(0, 80);
      return clean || undefined;
    }
    case 'path':
      return typeof value === 'string' && value.length < 1024 && !/[\u0000-\u001f]/.test(value) ? value : undefined;
    case 'text':
      // up to 4 lines of 120 characters, no control characters
      if (typeof value !== 'string') return undefined;
      return value.replace(/\r/g, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
        .split('\n').slice(0, 4).map((l) => l.slice(0, 120)).join('\n');
    case 'screens': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      const out = {};
      for (const [id, role] of Object.entries(value).slice(0, 16)) {
        if (/^\d{1,20}$/.test(id) && ROLES.includes(role)) out[id] = role;
      }
      return out;
    }
    default:
      return undefined;
  }
}

/** Cleans a whole object: keeps valid known keys, drops the rest. */
function sanitize(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const clean = validate(key, value);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
}

/** Role of a display: saved choice, else primary → lyrics, others → clock. */
function roleOf(screens, displayId, isPrimary) {
  return (screens && screens[String(displayId)]) || (isPrimary ? 'lyrics' : 'clock');
}

module.exports = { SCHEMA, DEFAULTS, ROLES, validate, sanitize, roleOf };
