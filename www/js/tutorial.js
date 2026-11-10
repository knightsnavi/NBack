// Guided, interactive walkthrough. It drives the real board and buttons through
// a small adapter (`ui`), so the player learns on the actual controls.
//
// Part 1 teaches the two buttons at 1-back (compare with the previous item).
// Part 2 teaches 2-back, the level most people get stuck on: compare with the
// item from two turns ago, skipping the last one. A strip of recent turns sits
// above the grid with the turn to compare against highlighted. It ends with an
// unhinted 2-back practice round.
//
// ui = {
//   light(pos, letter)          light a cell and speak the letter
//   clear()                     unlight all cells
//   hint(streams)               pulse the buttons the player should press ([] clears)
//   strip(turns, marks)         recent turns [{ n, pos, letter }], marks = { now, back, skip } turn numbers
//   coach({ step, steps, title, text, button, onButton, voice, voiceDelay })
//   next(label, onButton)       show the coach button without touching the text or narration
//   feedback(stream, kind)      'good' | 'bad' | 'missed' on a button
//   sfx(kind)                   play a UI sound
//   badge(n)                    set the centre N badge
//   afterVoice(cb, fallbackMs)  run cb when the current narration ends
//   done(reason)                'completed' | 'skipped'
// }

const STEPS = 12;

// 2-back practice: [cell, letter]. Position targets at items 3, 5, 7, 8; sound targets at 4, 5, 8, 9.
export const PRACTICE = [
  [1, 'C'], [6, 'K'], [1, 'S'], [3, 'K'], [1, 'S'],
  [7, 'T'], [1, 'Q'], [7, 'T'], [2, 'Q'], [8, 'L'],
];

/** Which streams match `back` turns ago for item i of a [cell, letter] list. */
export function targetsAt(items, i, back) {
  const out = [];
  if (i < back) return out;
  if (items[i][0] === items[i - back][0]) out.push('position');
  if (items[i][1] === items[i - back][1]) out.push('sound');
  return out;
}

export function createTutorial(ui) {
  const t = { active: true, step: 0, timers: [] };
  const later = (fn, ms) => { const id = setTimeout(fn, ms); t.timers.push(id); return id; };
  const clearTimers = () => { for (const id of t.timers) clearTimeout(id); t.timers = []; };

  let turns = [];      // turns shown so far in the current part: { n, pos, letter }
  let onPress = null;  // press handler for the current step

  function coach(title, text, button, onButton, voice = null, voiceDelay = 0) {
    ui.coach({ step: t.step, steps: STEPS, title, text, button, onButton, voice, voiceDelay });
  }

  /** Present a new turn: light it, speak it, and show it on the strip. `back` = how many turns back to highlight. */
  function present(pos, letter, back = 0, hold = 900) {
    const n = turns.length + 1;
    turns.push({ n, pos, letter });
    ui.light(pos, letter);
    later(() => ui.clear(), hold);
    ui.strip(turns.slice(-4), {
      now: n,
      back: back && n - back >= 1 ? n - back : null,
      skip: back === 2 && n - 1 >= 1 ? n - 1 : null,
    });
  }

  function resetTurns() {
    turns = [];
    ui.strip([], {});
  }

  /** A step where exactly `expected` must be pressed. */
  function expectPress(expected, wrong, right) {
    const left = new Set(expected);
    ui.hint([...left]);
    onPress = (stream) => {
      if (left.has(stream)) {
        left.delete(stream);
        ui.feedback(stream, 'good');
        ui.sfx('good');
        ui.hint([...left]);
        if (left.size === 0) { onPress = null; right(); }
      } else {
        ui.feedback(stream, 'bad');
        ui.sfx('bad');
        wrong(stream);
      }
    };
  }

  const steps = [
    // ---------- Part 1: the two buttons, at 1-back ----------
    // 0
    () => {
      ui.clear();
      ui.badge(1);
      resetTurns();
      coach('Welcome to N-back',
        'Every few seconds one square lights up and a letter is spoken. Your job is to notice when something repeats from N steps ago. We start with 1-back: compare each item with the one just before it.',
        'Show me', () => go(1), 'welcome');
    },
    // 1
    () => {
      present(0, 'C');
      coach('Watch and listen',
        'The top-left square lit up and you heard “C”. Keep both in mind. Tap Next to see the following item.',
        'Next', () => go(2), 'watch', 1300);
    },
    // 2
    () => {
      present(0, 'H', 1);
      coach('Same square!',
        'The same square lit up as one step ago, so this is a position match. Press the Position button now.',
        null, null, 'pos_match', 1200);
      expectPress(['position'],
        () => coach('Not that one', 'The letter changed, so Sound is not a match here. The square repeated: press Position.', null, null, 'pos_wrong'),
        () => coach('Nice', 'The letter changed from C to H, so there was no sound match: pressing Sound here would have been a wrong press. Doing nothing on a stream is often the right answer.', 'Next', () => go(3), 'pos_ok'));
    },
    // 3
    () => {
      present(5, 'H', 1);
      coach('Same letter!',
        'A different square this time, but you heard “H” again, the same as one step ago. Press Sound.',
        null, null, 'snd_match', 1200);
      expectPress(['sound'],
        () => coach('Not that one', 'The square moved, so Position is not a match. The letter repeated: press Sound.', null, null, 'snd_wrong'),
        () => coach('Good ear', 'Position and sound are judged separately. You can be right on one and wrong on the other in the same moment.', 'Next', () => go(4), 'snd_ok'));
    },
    // 4
    () => {
      present(5, 'H', 1);
      coach('Both repeat',
        'Same square and the same letter as one step ago. Press both Position and Sound, in either order.',
        null, null, 'both', 1200);
      expectPress(['position', 'sound'],
        () => {},
        () => coach('Both caught', 'Double matches are rarer than single ones. Most of the time only one stream repeats, or neither.', 'Next', () => go(5), 'both_ok'));
    },
    // 5
    () => {
      present(2, 'K', 1);
      ui.hint([]);
      coach('Nothing repeats',
        'New square, new letter. The right move is to press nothing and wait. Pressing when there is no match counts as an error, just like missing one. Tap Next when you are ready.',
        'Next', () => go(6), 'none', 1200);
      onPress = (stream) => {
        ui.feedback(stream, 'bad');
        ui.sfx('bad');
        coach('That was new', 'Neither the square nor the letter repeated, so no press was needed. Holding back is part of the skill.', 'Next', () => go(6), 'none_wrong');
      };
    },

    // ---------- Part 2: 2-back ----------
    // 6
    () => {
      ui.clear();
      ui.badge(2);
      resetTurns();
      coach('Now 2-back',
        'That was 1-back. Now 2-back: compare each item with the one from two turns ago, not the last one. The strip above the grid shows the recent turns to help you.',
        'Show me', () => go(7), 'two_intro');
    },
    // 7
    () => {
      present(0, 'C', 2);
      coach('Two to remember',
        'Turn 1 and turn 2. There is nothing to compare them with yet, so just remember both. Tap Next.',
        null, null, 'two_mem', 3200);
      // Next only appears once both items have been shown
      later(() => { present(8, 'H', 2); ui.next('Next', () => go(8)); }, 2000);
    },
    // 8
    () => {
      present(0, 'K', 2);
      coach('Look two back',
        'Turn 3. Look two turns back, skipping turn 2. It is the same square as turn 1, so press Position.',
        null, null, 'two_pos', 1200);
      expectPress(['position'],
        () => coach('Not quite', 'Not quite. Compare with the highlighted turn, two back, and try again.', null, null, 'two_wrong'),
        () => coach('Right', 'Right. The letter changed from “C” to “K”, so Sound stays quiet.', 'Next', () => go(9), 'two_pos_ok'));
    },
    // 9
    () => {
      present(5, 'H', 2);
      coach('Skip the last one',
        'Turn 4. Two back is turn 2. Different square, but the same letter, “H”. Press Sound.',
        null, null, 'two_snd', 1200);
      expectPress(['sound'],
        () => coach('Not quite', 'Not quite. Compare with the highlighted turn, two back, and try again.', null, null, 'two_wrong'),
        () => coach('Good', 'Good. Notice that you skipped right over turn 3.', 'Next', () => go(10), 'two_snd_ok'));
    },
    // 10
    () => {
      present(6, 'R', 2);
      ui.hint([]);
      coach('Nothing matches',
        'Turn 5. Two back is turn 3. Different square, different letter, so the right move is to wait. Tap Next when you are ready.',
        'Next', () => go(11), 'two_none', 1200);
      onPress = (stream) => {
        ui.feedback(stream, 'bad');
        ui.sfx('bad');
        coach('That was new', 'Neither the square nor the letter repeated, so no press was needed. Holding back is part of the skill.', 'Next', () => go(11), 'none_wrong');
      };
    },
    // 11
    () => runPractice(),
  ];

  function go(step) {
    if (!t.active) return;
    clearTimers();
    onPress = null;
    ui.hint([]);
    t.step = step;
    if (step >= steps.length) { complete(); return; }
    steps[step]();
  }

  /** Ten items of 2-back with no button hints. The strip stays visible. */
  function runPractice() {
    const BACK = 2;
    const INTERVAL = 3400;
    let i = -1;
    let hits = 0;
    let errors = 0;
    let pressed = new Set();
    let targets = [];
    const totalTargets = PRACTICE.reduce((sum, _, k) => sum + targetsAt(PRACTICE, k, BACK).length, 0);

    ui.clear();
    ui.badge(2);
    resetTurns();
    coach('Practice: 2-back',
      'Practice time: 2-back, ten items. The buttons will not light up this time, but the strip stays on to help you compare.',
      null, null, 'practice2_intro');

    const closeTrial = () => {
      for (const stream of targets) {
        if (!pressed.has(stream)) { errors++; ui.feedback(stream, 'missed'); ui.sfx('missed'); }
      }
    };

    const nextTrial = () => {
      if (i >= 0) closeTrial();
      i++;
      if (i >= PRACTICE.length) { finishPractice(); return; }
      pressed = new Set();
      targets = targetsAt(PRACTICE, i, BACK);
      present(PRACTICE[i][0], PRACTICE[i][1], BACK, 800);
      coach('Practice: 2-back', i < BACK
        ? `Item ${i + 1} of ${PRACTICE.length}. Remember it.`
        : `Item ${i + 1} of ${PRACTICE.length}. Compare with the highlighted turn.`, null);
      later(nextTrial, INTERVAL);
    };

    onPress = (stream) => {
      if (i < BACK || i >= PRACTICE.length || pressed.has(stream)) return;
      pressed.add(stream);
      const ok = targets.includes(stream);
      ui.feedback(stream, ok ? 'good' : 'bad');
      ui.sfx(ok ? 'good' : 'bad');
      if (ok) hits++; else errors++;
    };

    const finishPractice = () => {
      ui.clear();
      onPress = null;
      ui.sfx(errors <= 2 ? 'levelup' : 'complete');
      coach('Practice done',
        `You caught ${hits} of ${totalTargets} matches with ${errors} mistake${errors === 1 ? '' : 's'}. That is 2-back. In a real session the strip is gone, so you hold the last two items in your head. You start at 1-back, and the game moves you up when you make fewer than three mistakes on each button.`,
        'Finish', () => complete(), 'practice2_done');
    };

    ui.afterVoice(() => {
      if (!t.active || t.step !== 11) return;
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
    get step() { return t.step; },
    start() { go(0); },
    press(stream) {
      if (t.active && onPress) onPress(stream);
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
