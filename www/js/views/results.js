// Results: what happened in the session that just ended, and what it means for the level.
import { $, toast, reduceMotion, root } from '../dom.js';
import { state } from '../state.js';
import { levelUpGap } from '../game.js';
import * as ST from '../stats.js';
import { ASSIST_MAX_N } from '../strip.js';
import { ring } from '../charts.js';
import * as N from '../native.js';

let last = null;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line that says exactly what stood between this round and a level up. */
function closeness(score) {
  const gap = levelUpGap(score, { rule: state.settings.progression });
  if (gap.gap === 0) return '';
  if (gap.kind === 'accuracy') return `${Math.ceil(gap.gap * 100)} more points of accuracy moves you up`;
  return `${gap.streams.map(x => `${plural(x.over, 'fewer mistake')} on ${ST.STREAM_LABELS[x.stream]}`).join(' and ')} moves you up`;
}

function headlineFor(entry, score) {
  if (entry.assisted) return ['Good practice!', `Assisted round, so your level stays at ${entry.n}-back`];
  const delta = entry.nextN - entry.n;
  if (delta > 0) return ['Awesome!', `You move up to ${entry.nextN}-back`];
  if (!state.settings.adaptive) return [score.accuracy >= 0.85 ? 'Excellent!' : 'Nice work!', `${entry.n}-back · ${plural(score.errors, 'mistake')}`];
  if (delta < 0) return ['Keep going!', `Back to ${entry.nextN}-back to build a base`];
  const hint = closeness(score);
  if (score.accuracy >= 0.85) return ['So close!', hint || `Strong round at ${entry.n}-back`];
  if (score.accuracy >= 0.6) return ['Nice work!', hint || `Holding steady at ${entry.n}-back`];
  return ['Good effort!', hint || 'Every round builds the skill'];
}

export function renderResults(entry, score) {
  const delta = entry.nextN - entry.n;
  const [headline, sub] = headlineFor(entry, score);
  const pct = Math.round(score.accuracy * 100);
  const colorOf = st => `var(--series-${st})`;

  $('#stage-alt').innerHTML = `<div class="res-hero">
      ${ring({ value: score.accuracy, max: 1, size: 150, stroke: 13, color: delta > 0 ? 'var(--good)' : 'var(--accent)', label: `${pct}%`, sublabel: 'correct' })}
      <div>
        <div class="headline">${headline}</div>
        <div class="sub">${sub}</div>
      </div>
    </div>`;

  $('#res-tiles').innerHTML = `
    <div class="tile"><b>${entry.n}-back</b><span>${ST.MODE_LABELS[entry.mode]}</span></div>
    <div class="tile"><b>${Math.round(entry.durationMs / 1000)} s</b><span>play time</span></div>
    <div class="tile"><b>${score.meanRt != null ? `${score.meanRt} ms` : '—'}</b><span>reaction</span></div>`;

  const streams = score.streams;
  const row = (label, key, badWhenPositive) => `<tr><td>${label}</td>${streams.map((st) => {
    const v = score.perStream[st][key];
    return `<td class="v ${v === 0 ? 'zero' : badWhenPositive ? 'bad' : ''}">${v}</td>`;
  }).join('')}</tr>`;
  $('#res-streams').innerHTML = `<table class="stream-table">
    <thead><tr><th>Button</th>${streams.map(st => `<th class="s"><span class="pct" style="color:${colorOf(st)}">${Math.round(score.perStream[st].accuracy * 100)}%</span>${ST.STREAM_LABELS[st]}</th>`).join('')}</tr></thead>
    <tbody>
      ${row('Correct', 'hits', false)}
      ${row('Missed match', 'misses', true)}
      ${row('False tap', 'falseAlarms', true)}
      <tr class="total"><td>Mistakes</td>${streams.map(st => `<td class="v ${score.perStream[st].errors === 0 ? 'zero' : ''}">${score.perStream[st].errors}</td>`).join('')}</tr>
    </tbody></table>`;

  // Point at Assist after a rough unassisted round, and at the way out of it after a strong assisted one.
  const tip = $('#res-tip');
  const errorsOk = score.streams.every(st => score.perStream[st].errors < 3);
  if (entry.assisted) {
    tip.textContent = errorsOk
      ? 'That was a clean round. Turn Assist off on the home screen to play for real and move up.'
      : 'Assist shows the recent turns. Rounds played with it do not change your level.';
  } else if (!state.settings.assist && entry.n <= ASSIST_MAX_N && delta <= 0 && score.accuracy < 0.6) {
    tip.textContent = `Finding ${entry.n}-back hard? Turn on Assist on the home screen to see the recent turns while you play.`;
  } else {
    tip.textContent = '';
  }
  tip.hidden = !tip.textContent;

  $('#btn-again').textContent = entry.assisted ? 'Practice again' : delta !== 0 ? `Play again at ${entry.nextN}-back` : 'Play again';
  last = { entry, score };
  if (delta > 0 && !reduceMotion.matches) confetti();
}

async function shareResults() {
  if (!last) return;
  const { entry, score } = last;
  const lines = [
    `NBack Trainer: ${ST.MODE_LABELS[entry.mode]} ${entry.n}-back${entry.assisted ? ' (assisted practice)' : ''}, ${Math.round(score.accuracy * 100)}% correct.`,
    ...score.streams.map(st => `${ST.STREAM_LABELS[st]} ${Math.round(score.perStream[st].accuracy * 100)}% (${score.perStream[st].hits} correct, ${score.perStream[st].misses} missed, ${score.perStream[st].falseAlarms} false)`),
  ];
  if (entry.nextN > entry.n) lines.push(`Level up to ${entry.nextN}-back!`);
  const outcome = await N.shareText('NBack Trainer results', lines.join('\n'));
  if (outcome === 'copied') toast('Results copied to the clipboard');
  else if (outcome === 'failed') toast('Sharing is not available on this device');
}

/** Lightweight confetti burst on the stage canvas. */
function confetti() {
  const canvas = $('#confetti');
  const stage = $('#stage');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (!w || !h) return;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.hidden = false;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const cs = getComputedStyle(root);
  const colors = ['--accent', '--accent-2', '--accent-3', '--series-position', '--series-sound', '--series-color'].map(v => cs.getPropertyValue(v).trim());
  const parts = Array.from({ length: 90 }, () => ({
    x: Math.random() * w, y: -10 - Math.random() * h * 0.5,
    vx: (Math.random() - 0.5) * 1.6, vy: 1.5 + Math.random() * 2.5,
    r: 4 + Math.random() * 5, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.2,
    color: colors[Math.floor(Math.random() * colors.length)], circle: Math.random() < 0.3,
  }));
  const start = performance.now();
  const duration = 2600;
  const frame = (now) => {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    const fade = t > duration - 600 ? Math.max(0, (duration - t) / 600) : 1;
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.02;
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.circle) { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, Math.PI * 2); ctx.fill(); } else ctx.fillRect(-p.r / 2, -p.r / 3, p.r, p.r / 1.5);
      ctx.restore();
    }
    if (t < duration && state.screen === 'results') requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, w, h); canvas.hidden = true; }
  };
  requestAnimationFrame(frame);
}

export function initResults({ playAgain, goHome }) {
  $('#btn-again').addEventListener('click', playAgain);
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-share').addEventListener('click', shareResults);
}
