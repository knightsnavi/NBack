// Progress: trends, records, achievements, the session log, and backup tools.
// Levels only mean something within one mode, so the screen is filtered by mode.
import { $, toast, confirmDialog } from '../dom.js';
import { state } from '../state.js';
import * as S from '../storage.js';
import * as ST from '../stats.js';
import { ACHIEVEMENTS } from '../achievements.js';
import { lineChart, barChart, heatmap } from '../charts.js';
import * as N from '../native.js';

let historyShown = 15;

/** The mode the screen is filtered to: the player's pick, else the current mode if it has data, else everything. */
function activeFilter() {
  const played = ST.modesPlayed(state.history);
  if (state.statsMode === 'all' || played.includes(state.statsMode)) return state.statsMode;
  return played.includes(state.settings.mode) ? state.settings.mode : 'all';
}

function renderFilter(filter) {
  const played = ST.modesPlayed(state.history);
  const box = $('#stats-modes');
  box.hidden = played.length < 2;
  box.innerHTML = [['all', 'All'], ...played.map(m => [m, ST.MODE_LABELS[m]])]
    .map(([id, label]) => `<button class="chip" role="radio" data-filter="${id}" aria-checked="${id === filter}">${label}</button>`).join('');
}

export function renderProgress() {
  const s = state.settings;
  const filter = activeFilter();
  const all = state.history;
  const h = ST.filterMode(all, filter);
  const sum = ST.summarize(h);
  const overall = filter === 'all' ? sum : ST.summarize(all);
  const pct = v => (v == null ? '—' : `${Math.round(v * 100)}%`);
  const scope = filter === 'all' ? 'all modes' : ST.MODE_LABELS[filter];

  renderFilter(filter);

  $('#stats-tiles').innerHTML = [
    [sum.sessions, 'sessions'],
    filter === 'all' ? [sum.byDay.size, 'days trained'] : [`${S.levelFor(s, filter)}-back`, 'level now'],
    [sum.bestN ? `${sum.bestN}-back` : '—', 'best level'],
    [pct(sum.avgAcc7), 'last 7 days'],
    [`${overall.streak} 🔥`, 'day streak'],
    [sum.totalMs ? ST.formatDuration(sum.totalMs) : '0 min', 'trained'],
  ].map(([v, l]) => `<div class="tile"><b>${v}</b><span>${l}</span></div>`).join('');

  $('#hint-n').textContent = `Level per session, last 30 sessions · ${scope}`;
  $('#hint-acc').textContent = `Percent correct, last 30 sessions · ${scope}`;

  // hero chart on the other screen when half-open
  $('#stage-alt').innerHTML = `<div class="card hero-chart"><div><b>Level over time</b> <span class="muted">· ${scope}</span></div><div id="chart-hero" class="chart-box"></div></div>`;
  requestAnimationFrame(() => {
    if (state.screen !== 'stats') return;
    const trend = { series: [{ key: 'n', name: 'Level', points: ST.nTrend(h) }], count: Math.min(30, Math.max(2, h.length)), yMin: 1, yMax: Math.max(4, sum.bestN + 1), yTicks: Math.min(4, Math.max(2, sum.bestN)), yFormat: v => String(Math.round(v)), step: true };
    const hero = $('#chart-hero');
    if (hero && hero.clientHeight) lineChart(hero, { ...trend, height: Math.max(90, hero.clientHeight) });
    lineChart($('#chart-n'), { ...trend, height: 170 });
    const acc = ST.accuracyTrend(h);
    $('#legend-acc').innerHTML = acc.series.map(sr => `<span><span class="dot" style="background:var(--series-${sr.key})"></span>${sr.name}</span>`).join('');
    lineChart($('#chart-acc'), { series: acc.series, count: Math.max(2, acc.count), yMin: 0, yMax: 100, yTicks: 4, yFormat: v => `${Math.round(v)}%`, height: 170 });
    barChart($('#chart-days'), { bars: ST.dailyCounts(all, 14), goal: s.dailyGoal, height: 140 });
    heatmap($('#chart-heat'), { byDay: overall.byDay, weeks: 12, dayKeyFn: S.dayKey, addDaysFn: S.addDays });
  });

  $('#insights').innerHTML = ST.insights(sum, h, s).map(t => `<li>${t}</li>`).join('');

  const rec = [
    ['Best level', sum.bestN ? `${sum.bestN}-back` : '—'],
    ['Best accuracy', h.length ? pct(sum.bestAccuracy) : '—'],
    ['Longest streak', `${overall.longestStreak} day${overall.longestStreak === 1 ? '' : 's'}`],
    ['Most in a day', `${overall.mostInDay} session${overall.mostInDay === 1 ? '' : 's'}`],
    ['Fastest average reaction', sum.fastestRt != null ? `${sum.fastestRt} ms` : '—'],
    ['Flawless sessions', String(sum.perfectSessions)],
  ];
  for (const st of ['position', 'sound', 'color']) {
    if (sum.streamAcc[st] != null) rec.push([`${ST.STREAM_LABELS[st]} accuracy (last 20)`, pct(sum.streamAcc[st])]);
  }
  $('#records').innerHTML = rec.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');

  $('#ach-count').textContent = `${Object.keys(state.achievements).length} / ${ACHIEVEMENTS.length}`;
  $('#achievements').innerHTML = ACHIEVEMENTS.map((a) => {
    const when = state.achievements[a.id];
    return `<div class="ach ${when ? '' : 'locked'}"><span class="ico">${a.icon}</span>${a.title}<small>${when ? new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : a.desc}</small></div>`;
  }).join('');

  renderHistoryList(h);
}

function renderHistoryList(h = ST.filterMode(state.history, activeFilter())) {
  const list = $('#history-list');
  const recent = h.slice().reverse().slice(0, historyShown);
  if (!recent.length) {
    list.innerHTML = '<p class="hint">No sessions yet.</p>';
    $('#btn-history-more').hidden = true;
    return;
  }
  list.innerHTML = recent.map((e) => {
    const d = e.nextN - e.n;
    const arrow = d > 0 ? '<span class="up">▲</span>' : d < 0 ? '<span class="down">▼</span>' : '<span class="muted">●</span>';
    const streams = Object.keys(e.perStream).map(st => `${ST.STREAM_LABELS[st][0]} ${Math.round(e.perStream[st].accuracy * 100)}%`).join(' · ');
    return `<div class="hrow"><div class="hn">${e.n}</div>
      <div><div>${ST.MODE_LABELS[e.mode]} · ${streams}</div><div class="hdate">${new Date(e.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · ${Math.round(e.durationMs / 1000)} s${e.meanRt != null ? ` · ${e.meanRt} ms` : ''}</div></div>
      <div class="hacc">${Math.round(e.accuracy * 100)}% ${arrow}</div></div>`;
  }).join('');
  $('#btn-history-more').hidden = h.length <= historyShown;
}

async function exportFile(name, text, mime, label) {
  const outcome = await N.saveFile(name, text, mime);
  if (outcome === 'failed') toast(`Could not export the ${label}`, 3200);
  else if (outcome === 'downloaded') toast(`${label[0].toUpperCase()}${label.slice(1)} downloaded`);
}

/** onDataChanged() is called after an import or a wipe so the rest of the app can reload its state. */
export function initProgress({ onDataChanged }) {
  $('#stats-modes').addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-filter]');
    if (!chip) return;
    state.statsMode = chip.dataset.filter;
    historyShown = 15;
    renderProgress();
  });
  $('#btn-history-more').addEventListener('click', () => { historyShown += 25; renderHistoryList(); });

  $('#btn-export-json').addEventListener('click', () => exportFile(`nback-backup-${S.dayKey()}.json`, JSON.stringify(S.exportData(), null, 2), 'application/json', 'backup'));
  $('#btn-export-csv').addEventListener('click', () => exportFile(`nback-sessions-${S.dayKey()}.csv`, S.historyToCSV(state.history), 'text/csv', 'spreadsheet'));
  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('That file is too large to be a backup');
      const res = S.importData(JSON.parse(await file.text()));
      onDataChanged();
      toast(`Imported ${res.added} new session${res.added === 1 ? '' : 's'}${res.skipped ? `, skipped ${res.skipped} damaged` : ''}`, 3200);
    } catch (e) {
      toast(`Import failed: ${e instanceof SyntaxError ? 'not a valid backup file' : e.message}`, 3500);
    }
  });
  $('#btn-clear').addEventListener('click', async () => {
    const ok = await confirmDialog('Delete all data?', 'Sessions, achievements and records on this device will be erased. Export a backup first if you want to keep them.', 'Delete');
    if (!ok) return;
    S.clearHistory();
    S.saveAchievements({});
    onDataChanged();
    toast('All data deleted');
  });
}
