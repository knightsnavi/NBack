// The one shared, mutable application state, plus the audio engine.
import * as S from './storage.js';
import { LETTERS } from './game.js';
import { LetterAudio } from './audio.js';
import { ASSIST_MAX_N } from './strip.js';

export const state = {
  settings: S.loadSettings(),
  history: S.loadHistory(),
  achievements: S.loadAchievements(),
  meta: S.loadMeta(),
  screen: 'home',
  posture: null,
  tutorialActive: false,
  statsMode: null, // which mode the Progress screen is filtered to; null = follow the current mode
};

export const audio = new LetterAudio(LETTERS, 'audio/');

export function saveSettings() {
  return S.saveSettings(state.settings);
}

/** The level for the mode that is currently selected. */
export function currentLevel() {
  return S.levelFor(state.settings);
}

/** Assist is switched on and the current level is low enough for the strip to fit. */
export function assistActive() {
  return state.settings.assist && currentLevel() <= ASSIST_MAX_N;
}
