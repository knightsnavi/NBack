// Pure N-back engine. No DOM, no timers: easy to test in Node.
//
// Rules follow Jaeggi et al. (2008), generalised to one, two or three streams:
//  - position: 8 grid cells (3x3 minus the centre)
//  - sound:    8 spoken consonants
//  - color:    8 colours painted on the lit cell (triple N-back)
//  - a standard block has 20 + N trials, about 30% of scorable trials are targets
//    in each stream, and a few targets coincide across streams
//  - adaptive difficulty: fewer than 3 errors raises N, more than 5 lowers it

export const LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T'];
export const POSITIONS = [0, 1, 2, 3, 5, 6, 7, 8]; // 3x3 cell indices, centre (4) unused
export const COLORS = [
  { name: 'Red', hex: '#d55e00' },
  { name: 'Orange', hex: '#e69f00' },
  { name: 'Yellow', hex: '#f0e442' },
  { name: 'Green', hex: '#009e73' },
  { name: 'Sky', hex: '#56b4e9' },
  { name: 'Blue', hex: '#0072b2' },
  { name: 'Pink', hex: '#cc79a7' },
  { name: 'Brown', hex: '#8b5a2b' },
];

export const STREAM_VALUES = {
  position: POSITIONS,
  sound: LETTERS,
  color: COLORS.map((_, i) => i),
};

export const MODES = {
  position: ['position'],
  sound: ['sound'],
  dual: ['position', 'sound'],
  triple: ['position', 'sound', 'color'],
};

export const LENGTHS = { short: 15, standard: 20, long: 30 };

export function streamsForMode(mode) {
  return MODES[mode] || MODES.dual;
}

export function trialsForN(n, length = 'standard') {
  return (LENGTHS[length] || LENGTHS.standard) + n;
}

function pickOther(list, exclude, rng) {
  let value;
  do {
    value = list[Math.floor(rng() * list.length)];
  } while (value === exclude);
  return value;
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/** Target counts for a block: ~30% of scorable trials per stream, a third of those shared. */
export function targetPlan(scorable, streamCount) {
  const perStream = Math.max(2, Math.round(0.3 * scorable));
  const shared = streamCount > 1 ? Math.max(1, Math.round(perStream / 3)) : 0;
  return { perStream, shared };
}

/**
 * Build a block of trials.
 * Returns { n, mode, streams, trials: [{ values: {position, sound, color}, match: {position, sound, color} }] }
 */
export function generateSequence(n, options = {}) {
  const rng = options.rng || Math.random;
  const mode = options.mode || 'dual';
  const streams = streamsForMode(mode);
  const trials = options.trials || trialsForN(n, options.length);

  if (n < 1) throw new Error('n must be at least 1');
  const scorable = trials - n;
  if (scorable < 1) throw new Error('not enough trials for this n');

  const { perStream, shared } = targetPlan(scorable, streams.length);
  const candidates = shuffle(Array.from({ length: scorable }, (_, i) => i + n), rng);
  const targets = Object.fromEntries(streams.map(s => [s, new Set()]));

  let cursor = 0;
  for (let i = 0; i < shared && cursor < candidates.length; i++, cursor++) {
    for (const s of streams) targets[s].add(candidates[cursor]);
  }
  for (const s of streams) {
    for (let i = shared; i < perStream && cursor < candidates.length; i++, cursor++) {
      targets[s].add(candidates[cursor]);
    }
  }

  const seq = [];
  for (let i = 0; i < trials; i++) {
    const values = {};
    const match = {};
    for (const s of ['position', 'sound', 'color']) {
      const pool = STREAM_VALUES[s];
      if (i < n || !streams.includes(s)) {
        values[s] = pool[Math.floor(rng() * pool.length)];
        match[s] = false;
      } else {
        const back = seq[i - n].values[s];
        const isTarget = targets[s].has(i);
        values[s] = isTarget ? back : pickOther(pool, back, rng);
        match[s] = isTarget;
      }
    }
    seq.push({ values, match });
  }
  return { n, mode, streams, trials: seq };
}

function scoreStream(trials, responses, stream, n) {
  const out = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, targets: 0, rts: [] };
  for (let i = n; i < trials.length; i++) {
    const target = trials[i].match[stream];
    const r = responses[i];
    const pressed = Boolean(r && r[stream] != null);
    if (target) out.targets++;
    if (target && pressed) {
      out.hits++;
      if (typeof r[stream] === 'number') out.rts.push(r[stream]);
    } else if (target && !pressed) out.misses++;
    else if (!target && pressed) out.falseAlarms++;
    else out.correctRejections++;
  }
  const denom = out.hits + out.misses + out.falseAlarms;
  out.accuracy = denom === 0 ? 1 : out.hits / denom;
  out.errors = out.misses + out.falseAlarms;
  out.meanRt = out.rts.length ? Math.round(out.rts.reduce((a, b) => a + b, 0) / out.rts.length) : null;
  delete out.rts;
  return out;
}

/**
 * Score a finished block.
 * responses[i] = { position: rtMs, sound: rtMs, color: rtMs } with a key present only when pressed.
 */
export function scoreBlock(sequence, responses) {
  const { n, trials, mode, streams } = sequence;
  const perStream = {};
  for (const s of streams) perStream[s] = scoreStream(trials, responses, s, n);
  const list = Object.values(perStream);
  const errors = list.reduce((sum, m) => sum + m.errors, 0);
  const accuracy = list.reduce((sum, m) => sum + m.accuracy, 0) / list.length;
  const rts = list.map(m => m.meanRt).filter(v => v != null);
  const meanRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : null;
  return { n, mode, streams, trials: trials.length, perStream, errors, accuracy, meanRt };
}

/**
 * Jaeggi adaptive rule: < 3 errors → N+1, > 5 errors → N-1, otherwise unchanged.
 * Thresholds scale with block length so long blocks are not punished.
 */
export function nextN(n, errors, opts = {}) {
  const scale = opts.scorable ? opts.scorable / 20 : 1;
  const up = opts.up ?? Math.round(3 * scale);
  const down = opts.down ?? Math.round(5 * scale);
  const { min = 1, max = 9 } = opts;
  if (errors < up) return Math.min(n + 1, max);
  if (errors > down) return Math.max(n - 1, min);
  return n;
}

/** Deterministic PRNG for tests and reproducible sequences (mulberry32). */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
