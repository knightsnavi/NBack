// Local persistence. Everything stays on the device (localStorage).
// Export / import give the player a backup path without any account or server.

const KEYS = {
  settings: 'nback.settings.v1',
  history: 'nback.history.v1',
  onboarded: 'nback.onboarded.v1',
  achievements: 'nback.achievements.v1',
  meta: 'nback.meta.v1',
};

export const DEFAULT_SETTINGS = Object.freeze({
  n: 2,
  adaptive: true,
  mode: 'dual',          // 'position' | 'sound' | 'dual' | 'triple'
  length: 'standard',    // 'short' | 'standard' | 'long'
  interval: 3000,        // ms between stimulus onsets
  stimulusMs: 500,       // how long the cell stays lit
  sound: true,
  volume: 0.9,
  voice: 'recorded',     // 'recorded' | 'device'
  tones: true,           // tap / error tones
  haptics: true,
  feedback: true,        // colour the buttons right/wrong and flag misses
  colorNames: false,     // print the colour's name on the cell (colour-blind aid)
  theme: 'auto',         // 'auto' | 'light' | 'dark'
  palette: 'sunset',     // 'sunset' | 'ocean' | 'candy' | 'forest'
  handed: 'right',       // which side the primary thumb is on
  hingeAware: true,      // split the layout around the fold when half-open
  tutorialVoice: true,   // spoken explanations in the guided tutorial
  dailyGoal: 5,          // sessions per day
  reminders: { enabled: false, time: '19:00' },
});

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
    return false; // private mode or quota; the game still works for this visit
  }
}

export function loadSettings() {
  const stored = read(KEYS.settings, {});
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    reminders: { ...DEFAULT_SETTINGS.reminders, ...(stored.reminders || {}) },
  };
}

export function saveSettings(settings) {
  return write(KEYS.settings, settings);
}

export function loadHistory() {
  const list = read(KEYS.history, []);
  return Array.isArray(list) ? list : [];
}

export function appendHistory(entry, limit = 2000) {
  const list = loadHistory();
  list.push(entry);
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
  const map = read(KEYS.achievements, {});
  return map && typeof map === 'object' ? map : {};
}

export function saveAchievements(map) {
  write(KEYS.achievements, map);
}

export function loadMeta() {
  return read(KEYS.meta, {});
}

export function saveMeta(meta) {
  write(KEYS.meta, meta);
}

/** Local calendar day key, e.g. 2026-11-09 */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Streak of consecutive days with at least one session, ending today or yesterday. */
export function computeStreak(history, now = Date.now()) {
  const days = new Set(history.map(h => dayKey(h.ts)));
  if (days.size === 0) return 0;
  const DAY = 86400000;
  let cursor = now;
  if (!days.has(dayKey(cursor))) {
    cursor = now - DAY;
    if (!days.has(dayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak++;
    cursor -= DAY;
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
    const t = new Date(`${key}T12:00:00`).getTime();
    run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export function exportData() {
  return {
    app: 'nback',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: loadSettings(),
    history: loadHistory(),
    achievements: loadAchievements(),
  };
}

/** Merge an exported file back in. Sessions are de-duplicated by timestamp. */
export function importData(data) {
  if (!data || data.app !== 'nback' || !Array.isArray(data.history)) {
    throw new Error('Not an NBack backup file');
  }
  const existing = loadHistory();
  const seen = new Set(existing.map(h => h.ts));
  let added = 0;
  for (const entry of data.history) {
    if (entry && typeof entry.ts === 'number' && !seen.has(entry.ts)) {
      existing.push(entry);
      seen.add(entry.ts);
      added++;
    }
  }
  existing.sort((a, b) => a.ts - b.ts);
  replaceHistory(existing);
  if (data.achievements && typeof data.achievements === 'object') {
    saveAchievements({ ...data.achievements, ...loadAchievements() });
  }
  if (data.settings && typeof data.settings === 'object') {
    saveSettings({ ...loadSettings(), ...data.settings, reminders: { ...loadSettings().reminders, ...(data.settings.reminders || {}) } });
  }
  return { added, total: existing.length };
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
