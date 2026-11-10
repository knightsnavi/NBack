// The play field: the 3x3 grid, the response zones, and their feedback
// (colour, sound, vibration). Used by both real sessions and the tutorial.
import { $, $$ } from './dom.js';
import { state, audio } from './state.js';
import { COLORS } from './game.js';
import * as N from './native.js';

export const cells = $$('#board .cell');

export function clearCells() {
  for (const c of cells) {
    c.classList.remove('lit');
    c.style.removeProperty('--cell-color');
    const name = c.querySelector('.color-name');
    if (name) name.remove();
  }
}

/** Light one cell. `colorIndex` paints it for triple mode. */
export function lightCell(position, colorIndex = null) {
  clearCells();
  const cell = cells[position];
  if (!cell) return;
  if (colorIndex != null && COLORS[colorIndex]) {
    const color = COLORS[colorIndex];
    cell.style.setProperty('--cell-color', color.hex);
    if (state.settings.colorNames) {
      const span = document.createElement('span');
      span.className = 'color-name';
      span.textContent = color.name;
      cell.appendChild(span);
    }
  }
  cell.classList.add('lit');
}

export function speakLetter(letter) {
  if (!state.settings.sound) return;
  if (state.settings.voice === 'device') audio.speak(letter);
  else audio.play(letter);
}

export function setBadge(n) {
  $('#n-num').textContent = n;
}

const zone = stream => $(`.action[data-stream="${stream}"]`);

/** Show only the zones for these streams and clear any leftover feedback. */
export function setZones(streams) {
  for (const btn of $$('.action')) {
    btn.hidden = !streams.includes(btn.dataset.stream);
    btn.classList.remove('good', 'bad', 'missed', 'cue', 'pressed');
  }
}

export function clearZoneFeedback() {
  for (const btn of $$('.action')) btn.classList.remove('good', 'bad', 'missed', 'cue', 'pressed');
}

/** Brief colour feedback on a zone: 'good' | 'bad' | 'missed'. Geometry never changes. */
export function flash(stream, cls, ms = 380) {
  const btn = zone(stream);
  if (!btn) return;
  btn.classList.remove('good', 'bad', 'missed');
  void btn.offsetWidth; // restart the animation
  btn.classList.add(cls);
  setTimeout(() => btn.classList.remove(cls), ms);
}

export function pulsePress(stream) {
  const btn = zone(stream);
  if (!btn || btn.hidden) return;
  btn.classList.add('pressed');
  setTimeout(() => btn.classList.remove('pressed'), 120);
}

export function hintZones(streams) {
  for (const btn of $$('.action')) btn.classList.toggle('cue', streams.includes(btn.dataset.stream));
}

export function buzz(kind) {
  if (state.settings.haptics) N.haptic(kind);
}

export function sfx(kind) {
  if (state.settings.tones) audio.sfx(kind);
}
