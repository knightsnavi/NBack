// Daily reminder plumbing.
//
// A web app has no guaranteed way to wake itself at a fixed time, so this uses
// every channel that exists and is honest about which ones are best-effort:
//  1. in-page timer while the app is open or in a background tab
//  2. Periodic Background Sync via the service worker (installed PWA on Chrome/Android)
//  3. a downloadable calendar event with an alarm, which works everywhere
import { dayKey } from './storage.js';

const CONFIG_URL = new URL('reminder-config.json', document.baseURI).href;
const CONFIG_CACHE = 'nback-config';
let timer = null;

export function support() {
  return {
    notifications: 'Notification' in window,
    serviceWorker: 'serviceWorker' in navigator,
    periodicSync: 'serviceWorker' in navigator && 'PeriodicSyncManager' in window,
  };
}

export function permission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

export async function requestPermission() {
  if (!('Notification' in window)) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

function parseTime(str) {
  const [h, m] = (str || '19:00').split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 19, m: Number.isFinite(m) ? m : 0 };
}

export function nextFireTime(timeStr, now = Date.now()) {
  const { h, m } = parseTime(timeStr);
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export async function showNotification(title, body) {
  const options = {
    body,
    icon: 'assets/icon-192.png',
    badge: 'assets/badge.png',
    tag: 'nback-daily',
    renotify: false,
    data: { url: './' },
  };
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return true;
      }
    }
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); n.close(); };
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** Store the reminder config where the service worker can read it too. */
export async function syncConfig({ enabled, time, lastSessionDay, lastNotifiedDay }) {
  const cfg = { enabled: Boolean(enabled), time: time || '19:00', lastSessionDay: lastSessionDay || null, lastNotifiedDay: lastNotifiedDay || null };
  try {
    if ('caches' in window) {
      const cache = await caches.open(CONFIG_CACHE);
      await cache.put(CONFIG_URL, new Response(JSON.stringify(cfg), { headers: { 'Content-Type': 'application/json' } }));
    }
  } catch { /* ignore */ }
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.periodicSync) {
        if (cfg.enabled) {
          const status = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
          if (!status || status.state === 'granted') {
            await reg.periodicSync.register('nback-reminder', { minInterval: 6 * 60 * 60 * 1000 }).catch(() => {});
          }
        } else {
          await reg.periodicSync.unregister('nback-reminder').catch(() => {});
        }
      }
    }
  } catch { /* ignore */ }
  return cfg;
}

/**
 * Schedule the in-page reminder. Fires only if the app is still open then and
 * no session has been played today.
 */
export function schedule(settings, history, onFired) {
  if (timer) { clearTimeout(timer); timer = null; }
  const { enabled, time } = settings.reminders;
  if (!enabled || permission() !== 'granted') return null;
  const at = nextFireTime(time);
  const delay = Math.min(at - Date.now(), 2147000000);
  timer = setTimeout(async () => {
    timer = null;
    const today = dayKey();
    const playedToday = history().some(h => dayKey(h.ts) === today);
    if (!playedToday) {
      await showNotification('Time to train', 'A quick N-back session keeps your streak alive.');
      if (onFired) onFired(today);
    }
    schedule(settings, history, onFired);
  }, delay);
  return at;
}

/** A daily calendar event with an alarm, for the reliable path. */
export function buildIcs(timeStr) {
  const { h, m } = parseTime(timeStr);
  const pad = n => String(n).padStart(2, '0');
  const start = new Date();
  start.setHours(h, m, 0, 0);
  if (start.getTime() < Date.now()) start.setDate(start.getDate() + 1);
  const local = `${start.getFullYear()}${pad(start.getMonth() + 1)}${pad(start.getDate())}T${pad(h)}${pad(m)}00`;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NBack Trainer//EN',
    'BEGIN:VEVENT',
    `UID:nback-daily-${start.getTime()}@nback.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local}`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:NBack training',
    'DESCRIPTION:Five minutes of dual N-back. Open the NBack app.',
    'BEGIN:VALARM',
    'TRIGGER:PT0S',
    'ACTION:DISPLAY',
    'DESCRIPTION:NBack training',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
