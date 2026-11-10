// Screen switching. Views register a renderer; nothing here knows what a view contains.
import { $, $$, app } from './dom.js';
import { state } from './state.js';

const renderers = new Map();
const TITLES = { stats: 'Progress', settings: 'Settings', results: 'Results' };

export function onShow(screen, render) {
  renderers.set(screen, render);
}

export function show(screen) {
  state.screen = screen;
  app.dataset.screen = screen;
  for (const v of $$('.view')) v.hidden = !v.classList.contains(`view-${screen}`);
  const playing = screen === 'play';
  $('#hud').hidden = !playing || state.tutorialActive;
  $('#actions').hidden = !playing;
  if (!playing) {
    $('#coach').hidden = true;
    $('#strip').hidden = true;
    app.dataset.tutorial = 'off';
  }
  if (screen !== 'results') $('#confetti').hidden = true;
  $('#btn-back').hidden = !(screen === 'stats' || screen === 'settings');
  $('#topbar-actions').hidden = playing;
  $('#brand-text').textContent = TITLES[screen] || 'NBack';
  const useAlt = screen === 'stats' || screen === 'results';
  $('#board').hidden = useAlt;
  $('#stage-alt').hidden = !useAlt;
  const render = renderers.get(screen);
  if (render) render();
  if (!playing) $('#panel').scrollTop = 0;
}

/** Re-run the renderer of the screen that is showing (after data or layout changes). */
export function refresh() {
  const render = renderers.get(state.screen);
  if (render) render();
}
