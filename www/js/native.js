// Bridge to the native Android shell (Capacitor). Every function here is a
// no-op in a plain browser, so the same code runs as a website and as an app.

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
const Haptics = plugin('Haptics');
const LocalNotifications = plugin('LocalNotifications');
const App = plugin('App');
const StatusBar = plugin('StatusBar');

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

export async function haptic(kind) {
  if (!Haptics) return false;
  try {
    if (kind === 'tap') await Haptics.impact({ style: 'Light' });
    else if (kind === 'good') await Haptics.notification({ type: 'Success' });
    else if (kind === 'bad') await Haptics.notification({ type: 'Error' });
    else if (kind === 'missed') await Haptics.impact({ style: 'Medium' });
    else if (kind === 'levelup') { await Haptics.notification({ type: 'Success' }); setTimeout(() => Haptics.impact({ style: 'Heavy' }).catch(() => {}), 180); }
    else await Haptics.impact({ style: 'Light' });
    return true;
  } catch {
    return false;
  }
}

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

const REMINDER_ID = 4242;

/**
 * Schedule the daily reminder natively. Repeats every day from the first useful
 * occurrence (tomorrow if the player already trained today).
 */
export async function scheduleReminder(time, trainedToday) {
  if (!LocalNotifications) return false;
  try {
    await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] });
    const [h, m] = String(time || '19:00').split(':').map(Number);
    const first = new Date();
    first.setHours(h, m, 0, 0);
    if (first.getTime() <= Date.now() || trainedToday) first.setDate(first.getDate() + 1);
    await LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_ID,
        title: 'Time to train',
        body: 'A quick N-back session keeps your streak alive.',
        schedule: { at: first, every: 'day', allowWhileIdle: true },
        smallIcon: 'ic_stat_nback',
      }],
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelReminder() {
  if (!LocalNotifications) return;
  try { await LocalNotifications.cancel({ notifications: [{ id: REMINDER_ID }] }); } catch { /* ignore */ }
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

/** Hardware / gesture back button. handler() returns true when it consumed the event. */
export function onBackButton(handler) {
  if (!App) return;
  App.addListener('backButton', () => {
    if (!handler()) App.exitApp();
  });
}

export async function setStatusBar(dark) {
  if (!StatusBar) return;
  try {
    await StatusBar.setStyle({ style: dark ? 'Dark' : 'Light' });
    await StatusBar.setBackgroundColor({ color: dark ? '#1b1630' : '#fff4e6' });
  } catch { /* ignore */ }
}
