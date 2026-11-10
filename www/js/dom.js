// Small DOM helpers shared by every view.

export const $ = (sel, scope = document) => scope.querySelector(sel);
export const $$ = (sel, scope = document) => [...scope.querySelectorAll(sel)];
export const root = document.documentElement;
export const app = $('#app');
export const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/** Escape text for use inside innerHTML templates. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

export function confirmDialog(title, text, okLabel = 'Confirm') {
  const dlg = $('#dlg-confirm');
  $('#confirm-title').textContent = title;
  $('#confirm-text').textContent = text;
  $('#confirm-ok').textContent = okLabel;
  return new Promise((resolve) => {
    const onClose = () => { dlg.removeEventListener('close', onClose); resolve(dlg.returnValue === 'ok'); };
    dlg.addEventListener('close', onClose);
    dlg.returnValue = '';
    dlg.showModal();
  });
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Coalesce rapid calls (slider drags) into one. */
export function debounce(fn, ms) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
