// Guided, interactive walkthrough. It drives the real board and buttons through
// a small adapter (`ui`) so the player learns on the actual controls.
//
// ui = {
//   light(pos, letter)   light a cell and speak the letter
//   clear()              unlight all cells
//   hint(streams)        pulse the buttons the player should press (array, [] clears)
//   coach({ step, steps, title, text, button, onButton })  show the coach card
//   feedback(stream, ok) flash a button right/wrong
//   sfx(kind)            play a UI sound
//   badge(n)             set the centre N badge
//   afterVoice(cb, fallbackMs)  run cb when the current narration ends (or after fallbackMs with voice off)
//   done(reason)         'completed' | 'skipped'
// }

const PRACTICE = [
  { pos: 1, letter: 'C' },
  { pos: 1, letter: 'H' }, // position match
  { pos: 3, letter: 'H' }, // sound match
  { pos: 3, letter: 'K' }, // position match
  { pos: 6, letter: 'K' }, // sound match
  { pos: 8, letter: 'K' }, // sound match
  { pos: 8, letter: 'R' }, // position match
  { pos: 2, letter: 'T' }, // nothing
];

export function createTutorial(ui) {
  const t = { active: true, step: 0, timers: [] };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); t.timers.push(id); return id; };
  const clearTimers = () => { for (const id of t.timers) clearTimeout(id); t.timers = []; };
  const total = 8;

  let expect = null;      // Set of streams still expected in this step
  let onPress = null;     // custom press handler for the current step
  let finish = () => {};

  function coach(title, text, button, onButton, voice = null, voiceDelay = 0) {
    ui.coach({ step: t.step, steps: total, title, text, button, onButton, voice, voiceDelay });
  }

  function flashStim(pos, letter, hold = 700) {
    ui.light(pos, letter);
    later(() => ui.clear(), hold);
  }

  const steps = [
    // 0 — welcome
    () => {
      ui.clear();
      ui.badge(1);
      ui.hint([]);
      coach('Welcome to N-back',
        'Every few seconds one square lights up and a letter is spoken. Your job is to notice when something repeats from N steps ago. We start with 1-back: compare each item with the one just before it.',
        'Show me', () => go(1), 'welcome');
    },
    // 1 — first stimulus
    () => {
      later(() => flashStim(0, 'C'), 300);
      coach('Watch and listen',
        'The top-left square lit up and you heard “C”. Keep both in mind. Tap Next to see the following item.',
        'Next', () => go(2), 'watch', 1300);
    },
    // 2 — position match
    () => {
      later(() => flashStim(0, 'H'), 300);
      expect = new Set(['position']);
      ui.hint(['position']);
      coach('Same square!',
        'The same square lit up as one step ago, so this is a position match. Press the Position button now.',
        null, null, 'pos_match', 1200);
      onPress = (stream) => {
        if (stream === 'position') {
          ui.feedback('position', true); ui.sfx('good');
          expect = null; ui.hint([]);
          coach('Nice', 'The letter changed from C to H, so there was no sound match: pressing Sound here would have been a wrong press. Doing nothing on a stream is often the right answer.', 'Next', () => go(3), 'pos_ok');
        } else {
          ui.feedback(stream, false); ui.sfx('bad');
          coach('Not that one', 'The letter changed, so Sound is not a match here. The square repeated: press Position.', null, null, 'pos_wrong');
        }
      };
    },
    // 3 — sound match
    () => {
      later(() => flashStim(5, 'H'), 300);
      expect = new Set(['sound']);
      ui.hint(['sound']);
      coach('Same letter!',
        'A different square this time, but you heard “H” again, the same as one step ago. Press Sound.',
        null, null, 'snd_match', 1200);
      onPress = (stream) => {
        if (stream === 'sound') {
          ui.feedback('sound', true); ui.sfx('good');
          expect = null; ui.hint([]);
          coach('Good ear', 'Position and sound are judged separately. You can be right on one and wrong on the other in the same moment.', 'Next', () => go(4), 'snd_ok');
        } else {
          ui.feedback(stream, false); ui.sfx('bad');
          coach('Not that one', 'The square moved, so Position is not a match. The letter repeated: press Sound.', null, null, 'snd_wrong');
        }
      };
    },
    // 4 — both
    () => {
      later(() => flashStim(5, 'H'), 300);
      expect = new Set(['position', 'sound']);
      ui.hint(['position', 'sound']);
      coach('Both repeat',
        'Same square and the same letter as one step ago. Press both Position and Sound, in either order.',
        null, null, 'both', 1200);
      onPress = (stream) => {
        if (expect.has(stream)) {
          expect.delete(stream);
          ui.feedback(stream, true); ui.sfx('good');
          ui.hint([...expect]);
          if (expect.size === 0) {
            coach('Both caught', 'Double matches are rarer than single ones. Most of the time only one stream repeats, or neither.', 'Next', () => go(5), 'both_ok');
          }
        } else {
          ui.feedback(stream, false);
        }
      };
    },
    // 5 — no match
    () => {
      later(() => flashStim(2, 'K'), 300);
      expect = new Set();
      ui.hint([]);
      coach('Nothing repeats',
        'New square, new letter. The right move is to press nothing and wait. Pressing when there is no match counts as an error, just like missing one. Tap Next when you are ready.',
        'Next', () => go(6), 'none', 1200);
      onPress = (stream) => {
        ui.feedback(stream, false); ui.sfx('bad');
        coach('That was new', 'Neither the square nor the letter repeated, so no press was needed. Holding back is part of the skill.', 'Next', () => go(6), 'none_wrong');
      };
    },
    // 6 — N explained
    () => {
      ui.clear();
      ui.badge(2);
      coach('What “N” means',
        'You just played 1-back. At 2-back you compare each item with the one TWO steps earlier, so you hold two items in mind at once. The big number in the middle always shows the current N. Fewer than 3 errors in a session raises N next time; more than 5 lowers it.',
        'Try a practice round', () => go(7), 'n_explained');
    },
    // 7 — practice
    () => {
      ui.badge(1);
      runPractice();
    },
  ];

  function go(step) {
    if (!t.active) return;
    clearTimers();
    onPress = null;
    expect = null;
    ui.hint([]);
    t.step = step;
    if (step >= steps.length) { complete(); return; }
    steps[step]();
  }

  function runPractice() {
    const n = 1;
    const interval = 3200;
    const stim = 700;
    let i = -1;
    let hits = 0;
    let errors = 0;
    let pressed = new Set();
    let targets = new Set();
    coach('Practice: 1-back, 8 items', 'Hints are on: the button that matches lights up. Press it before the next item arrives.', null, null, 'practice_intro');
    const nextTrial = () => {
      // score the previous trial
      if (i >= n) {
        for (const s of targets) if (!pressed.has(s)) { errors++; ui.sfx('missed'); ui.feedback(s, false); }
      }
      i++;
      if (i >= PRACTICE.length) { finishPractice(); return; }
      const cur = PRACTICE[i];
      pressed = new Set();
      targets = new Set();
      if (i >= n) {
        const back = PRACTICE[i - n];
        if (back.pos === cur.pos) targets.add('position');
        if (back.letter === cur.letter) targets.add('sound');
      }
      flashStim(cur.pos, cur.letter, stim);
      ui.hint([...targets]);
      if (i < n) coach('Practice', 'Remember this first item.', null);
      else if (targets.size === 0) coach('Practice', `Item ${i + 1} of ${PRACTICE.length}: nothing repeats. Wait.`, null);
      else coach('Practice', `Item ${i + 1} of ${PRACTICE.length}: ${[...targets].map(s => s === 'position' ? 'the square' : 'the letter').join(' and ')} repeated. Press ${[...targets].map(s => s === 'position' ? 'Position' : 'Sound').join(' and ')}.`, null);
      later(nextTrial, interval);
    };
    onPress = (stream) => {
      if (i < n || pressed.has(stream)) return;
      pressed.add(stream);
      const ok = targets.has(stream);
      ui.feedback(stream, ok);
      ui.sfx(ok ? 'good' : 'bad');
      if (ok) { hits++; ui.hint([...targets].filter(s => !pressed.has(s))); } else errors++;
    };
    const finishPractice = () => {
      ui.clear();
      ui.hint([]);
      onPress = null;
      const totalTargets = 6;
      ui.sfx(errors <= 2 ? 'levelup' : 'complete');
      coach('Practice done',
        `You caught ${hits} of ${totalTargets} matches with ${errors} error${errors === 1 ? '' : 's'}. In a real session there are no hints and the pace is a little faster, but the rules are exactly what you just did. The center number shows your level, and the game adjusts it for you.`,
        'Finish', () => complete(), 'practice_done');
    };
    ui.afterVoice(() => {
      if (!t.active || t.step !== 7) return;
      ui.sfx('go');
      later(nextTrial, 600);
    }, 1500);
  }

  function complete() {
    if (!t.active) return;
    t.active = false;
    clearTimers();
    ui.clear();
    ui.hint([]);
    ui.done('completed');
  }

  return {
    get active() { return t.active; },
    start() { go(0); },
    press(stream) {
      if (!t.active) return;
      if (onPress) onPress(stream);
    },
    skip() {
      if (!t.active) return;
      t.active = false;
      clearTimers();
      ui.clear();
      ui.hint([]);
      ui.done('skipped');
    },
  };
}
