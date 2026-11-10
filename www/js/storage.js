// Local persistence. Everything stays on the device (localStorage).
// Export / import give the player a backup path without any account or server.
// Everything read back from storage or from an imported file is validated, so a
// damaged or hand-edited file can never put the app into a broken state.

const KEYS = {
  settings: 'nback.settings.v1',
  history: 'nback.history.v1',
  onboarded: 'nback.onboarded.v1',
  achievements: 'nback.achievements.v1',
  meta: 'nback.meta.v1',
};

export const MODE_IDS = ['dual', 'triple', 'position', 'sound'];
const STREAM_IDS = ['position', 'sound', 'color'];
export const MIN_N = 1;
export const MAX_N = 9;

export const DEFAULT_SETTINGS = Object.freeze({
  levels: Object.freeze({ dual: 1, triple: 1, position: 1, sound: 1 }), // each mode keeps its own level
  adaptive: true,
  progression: 'standard', // 'standard' (under 3 mistakes per button) | 'relaxed' (80% accuracy)
  mode: 'dual',            // 'dual' | 'triple' | 'position' | 'sound'
  length: 'standard',      // 'short' | 'standard' | 'long'
  interval: 3000,          // ms between stimulus onsets
  stimulusMs: 500,         // how long the cell stays lit
  sound: true,
  volume: 0.9,
  voice: 'recorded',       // 'recorded' | 'device'
  tones: true,             // tap / error sounds
  haptics: true,
  feedback: true,          // colour the buttons right/wrong and flag misses
  colorNames: false,       // print the colour's name on the cell (colour-blind aid)
  theme: 'auto',           // 'auto' | 'light' | 'dark'
  palette: 'sunset',       // 'sunset' | 'ocean' | 'candy' | 'forest'
  handed: 'right',         // which side the primary thumb is on
  hingeAware: true,        // split the layout around the fold when half-open
  tutorialVoice: true,     // spoken explanations in the guided tutorial
  dailyGoal: 5,            // sessions per day
  reminders: Object.freeze({ enabled: false, time: '19:00' }),
});

/* ---------- validation ---------- */
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const int = (v, lo, hi, fallback) => (isNum(v) ? clamp(Math.round(v), lo, hi) : fallback);
const num = (v, lo, hi, fallback) => (isNum(v) ? clamp(v, lo, hi) : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/** Returns a complete, valid settings object no matter what it is given. */
export function sanitizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = DEFAULT_SETTINGS;
  const levels = {};
  // Older versions stored one shared level as `n`; carry it into every mode.
  const legacyN = isNum(r.n) ? clamp(Math.round(r.n), MIN_N, MAX_N) : null;
  const rl = r.levels && typeof r.levels === 'object' ? r.levels : {};
  for (const m of MODE_IDS) levels[m] = int(rl[m], MIN_N, MAX_N, legacyN ?? d.levels[m]);
  const interval = int(r.interval, 1500, 5000, d.interval);
  const rem = r.reminders && typeof r.reminders === 'object' ? r.reminders : {};
  return {
    levels,
    adaptive: bool(r.adaptive, d.adaptive),
    progression: oneOf(r.progression, ['standard', 'relaxed'], d.progression),
    mode: oneOf(r.mode, MODE_IDS, d.mode),
    length: oneOf(r.length, ['short', 'standard', 'long'], d.length),
    interval,
    stimulusMs: Math.min(int(r.stimulusMs, 300, 1500, d.stimulusMs), interval - 300),
    sound: bool(r.sound, d.sound),
    volume: num(r.volume, 0, 1, d.volume),
    voice: oneOf(r.voice, ['recorded', 'device'], d.voice),
    tones: bool(r.tones, d.tones),
    haptics: bool(r.haptics, d.haptics),
    feedback: bool(r.feedback, d.feedback),
    colorNames: bool(r.colorNames, d.colorNames),
    theme: oneOf(r.theme, ['auto', 'light', 'dark'], d.theme),
    palette: oneOf(r.palette, ['sunset', 'ocean', 'candy', 'forest'], d.palette),
    handed: oneOf(r.handed, ['right', 'left'], d.handed),
    hingeAware: bool(r.hingeAware, d.hingeAware),
    tutorialVoice: bool(r.tutorialVoice, d.tutorialVoice),
    dailyGoal: int(r.dailyGoal, 0, 30, d.dailyGoal),
    reminders: {
      enabled: bool(rem.enabled, d.reminders.enabled),
      time: typeof rem.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(rem.time) ? rem.time : d.reminders.time,
    },
  };
}

function sanitizeStream(m) {
  if (!m || typeof m !== 'object') return null;
  const hits = int(m.hits, 0, 999, 0);
  const misses = int(m.misses, 0, 999, 0);
  const falseAlarms = int(m.falseAlarms, 0, 999, 0);
  const denom = hits + misses + falseAlarms;
  return {
    hits,
    misses,
    falseAlarms,
    correctRejections: int(m.correctRejections, 0, 999, 0),
    targets: int(m.targets, 0, 999, hits + misses),
    accuracy: num(m.accuracy, 0, 1, denom ? hits / denom : 1),
    errors: misses + falseAlarms,
    meanRt: isNum(m.meanRt) ? clamp(Math.round(m.meanRt), 0, 60000) : null,
  };
}

/** Returns a clean session record, or null when the entry is not usable. */
export function sanitizeEntry(e) {
  if (!e || typeof e !== 'object' || !isNum(e.ts) || e.ts <= 0) return null;
  if (!isNum(e.n) || !MODE_IDS.includes(e.mode)) return null;
  const n = clamp(Math.round(e.n), MIN_N, MAX_N);
  const perStream = {};
  const src = e.perStream && typeof e.perStream === 'object' ? e.perStream : {};
  for (const s of STREAM_IDS) {
    const m = sanitizeStream(src[s]);
    if (m) perStream[s] = m;
  }
  if (!Object.keys(perStream).length) return null;
  const list = Object.values(perStream);
  return {
    ts: Math.round(e.ts),
    n,
    nextN: int(e.nextN, MIN_N, MAX_N, n),
    mode: e.mode,
    length: oneOf(e.length, ['short', 'standard', 'long'], 'standard'),
    trials: int(e.trials, 1, 200, 20 + n),
    interval: int(e.interval, 500, 10000, 3000),
    durationMs: int(e.durationMs, 0, 3600000, 0),
    accuracy: num(e.accuracy, 0, 1, list.reduce((a, m) => a + m.accuracy, 0) / list.length),
    errors: list.reduce((a, m) => a + m.errors, 0),
    meanRt: isNum(e.meanRt) ? clamp(Math.round(e.meanRt), 0, 60000) : null,
    perStream,
  };
}

function sanitizeAchievements(map) {
  const out = {};
  if (map && typeof map === 'object') {
    for (const [id, when] of Object.entries(map)) {
      if (/^[a-z0-9]{1,24}$/.test(id) && isNum(when) && when > 0) out[id] = Math.round(when);
    }
  }
  return out;
}

/* ---------- raw storage ---------- */
let errorHandler = null;
let errorReported = false;

/** Called once if the device refuses to store data (private mode, full storage). */
export function onStorageError(fn) {
  errorHandler = fn;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    if (!errorReported && errorHandler) {
      errorReported = true;
      errorHandler();
    }
    return false;
  }
}

/* ---------- typed accessors ---------- */
export function loadSettings() {
  return sanitizeSettings(read(KEYS.settings, {}));
}

export function saveSettings(settings) {
  return write(KEYS.settings, settings);
}

export function levelFor(settings, mode = settings.mode) {
  return settings.levels[mode] ?? MIN_N;
}

export function setLevel(settings, n, mode = settings.mode) {
  settings.levels[mode] = clamp(Math.round(n), MIN_N, MAX_N);
  return settings.levels[mode];
}

export function loadHistory() {
  const list = read(KEYS.history, []);
  return Array.isArray(list) ? list.map(sanitizeEntry).filter(Boolean) : [];
}

export function appendHistory(entry, limit = 2000) {
  const list = loadHistory();
  const clean = sanitizeEntry(entry);
  if (clean) list.push(clean);
  while (list.length > limit) list.shift();
  write(KEYS.history, list);
  return list;
}

export function replaceHistory(list) {
  write(KEYS.history, list);
  return list;
}

export function clearHistory() {
  write(KEYS.history, []);
}

export function isOnboarded() {
  return read(KEYS.onboarded, false) === true;
}

export function setOnboarded() {
  write(KEYS.onboarded, true);
}

export function loadAchievements() {
  return sanitizeAchievements(read(KEYS.achievements, {}));
}

export function saveAchievements(map) {
  write(KEYS.achievements, map);
}

export function loadMeta() {
  const m = read(KEYS.meta, {});
  return m && typeof m === 'object' ? { watchedVideo: m.watchedVideo === true, lastNotifiedDay: typeof m.lastNotifiedDay === 'string' ? m.lastNotifiedDay : null } : {};
}

export function saveMeta(meta) {
  write(KEYS.meta, meta);
}

/* ---------- calendar days (local time, safe across daylight-saving changes) ---------- */
/** Local calendar day key, e.g. 2026-11-09 */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Timestamp at local noon, `days` calendar days away from `ts`. Never skips or repeats a day. */
export function addDays(ts, days) {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12).getTime();
}

/** Streak of consecutive days with at least one session, ending today or yesterday. */
export function computeStreak(history, now = Date.now()) {
  const days = new Set(history.map(h => dayKey(h.ts)));
  if (days.size === 0) return 0;
  let back = 0;
  if (!days.has(dayKey(now))) {
    back = 1;
    if (!days.has(dayKey(addDays(now, -1)))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(addDays(now, -back)))) {
    streak++;
    back++;
  }
  return streak;
}

/** Longest run of consecutive days ever. */
export function longestStreak(history) {
  const days = [...new Set(history.map(h => dayKey(h.ts)))].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of days) {
    const [y, m, d] = key.split('-').map(Number);
    const noon = new Date(y, m - 1, d, 12).getTime();
    run = prev !== null && dayKey(addDays(prev, 1)) === key ? run + 1 : 1;
    best = Math.max(best, run);
    prev = noon;
  }
  return best;
}

/* ---------- backup ---------- */
export function exportData() {
  return {
    app: 'nback',
    version: 2,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    history: loadHistory(),
    achievements: loadAchievements(),
  };
}

/** Merge an exported file back in. Sessions are validated and de-duplicated by timestamp. */
export function importData(data) {
  if (!data || typeof data !== 'object' || data.app !== 'nback' || !Array.isArray(data.history)) {
    throw new Error('Not an NBack backup file');
  }
  const existing = loadHistory();
  const seen = new Set(existing.map(h => h.ts));
  let added = 0;
  let skipped = 0;
  for (const raw of data.history.slice(0, 20000)) {
    const entry = sanitizeEntry(raw);
    if (!entry) { skipped++; continue; }
    if (seen.has(entry.ts)) continue;
    existing.push(entry);
    seen.add(entry.ts);
    added++;
  }
  existing.sort((a, b) => a.ts - b.ts);
  replaceHistory(existing.slice(-2000));
  saveAchievements({ ...sanitizeAchievements(data.achievements), ...loadAchievements() });
  if (data.settings && typeof data.settings === 'object') saveSettings(sanitizeSettings(data.settings));
  return { added, skipped, total: existing.length };
}

export function historyToCSV(history) {
  const cols = ['date', 'time', 'mode', 'n', 'next_n', 'trials', 'interval_ms', 'duration_s', 'accuracy', 'errors', 'mean_rt_ms',
    'position_accuracy', 'position_hits', 'position_misses', 'position_false_alarms',
    'sound_accuracy', 'sound_hits', 'sound_misses', 'sound_false_alarms',
    'color_accuracy', 'color_hits', 'color_misses', 'color_false_alarms'];
  const rows = [cols.join(',')];
  for (const h of history) {
    const d = new Date(h.ts);
    const ps = s => h.perStream && h.perStream[s];
    const acc = s => (ps(s) ? (ps(s).accuracy * 100).toFixed(1) : '');
    const f = (s, k) => (ps(s) ? ps(s)[k] : '');
    rows.push([
      dayKey(h.ts), d.toTimeString().slice(0, 8), h.mode, h.n, h.nextN, h.trials, h.interval,
      Math.round((h.durationMs || 0) / 1000), (h.accuracy * 100).toFixed(1), h.errors, h.meanRt ?? '',
      acc('position'), f('position', 'hits'), f('position', 'misses'), f('position', 'falseAlarms'),
      acc('sound'), f('sound', 'hits'), f('sound', 'misses'), f('sound', 'falseAlarms'),
      acc('color'), f('color', 'hits'), f('color', 'misses'), f('color', 'falseAlarms'),
    ].join(','));
  }
  return rows.join('\n');
}
