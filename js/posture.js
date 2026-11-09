// Foldable awareness.
//
// Sources, in order of preference:
//  1. visualViewport.segments  (Viewport Segments API)
//  2. window.getWindowSegments (older Window Segments draft)
//  3. CSS media queries for horizontal/vertical-viewport-segments (change events)
//  4. ?posture=tabletop|book[&hinge=px] URL override for testing on non-foldables
//
// The result is published on <html> as data attributes and CSS custom properties:
//  data-posture = "single" | "tabletop" | "book"
//  data-layout  = "portrait" | "landscape"
//  data-width   = "compact" | "wide"          (cover screen vs inner screen)
//  --seg-a-h / --hinge-h  (tabletop: height of upper segment and of the fold)
//  --seg-a-w / --hinge-w  (book: width of left segment and of the fold)

const root = document.documentElement;

function readSegments() {
  const params = new URLSearchParams(location.search);
  const forced = params.get('posture');
  if (forced === 'tabletop' || forced === 'book') {
    const hinge = Number(params.get('hinge')) || 24;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (forced === 'tabletop') {
      const half = (h - hinge) / 2;
      return [
        { left: 0, top: 0, width: w, height: half },
        { left: 0, top: half + hinge, width: w, height: half },
      ];
    }
    const half = (w - hinge) / 2;
    return [
      { left: 0, top: 0, width: half, height: h },
      { left: half + hinge, top: 0, width: half, height: h },
    ];
  }
  const vv = window.visualViewport;
  if (vv && Array.isArray(vv.segments) && vv.segments.length > 1) return vv.segments;
  if (typeof window.getWindowSegments === 'function') {
    try {
      const s = window.getWindowSegments();
      if (s && s.length > 1) return s;
    } catch { /* ignore */ }
  }
  return segmentsFromCss();
}

// Some browsers expose the fold only through CSS (media queries + env()).
// A hidden probe element converts those env() values into numbers.
let probe = null;
function measure(css) {
  if (!probe) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;';
    document.body.appendChild(probe);
  }
  probe.style.width = css.width || '0px';
  probe.style.height = css.height || '0px';
  const r = probe.getBoundingClientRect();
  return { w: r.width, h: r.height };
}

function segmentsFromCss() {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (window.matchMedia('(vertical-viewport-segments: 2)').matches) {
      const a = measure({ height: 'env(viewport-segment-bottom 0 0, 0px)' });
      const b = measure({ height: 'env(viewport-segment-top 0 1, 0px)' });
      if (a.h > 0 && b.h >= a.h) {
        return [
          { left: 0, top: 0, width: w, height: a.h },
          { left: 0, top: b.h, width: w, height: h - b.h },
        ];
      }
    }
    if (window.matchMedia('(horizontal-viewport-segments: 2)').matches) {
      const a = measure({ width: 'env(viewport-segment-right 0 0, 0px)' });
      const b = measure({ width: 'env(viewport-segment-left 1 0, 0px)' });
      if (a.w > 0 && b.w >= a.w) {
        return [
          { left: 0, top: 0, width: a.w, height: h },
          { left: b.w, top: 0, width: w - b.w, height: h },
        ];
      }
    }
  } catch { /* unsupported */ }
  return null;
}

export function currentPosture() {
  const segs = readSegments();
  const info = {
    posture: 'single',
    layout: window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
    width: window.innerWidth >= 600 ? 'wide' : 'compact',
    segments: segs,
    hinge: null,
  };
  if (segs) {
    const [a, b] = segs;
    const aRight = a.left + a.width;
    const aBottom = a.top + a.height;
    if (Math.abs(a.left - b.left) < 2 && b.top >= aBottom) {
      info.posture = 'tabletop';
      info.hinge = { top: aBottom, height: Math.max(0, b.top - aBottom) };
      info.segA = { height: a.height };
    } else if (b.left >= aRight) {
      info.posture = 'book';
      info.hinge = { left: aRight, width: Math.max(0, b.left - aRight) };
      info.segA = { width: a.width };
    }
  }
  return info;
}

function apply(info) {
  root.dataset.posture = info.posture;
  root.dataset.layout = info.layout;
  root.dataset.width = info.width;
  const s = root.style;
  if (info.posture === 'tabletop') {
    s.setProperty('--seg-a-h', `${info.segA.height}px`);
    s.setProperty('--hinge-h', `${info.hinge.height}px`);
    s.removeProperty('--seg-a-w');
    s.removeProperty('--hinge-w');
  } else if (info.posture === 'book') {
    s.setProperty('--seg-a-w', `${info.segA.width}px`);
    s.setProperty('--hinge-w', `${info.hinge.width}px`);
    s.removeProperty('--seg-a-h');
    s.removeProperty('--hinge-h');
  } else {
    s.removeProperty('--seg-a-h');
    s.removeProperty('--hinge-h');
    s.removeProperty('--seg-a-w');
    s.removeProperty('--hinge-w');
  }
}

/**
 * Start watching the device. `onChange(info, previous)` fires whenever the posture
 * or layout changes, which the game uses to pause rather than lose a trial mid-fold.
 */
export function watchPosture(onChange, options = {}) {
  let previous = null;
  const update = () => {
    const info = currentPosture();
    if (options.enabled && !options.enabled()) {
      info.posture = 'single';
      info.hinge = null;
    }
    apply(info);
    const changed = !previous
      || previous.posture !== info.posture
      || previous.layout !== info.layout
      || previous.width !== info.width;
    if (changed && onChange) onChange(info, previous);
    previous = info;
  };
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', update);
    window.visualViewport.addEventListener('segmentschange', update);
  }
  for (const q of ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)', '(device-posture: folded)']) {
    try {
      const mq = window.matchMedia(q);
      if (mq.addEventListener) mq.addEventListener('change', update);
      else if (mq.addListener) mq.addListener(update);
    } catch { /* unsupported query */ }
  }
  if (navigator.devicePosture && navigator.devicePosture.addEventListener) {
    navigator.devicePosture.addEventListener('change', update);
  }
  update();
  return () => currentPosture();
}
