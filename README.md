# NBack Trainer

A dual / triple N-back working-memory trainer built as an offline-capable web app, designed for
foldable phones. It works on the cover screen, on the inner screen flat or in landscape, and
half-open in tabletop or book posture, where the grid and the controls sit on opposite screens
and nothing straddles the hinge.

| Cover screen | Tabletop (half-open) | Book (half-open) |
|---|---|---|
| ![cover](docs/cover-play.png) | ![tabletop](docs/tabletop-play.png) | ![book](docs/book-play.png) |

| Results | Guided tutorial | Progress |
|---|---|---|
| ![results](docs/cover-results.png) | ![tutorial](docs/cover-tutorial-0.png) | ![stats](docs/cover-stats.png) |

## The game

Follows the dual N-back task from Jaeggi et al. (2008):

- a 3×3 grid where one of the eight outer squares lights up, and one of eight consonants
  (C H K L Q R S T) is spoken at the same time
- a block has 20 + N trials, with 6 position targets and 6 sound targets, 2 of them coinciding
- press **Position** when the square matches the one N steps ago, **Sound** when the letter does
- adaptive level: fewer than 3 errors raises N, more than 5 lowers it (thresholds scale with block length)

Modes: position only, sound only, dual, and **triple** (adds a colour stream painted on the lit
square, with optional colour names for players who find colours hard to tell apart).

## Features

- **Fold-aware layout**: Viewport Segments API, Window Segments, CSS `viewport-segments`
  media queries with an `env()` probe, and the Device Posture change event. The game pauses
  automatically when the posture changes mid-session, and when the app goes to the background.
- **Thumb-first controls**: large stream-coloured buttons in the thumb zone, handedness switch,
  keyboard shortcuts (`A` position, `F` colour, `L` sound, `Space` pause, `Esc` end), haptics,
  tap tones, immediate right/wrong feedback, miss indicators, and a per-trial progress strip.
- **Guided tutorial**: on first launch the app offers a two-minute interactive walkthrough on
  the real board (position match, sound match, both, no match, what N means, then a hinted
  practice round). It can be rerun any time from Settings → Learn, and a written "How to play"
  reference is one tap away.
- **Recorded voice and sound design**: the eight letters and every UI sound (correct, wrong,
  miss, countdown tick, go, level up, session complete, achievement) were generated once with
  ElevenLabs and ship as small MP3 files, decoded through Web Audio for low-latency playback.
  Device speech and synthesized tones are the fallbacks if a file cannot load.
- **Record keeping**: every session is stored locally with per-stream hits, misses, false alarms,
  accuracy, mean reaction time, duration, and the resulting N.
- **Trends**: level over time, accuracy per stream, sessions per day against a daily goal,
  a 12-week activity heatmap, personal records, streaks, insights, and a full session log.
- **Daily reminders** (toggle + time): notifications while the app is open, Periodic Background
  Sync when installed on Chrome/Android, and a downloadable calendar event with an alarm as the
  reliable path on any device.
- **Achievements**, daily goal ring, session length (short / standard / long) and pace controls,
  four colour palettes, light/dark/auto theme, data **export** (JSON backup, CSV) and **import**.
- **Installable PWA** that works offline; all data stays on the device.

## Run it

Any static server works. For example:

```
python3 -m http.server 8080
# then open http://localhost:8080/
```

To test fold postures on a desktop browser, add `?posture=tabletop` or `?posture=book`
(optionally `&hinge=28` for the hinge width in CSS px) to the URL.

## Develop

```
npm test                 # engine unit tests (node:test)
node scripts/render-icons.mjs   # regenerate PNG icons from assets/icon.svg
node scripts/screenshots.mjs    # walk every screen on Z Fold viewports (needs the server on :8080)
TUTORIAL=cover,tabletop node scripts/screenshots.mjs   # drive the guided tutorial end to end
```

The engine in `js/game.js` is pure and fully covered by `tests/game.test.mjs`. Layout decisions
live in `css/styles.css`, keyed off `data-posture`, `data-layout`, `data-width` and `data-handed`
on `<html>`, which `js/posture.js` maintains.
