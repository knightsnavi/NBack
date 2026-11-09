// Builds the 2-back explainer video:
//   1. reads narration clip lengths from scripts/explainer/audio/*.mp3
//   2. lays out scenes so each one lasts at least its narration
//   3. renders frames deterministically with the bundled Chromium
//   4. mixes narration + letter sounds + press sfx, muxes with ffmpeg
// Output: www/video/2back.mp4 and www/video/2back.jpg
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..', '..');
const audioDir = path.join(here, 'audio');
const framesDir = path.join(here, 'frames');
const outDir = path.join(rootDir, 'www', 'video');
const FPS = 30;
const W = 720, H = 1280;

const SCENES = ['intro', 't1', 't2', 't3', 't4', 't5', 't6', 'trick', 'outro'];
const MIN = { intro: 6.5, t1: 5, t2: 5, t3: 7, t4: 7, t5: 6, t6: 6, trick: 9, outro: 5 };
const TAIL = 0.9; // silence after each narration before the next scene

function duration(file) {
  return Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
}

// timeline
const timeline = [];
let cursor = 0.4;
for (const key of SCENES) {
  const nar = path.join(audioDir, `${key}.mp3`);
  const narDur = existsSync(nar) ? duration(nar) : 0;
  const dur = Math.max(MIN[key], narDur + TAIL + 0.4);
  timeline.push({ key, start: cursor, dur, narration: existsSync(nar) ? nar : null, narAt: cursor + 0.4 });
  cursor += dur;
}
const total = cursor + 0.6;
console.log(`timeline: ${total.toFixed(1)} s`, timeline.map(s => `${s.key}=${s.dur.toFixed(1)}`).join(' '));

// sound events: letter when the square lights (0.25 s into each turn), press sfx at the press moment
const TURN_LETTERS = ['C', 'H', 'K', 'H', 'K', 'R'];
const MATCHES = [[], [], ['pos'], ['snd'], ['pos', 'snd'], []];
const events = [];
for (const s of timeline) {
  if (s.narration) events.push({ file: s.narration, at: s.narAt, gain: 1 });
  if (/^t[0-9]$/.test(s.key)) {
    const k = Number(s.key.slice(1)) - 1;
    events.push({ file: path.join(rootDir, 'www/audio', `${TURN_LETTERS[k]}.mp3`), at: s.start + 0.25, gain: 0.55 });
    const pressAt = s.start + Math.max(2.6, s.dur * 0.55);
    for (let i = 0; i < MATCHES[k].length; i++) events.push({ file: path.join(rootDir, 'www/audio/sfx/good.mp3'), at: pressAt + i * 0.12, gain: 0.6 });
  }
  if (s.key === 'intro') {
    // the three intro items also get their letters
    [0, 1.2, 2.4].forEach((off, i) => events.push({ file: path.join(rootDir, 'www/audio', `${TURN_LETTERS[i]}.mp3`), at: s.start + off + 0.05, gain: 0.4 }));
  }
  if (s.key === 'outro') events.push({ file: path.join(rootDir, 'www/audio/sfx/levelup.mp3'), at: s.start + 0.3, gain: 0.5 });
}

// PREVIEW=1 renders one frame per scene (plus the press moment) to scripts/explainer/preview/ and exits
if (process.env.PREVIEW) {
  const prevDir = path.join(here, 'preview');
  mkdirSync(prevDir, { recursive: true });
  const b = await chromium.launch();
  const pg = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await pg.goto('file://' + path.join(here, 'explainer.html'));
  await pg.evaluate(tl => { window.TIMELINE = tl; }, timeline.map(({ key, start, dur }) => ({ key, start, dur })));
  for (const s of timeline) {
    const shots = /^t[0-9]$/.test(s.key) ? [1.0, Math.max(2.6, s.dur * 0.55) + 0.6] : s.key === 'trick' ? [1.5, s.dur * 0.5, s.dur * 0.95] : [s.dur * 0.7];
    for (const off of shots) {
      await pg.evaluate(ms => window.render(ms), (s.start + off) * 1000);
      await pg.screenshot({ path: path.join(prevDir, `${s.key}-${off.toFixed(1)}.jpg`), type: 'jpeg', quality: 85 });
    }
  }
  await b.close();
  console.log('preview frames written');
  process.exit(0);
}

// render frames
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto('file://' + path.join(here, 'explainer.html'));
await page.evaluate(tl => { window.TIMELINE = tl; }, timeline.map(({ key, start, dur }) => ({ key, start, dur })));
const frames = Math.ceil(total * FPS);
const t0 = Date.now();
for (let f = 0; f < frames; f++) {
  await page.evaluate(ms => window.render(ms), (f / FPS) * 1000);
  await page.screenshot({ path: path.join(framesDir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 90 });
  if (f % 300 === 0) console.log(`  frame ${f}/${frames} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
// poster: the turn-3 moment with the arc and the press
await page.evaluate(ms => window.render(ms), (timeline[3].start + Math.max(2.6, timeline[3].dur * 0.55) + 0.5) * 1000);
await page.screenshot({ path: path.join(outDir, '2back.jpg'), type: 'jpeg', quality: 85 });
await browser.close();
console.log(`rendered ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// mix audio
const inputs = [];
const filters = [];
events.forEach((e, i) => {
  inputs.push('-i', e.file);
  const ms = Math.round(e.at * 1000);
  filters.push(`[${i}:a]aresample=44100,aformat=channel_layouts=mono,volume=${e.gain},adelay=${ms}|${ms}[a${i}]`);
});
const mix = `${events.map((_, i) => `[a${i}]`).join('')}amix=inputs=${events.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total.toFixed(2)},atrim=0:${total.toFixed(2)}[out]`;
const mixPath = path.join(here, 'mix.wav');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', [...filters, mix].join(';'), '-map', '[out]', mixPath]);

// mux
const outPath = path.join(outDir, '2back.mp4');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
  '-framerate', String(FPS), '-i', path.join(framesDir, '%05d.jpg'),
  '-i', mixPath,
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  '-c:a', 'aac', '-b:a', '96k', '-shortest', outPath]);
rmSync(framesDir, { recursive: true, force: true });
rmSync(mixPath, { force: true });
writeFileSync(path.join(here, 'timeline.json'), JSON.stringify({ total, timeline }, null, 2));
console.log('wrote', outPath, duration(outPath).toFixed(1), 's');
