// Bridge to the native Android shell (Capacitor) with browser fallbacks, so
// the same code runs as an installed app and as a plain web page.

const cap = typeof window !== 'undefined' ? window.Capacitor : null;
export const isNative = Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());

function plugin(name) {
  if (!isNative) return null;
  try {
    return cap.Plugins && cap.Plugins[name] ? cap.Plugins[name] : cap.registerPlugin(name);
  } catch {
    return null;
  }
}

const Fold = plugin('Fold');
const Screen = plugin('Screen');
const Haptics = plugin('Haptics');
const LocalNotifications = plugin('LocalNotifications');
const App = plugin('App');
const StatusBar = plugin('StatusBar');
const SystemBars = plugin('SystemBars');
const Filesystem = plugin('Filesystem');
const Share = plugin('Share');

/* ---------- fold ---------- */
/**
 * Fold geometry from Jetpack WindowManager.
 * cb(segments | null): two {left, top, width, height} rects in CSS px when the
 * device is half-open with a separating hinge, otherwise null.
 */
export function watchFold(cb) {
  if (!Fold) return;
  const apply = (info) => {
    if (!info || !info.folding || info.state !== 'half' || !info.separating) { cb(null); return; }
    const b = info.bounds; // CSS px, relative to the web view
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (info.orientation === 'horizontal') {
      cb([
        { left: 0, top: 0, width: w, height: Math.max(0, b.top) },
        { left: 0, top: b.bottom, width: w, height: Math.max(0, h - b.bottom) },
      ]);
    } else {
      cb([
        { left: 0, top: 0, width: Math.max(0, b.left), height: h },
        { left: b.right, top: 0, width: Math.max(0, w - b.right), height: h },
      ]);
    }
  };
  Fold.addListener('foldchange', apply);
  Fold.getState().then(apply).catch(() => {});
}

/* ---------- keep the screen on while playing ---------- */
let wakeLock = null;
export async function keepAwake(on) {
  if (Screen) {
    try { await Screen.keepAwake({ on: Boolean(on) }); } catch { /* ignore */ }
    return;
  }
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* not allowed right now; harmless */ }
}

/* ---------- haptics ---------- */
const WEB_PATTERNS = { tap: 12, good: 12, bad: [30, 40, 30], missed: 40, levelup: [20, 30, 20, 30, 60], done: 20 };

export function haptic(kind) {
  if (Haptics) {
    const run = async () => {
      if (kind === 'good' || kind === 'done') await Haptics.notification({ type: 'SUCCESS' });
      else if (kind === 'bad') await Haptics.notification({ type: 'ERROR' });
      else if (kind === 'missed') await Haptics.impact({ style: 'MEDIUM' });
      else if (kind === 'levelup') { await Haptics.notification({ type: 'SUCCESS' }); setTimeout(() => Haptics.impact({ style: 'HEAVY' }).catch(() => {}), 180); }
      else await Haptics.impact({ style: 'LIGHT' });
    };
    run().catch(() => {});
    return;
  }
  if (navigator.vibrate) {
    try { navigator.vibrate(WEB_PATTERNS[kind] ?? 12); } catch { /* ignore */ }
  }
}

/* ---------- files and sharing ---------- */
/**
 * Hand a text file to the user. In the app this writes it to the cache and opens
 * the Android share sheet (Save to Files, Drive, email…); in a browser it downloads.
 * Returns 'shared' | 'downloaded' | 'failed'.
 */
export async function saveFile(filename, text, mime = 'application/json') {
  if (Filesystem && Share) {
    try {
      const res = await Filesystem.writeFile({ path: filename, data: text, directory: 'CACHE', encoding: 'utf8' });
      await Share.share({ title: filename, files: [res.uri], dialogTitle: `Save ${filename}` });
      return 'shared';
    } catch (e) {
      // closing the share sheet without choosing is not a failure
      return /cancel/i.test(String(e && e.message)) ? 'shared' : 'failed';
    }
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** Returns 'shared' | 'copied' | 'failed'. */
export async function shareText(title, text) {
  if (Share) {
    try {
      await Share.share({ title, text, dialogTitle: title });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String(e && e.message))) return 'shared';
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'shared';
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/* ---------- reminders ---------- */
/** Android 13+ asks for notification permission at runtime. */
export async function notificationPermission(request = false) {
  if (!LocalNotifications) return 'unsupported';
  try {
    let status = await LocalNotifications.checkPermissions();
    if (status.display !== 'granted' && request) status = await LocalNotifications.requestPermissions();
    return status.display === 'granted' ? 'granted' : status.display === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'denied';
  }
}

const LEGACY_REMINDER_ID = 4242;
const REMINDER_BASE_ID = 4300;
export const REMINDER_DAYS = 14;

/** The dates the daily reminder should fire on: one per day, skipping today if it is past or already trained. */
export function reminderDates(time, trainedToday, now = new Date(), days = REMINDER_DAYS) {
  const [h, m] = String(time || '19:00').split(':').map(Number);
  const out = [];
  for (let i = 0; out.length < days; i++) {
    const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i, h, m, 0, 0);
    if (i === 0 && (trainedToday || at.getTime() <= now.getTime() + 60000)) continue;
    out.push(at);
  }
  return out;
}

async function cancelAllReminders() {
  const ids = [{ id: LEGACY_REMINDER_ID }];
  for (let i = 0; i < REMINDER_DAYS; i++) ids.push({ id: REMINDER_BASE_ID + i });
  await LocalNotifications.cancel({ notifications: ids });
}

/**
 * Schedule one notification per day for the next two weeks. Each is a separate
 * dated notification, so they keep arriving even if the app is not opened.
 * Re-armed on every app start and after every session.
 */
export async function scheduleReminders(time, trainedToday) {
  if (!LocalNotifications) return false;
  try {
    await cancelAllReminders();
    const notifications = reminderDates(time, trainedToday).map((at, i) => ({
      id: REMINDER_BASE_ID + i,
      title: 'Time to train',
      body: 'A quick N-back session keeps your streak alive.',
      schedule: { at, allowWhileIdle: true },
      smallIcon: 'ic_stat_nback',
    }));
    await LocalNotifications.schedule({ notifications });
    return true;
  } catch {
    return false;
  }
}

export async function cancelReminders() {
  if (!LocalNotifications) return;
  try { await cancelAllReminders(); } catch { /* ignore */ }
}

export async function testNotification() {
  if (!LocalNotifications) return false;
  try {
    await LocalNotifications.schedule({ notifications: [{ id: 4243, title: 'NBack reminder test', body: 'This is what your daily reminder looks like.', schedule: { at: new Date(Date.now() + 1500) }, smallIcon: 'ic_stat_nback' }] });
    return true;
  } catch {
    return false;
  }
}

/* ---------- system ---------- */
/** Hardware / gesture back. handler() returns true when it consumed the event. */
export function onBackButton(handler) {
  if (!App) return;
  App.addListener('backButton', () => {
    if (!handler()) App.exitApp();
  });
}

/** Called when the app returns to the foreground. */
export function onResume(handler) {
  if (!App) return;
  App.addListener('resume', handler);
}

/**
 * Match the system bar icons to the app theme. The app draws edge to edge, so
 * the bars are transparent and show the page background behind them.
 */
export async function setStatusBar(dark) {
  const style = { style: dark ? 'DARK' : 'LIGHT' };
  if (SystemBars) {
    try { await SystemBars.setStyle(style); return; } catch { /* fall through to the status bar plugin */ }
  }
  if (!StatusBar) return;
  try { await StatusBar.setStyle(style); } catch { /* ignore */ }
}
