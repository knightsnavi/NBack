// Aggregates over session history: summary tiles, trends, records and insights.
import { dayKey, addDays, computeStreak, longestStreak } from './storage.js';

export const STREAM_LABELS = { position: 'Position', sound: 'Sound', color: 'Color' };

export const MODE_LABELS = { dual: 'Dual', triple: 'Triple', position: 'Position', sound: 'Sound' };

/** Sessions of one mode, or everything for 'all'. */
export function filterMode(history, mode) {
  return mode && mode !== 'all' ? history.filter(h => h.mode === mode) : history;
}

/** Modes that have at least one session, in menu order. */
export function modesPlayed(history) {
  const seen = new Set(history.map(h => h.mode));
  return Object.keys(MODE_LABELS).filter(m => seen.has(m));
}

export function summarize(history, now = Date.now()) {
  const today = dayKey(now);
  const byDay = new Map();
  for (const h of history) byDay.set(dayKey(h.ts), (byDay.get(dayKey(h.ts)) || 0) + 1);

  const weekAgo = addDays(now, -6) - 12 * 3600000; // start of the day six days back
  const last7 = history.filter(h => h.ts >= weekAgo);
  const avg = list => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);

  const streamAcc = {};
  const streamRt = {};
  for (const s of ['position', 'sound', 'color']) {
    const recent = history.slice(-20).filter(h => h.perStream && h.perStream[s]);
    streamAcc[s] = avg(recent.map(h => h.perStream[s].accuracy));
    streamRt[s] = avg(recent.map(h => h.perStream[s].meanRt).filter(v => v != null));
  }

  let weakest = null;
  for (const s of Object.keys(streamAcc)) {
    if (streamAcc[s] == null) continue;
    if (!weakest || streamAcc[s] < streamAcc[weakest]) weakest = s;
  }

  const last = history[history.length - 1] || null;
  return {
    sessions: history.length,
    todayCount: byDay.get(today) || 0,
    streak: computeStreak(history, now),
    longestStreak: longestStreak(history),
    bestN: history.reduce((m, h) => Math.max(m, h.n), 0),
    // levels reached in the full game (Dual or Triple), for achievements
    bestFullN: history.reduce((m, h) => (h.mode === 'dual' || h.mode === 'triple' ? Math.max(m, h.n, h.nextN) : m), 0),
    currentN: last ? last.nextN : null,
    avgN7: avg(last7.map(h => h.n)),
    avgAcc7: avg(last7.map(h => h.accuracy)),
    avgAccAll: avg(history.map(h => h.accuracy)),
    totalMs: history.reduce((sum, h) => sum + (h.durationMs || 0), 0),
    bestAccuracy: history.reduce((m, h) => Math.max(m, h.accuracy), 0),
    mostInDay: Math.max(0, ...byDay.values()),
    fastestRt: history.reduce((m, h) => (h.meanRt != null && (m == null || h.meanRt < m) ? h.meanRt : m), null),
    perfectSessions: history.filter(h => h.errors === 0 && h.n >= 2).length,
    streamAcc,
    streamRt,
    weakest,
    byDay,
    last,
  };
}

/** Series for the N trend chart: last `count` sessions. */
export function nTrend(history, count = 30) {
  return history.slice(-count).map((h, i) => ({ x: i, y: h.n, ts: h.ts, label: `${h.n}-back` }));
}

/** Accuracy per stream over the last `count` sessions, one series per stream present. */
export function accuracyTrend(history, count = 30) {
  const recent = history.slice(-count);
  const series = [];
  for (const s of ['position', 'sound', 'color']) {
    const pts = [];
    recent.forEach((h, i) => {
      if (h.perStream && h.perStream[s]) pts.push({ x: i, y: Math.round(h.perStream[s].accuracy * 100), ts: h.ts });
    });
    if (pts.length) series.push({ key: s, name: STREAM_LABELS[s], points: pts });
  }
  return { series, count: recent.length };
}

/** Sessions per day for the last `days` days, oldest first. */
export function dailyCounts(history, days = 14, now = Date.now()) {
  const out = [];
  const byDay = new Map();
  for (const h of history) byDay.set(dayKey(h.ts), (byDay.get(dayKey(h.ts)) || 0) + 1);
  for (let i = days - 1; i >= 0; i--) {
    const ts = addDays(now, -i);
    const key = dayKey(ts);
    out.push({ key, ts, count: byDay.get(key) || 0 });
  }
  return out;
}

export function formatDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function insights(summary, history, settings) {
  const out = [];
  if (!history.length) {
    out.push('Play your first session to start building a trend line.');
    return out;
  }
  const s = summary;
  if (s.weakest && Object.values(s.streamAcc).filter(v => v != null).length > 1) {
    const sorted = Object.entries(s.streamAcc).filter(([, v]) => v != null).sort((a, b) => a[1] - b[1]);
    const gap = Math.round((sorted[sorted.length - 1][1] - sorted[0][1]) * 100);
    if (gap >= 10) {
      out.push(`${STREAM_LABELS[sorted[0][0]]} trails ${STREAM_LABELS[sorted[sorted.length - 1][0]].toLowerCase()} by ${gap} points over your last sessions. A few ${STREAM_LABELS[sorted[0][0]].toLowerCase()}-only sessions can close the gap.`);
    }
  }
  const recent = history.slice(-5);
  if (recent.length >= 5) {
    const fa = recent.reduce((sum, h) => sum + Object.values(h.perStream || {}).reduce((a, m) => a + m.falseAlarms, 0), 0);
    const misses = recent.reduce((sum, h) => sum + Object.values(h.perStream || {}).reduce((a, m) => a + m.misses, 0), 0);
    if (fa > misses * 1.5 && fa >= 5) out.push('You press more often than you miss. Hold back unless you are sure: a skipped guess costs nothing.');
    else if (misses > fa * 1.5 && misses >= 5) out.push('Most of your errors are misses. When something feels familiar, commit and press.');
  }
  if (s.todayCount >= settings.dailyGoal && settings.dailyGoal > 0) out.push('Daily goal done. Research blocks were about 20 minutes a day, so more is fine but not required.');
  else if (s.streak >= 3) out.push(`${s.streak}-day streak. Consistency matters more than session length.`);
  if (s.avgN7 != null && s.bestN > s.avgN7 + 1) out.push(`Your best is ${s.bestN}-back. Recent sessions average ${s.avgN7.toFixed(1)}; dips after a jump are normal.`);
  if (!out.length) out.push('Steady work. Keep sessions short and regular, and let the automatic level do the pacing.');
  return out.slice(0, 3);
}
