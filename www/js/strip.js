// The strip of recent turns shown above the grid: in the tutorial, and in
// assisted practice. It always renders a fixed number of slots, so it never
// changes size as turns arrive.
import { $ } from './dom.js';
import { COLORS } from './game.js';

/** Assisted practice shows N + 1 turns, and four cards is what fits on the cover screen. */
export const ASSIST_MAX_N = 3;

function miniGrid(pos, color) {
  const paint = color != null && COLORS[color] ? ` style="background:${COLORS[color].hex}"` : '';
  let html = '';
  for (let i = 0; i < 9; i++) html += i === pos ? `<i class="on"${paint}></i>` : '<i></i>';
  return html;
}

/**
 * turns: up to `slots` entries, oldest first; a null entry leaves its slot empty.
 *        Each is { n, pos?, letter?, color? } where n is the 1-based turn number.
 * marks: { now, back, skip } turn numbers to highlight; skip may be a list.
 */
export function renderStrip(turns, marks = {}, slots = 4) {
  const strip = $('#strip');
  const skip = [].concat(marks.skip ?? []);
  strip.style.setProperty('--slots', String(slots));
  let html = '';
  for (let k = 0; k < slots; k++) {
    const turn = turns[k];
    if (!turn) { html += '<div class="turn empty" aria-hidden="true"></div>'; continue; }
    const cls = turn.n === marks.now ? 'now' : turn.n === marks.back ? 'back' : skip.includes(turn.n) ? 'skip' : '';
    const tag = turn.n === marks.back ? '<span class="tag">compare</span>' : turn.n === marks.now ? '<span class="tag">now</span>' : '';
    const mini = turn.pos != null ? `<span class="mini">${miniGrid(turn.pos, turn.color)}</span>` : '<span class="mini none"></span>';
    html += `<div class="turn ${cls}"><span class="num">Turn ${turn.n}</span>${mini}<span class="letter">${turn.letter ?? ''}</span>${tag}</div>`;
  }
  strip.innerHTML = html;
  const shown = turns.filter(Boolean);
  const back = shown.find(x => x.n === marks.back);
  const now = shown.find(x => x.n === marks.now);
  strip.setAttribute('aria-label', now && back ? `Turn ${now.n} is compared with turn ${back.n}` : 'Recent turns');
}

/**
 * The strip for item `index` of an N-back sequence: the current item on the
 * right, the one to compare with on the left, the ones in between dimmed.
 */
export function renderAssistStrip(sequence, index) {
  const n = sequence.n;
  const has = stream => sequence.streams.includes(stream);
  const turns = [];
  const skip = [];
  for (let k = 0; k <= n; k++) {
    const i = index - n + k;
    const trial = i >= 0 && i <= index ? sequence.trials[i] : null;
    if (!trial) { turns.push(null); continue; }
    turns.push({
      n: i + 1,
      pos: has('position') ? trial.values.position : null,
      letter: has('sound') ? trial.values.sound : null,
      color: has('color') ? trial.values.color : null,
    });
    if (k > 0 && k < n) skip.push(i + 1);
  }
  renderStrip(turns, { now: index + 1, back: index - n >= 0 ? index - n + 1 : undefined, skip }, n + 1);
}
