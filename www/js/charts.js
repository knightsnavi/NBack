// Small dependency-free SVG charts with hover tooltips.
// Colours are read from CSS custom properties so light/dark and palettes just work.

const NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}, text) {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function tokens(container) {
  const cs = getComputedStyle(container);
  const get = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  return {
    text: get('--text', '#222'),
    muted: get('--muted', '#777'),
    grid: get('--border', 'rgba(0,0,0,.1)'),
    accent: get('--accent', '#7c5cff'),
    surface: get('--surface', '#fff'),
    series: {
      position: get('--series-position', '#2a78d6'),
      sound: get('--series-sound', '#eb6834'),
      color: get('--series-color', '#1baf7a'),
    },
  };
}

function ensureTip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.appendChild(tip);
  }
  return tip;
}

function placeTip(container, tip, x, y, html) {
  tip.innerHTML = html;
  tip.hidden = false;
  const w = container.clientWidth;
  const tw = tip.offsetWidth;
  let left = x + 12;
  if (left + tw > w - 4) left = Math.max(4, x - tw - 12);
  tip.style.left = `${left}px`;
  tip.style.top = `${Math.max(0, y - 8)}px`;
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * Line chart. series: [{ key, name, points: [{x, y, ts, label}] }]
 * x values are integer slots 0..count-1 (sessions), shared across series.
 */
export function lineChart(container, { series, count, yMin, yMax, yTicks = 4, yFormat = v => String(v), height = 180, step = false, emptyText = 'No sessions yet' }) {
  container.innerHTML = '';
  container.classList.add('chart');
  const t = tokens(container);
  const width = Math.max(240, container.clientWidth || 320);
  const pad = { l: 36, r: 16, t: 14, b: 24 };
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const hasData = series.some(s => s.points.length);
  if (!hasData) {
    svg.appendChild(svgEl('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle', fill: t.muted, 'font-size': 13 }, emptyText));
    container.appendChild(svg);
    return;
  }
  const n = Math.max(2, count || 2);
  const allY = series.flatMap(s => s.points.map(p => p.y));
  const lo = yMin ?? Math.min(...allY);
  const hi = yMax ?? Math.max(...allY);
  const span = hi - lo || 1;
  const x = i => pad.l + (i / (n - 1)) * (width - pad.l - pad.r);
  const y = v => pad.t + (1 - (v - lo) / span) * (height - pad.t - pad.b);

  // grid + y labels
  for (let k = 0; k <= yTicks; k++) {
    const v = lo + (span * k) / yTicks;
    svg.appendChild(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: y(v), y2: y(v), stroke: t.grid, 'stroke-width': 1 }));
    svg.appendChild(svgEl('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end', fill: t.muted, 'font-size': 11 }, yFormat(Math.round(v * 10) / 10)));
  }
  // x labels: first / last date
  const firstTs = series.flatMap(s => s.points).reduce((m, p) => (m == null || p.ts < m ? p.ts : m), null);
  const lastTs = series.flatMap(s => s.points).reduce((m, p) => (m == null || p.ts > m ? p.ts : m), null);
  if (firstTs != null) {
    svg.appendChild(svgEl('text', { x: pad.l, y: height - 6, fill: t.muted, 'font-size': 11 }, formatDate(firstTs)));
    svg.appendChild(svgEl('text', { x: width - pad.r, y: height - 6, 'text-anchor': 'end', fill: t.muted, 'font-size': 11 }, formatDate(lastTs)));
  }

  const endLabels = [];
  series.forEach(s => {
    const color = t.series[s.key] || t.accent;
    if (!s.points.length) return;
    let d = '';
    s.points.forEach((p, i) => {
      const px = x(p.x);
      const py = y(p.y);
      if (i === 0) d += `M${px} ${py}`;
      else if (step) d += ` H${px} V${py}`;
      else d += ` L${px} ${py}`;
    });
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    s.points.forEach(p => {
      svg.appendChild(svgEl('circle', { cx: x(p.x), cy: y(p.y), r: 3.5, fill: color, stroke: t.surface, 'stroke-width': 2 }));
    });
    // direct label at the end of the line (placed after all lines so they can be de-collided)
    const last = s.points[s.points.length - 1];
    endLabels.push({ name: s.name, x: x(last.x), y: y(last.y) - 8 });
  });
  // keep end labels at least 12px apart vertically
  endLabels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    if (endLabels[i].y - endLabels[i - 1].y < 14) endLabels[i].y = endLabels[i - 1].y + 14;
  }
  for (const l of endLabels) {
    svg.appendChild(svgEl('text', { x: Math.min(l.x + 6, width - 2), y: l.y, fill: t.text, 'font-size': 11, 'font-weight': 700, 'text-anchor': l.x > width - 60 ? 'end' : 'start', stroke: t.surface, 'stroke-width': 3, 'paint-order': 'stroke', 'stroke-linejoin': 'round' }, l.name));
  }

  // hover crosshair
  const cross = svgEl('line', { y1: pad.t, y2: height - pad.b, stroke: t.muted, 'stroke-width': 1, 'stroke-dasharray': '3 3', opacity: 0 });
  svg.appendChild(cross);
  container.appendChild(svg);
  const tip = ensureTip(container);
  const onMove = (ev) => {
    const rect = svg.getBoundingClientRect();
    const px = ((ev.clientX - rect.left) / rect.width) * width;
    const slot = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (n - 1));
    const i = Math.max(0, Math.min(n - 1, slot));
    const rows = [];
    let ts = null;
    for (const s of series) {
      const p = s.points.find(q => q.x === i);
      if (p) {
        rows.push(`<span class="dot" style="background:${t.series[s.key] || t.accent}"></span>${s.name}: <b>${p.label || yFormat(p.y)}</b>`);
        ts = p.ts;
      }
    }
    if (!rows.length) { tip.hidden = true; cross.setAttribute('opacity', 0); return; }
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('opacity', 1);
    const head = ts ? `<div class="tip-head">${new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>` : '';
    placeTip(container, tip, (x(i) / width) * rect.width, pad.t, head + rows.join('<br>'));
  };
  svg.addEventListener('pointermove', onMove);
  svg.addEventListener('pointerleave', () => { tip.hidden = true; cross.setAttribute('opacity', 0); });
}

/** Bar chart for sessions per day. bars: [{ key, ts, count }], goal highlights the target line. */
export function barChart(container, { bars, goal = 0, height = 150 }) {
  container.innerHTML = '';
  container.classList.add('chart');
  const t = tokens(container);
  const width = Math.max(240, container.clientWidth || 320);
  const pad = { l: 24, r: 8, t: 10, b: 22 };
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const max = Math.max(goal, 1, ...bars.map(b => b.count));
  const innerW = width - pad.l - pad.r;
  const slot = innerW / bars.length;
  const bw = Math.max(6, slot - 6);
  const y = v => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const base = height - pad.b;

  svg.appendChild(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: base, y2: base, stroke: t.grid }));
  svg.appendChild(svgEl('text', { x: pad.l - 6, y: pad.t + 4, 'text-anchor': 'end', fill: t.muted, 'font-size': 11 }, String(max)));
  svg.appendChild(svgEl('text', { x: pad.l - 6, y: base + 4, 'text-anchor': 'end', fill: t.muted, 'font-size': 11 }, '0'));
  if (goal > 0) {
    svg.appendChild(svgEl('line', { x1: pad.l, x2: width - pad.r, y1: y(goal), y2: y(goal), stroke: t.muted, 'stroke-dasharray': '4 4' }));
    svg.appendChild(svgEl('text', { x: width - pad.r, y: y(goal) - 4, 'text-anchor': 'end', fill: t.muted, 'font-size': 10 }, 'goal'));
  }
  const tip = ensureTip(container);
  bars.forEach((b, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const top = y(b.count);
    const h = Math.max(0, base - top);
    const r = Math.min(4, bw / 2, h);
    const isToday = i === bars.length - 1;
    const fill = b.count >= goal && goal > 0 ? t.accent : t.series.position;
    if (h > 0) {
      const d = `M${cx - bw / 2} ${base} V${top + r} Q${cx - bw / 2} ${top} ${cx - bw / 2 + r} ${top} H${cx + bw / 2 - r} Q${cx + bw / 2} ${top} ${cx + bw / 2} ${top + r} V${base} Z`;
      svg.appendChild(svgEl('path', { d, fill, opacity: isToday ? 1 : 0.85 }));
    } else {
      svg.appendChild(svgEl('rect', { x: cx - bw / 2, y: base - 2, width: bw, height: 2, fill: t.grid, rx: 1 }));
    }
    const label = new Date(b.ts).toLocaleDateString(undefined, { weekday: 'narrow' });
    svg.appendChild(svgEl('text', { x: cx, y: height - 6, 'text-anchor': 'middle', fill: isToday ? t.text : t.muted, 'font-size': 11, 'font-weight': isToday ? 700 : 400 }, label));
    const hit = svgEl('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: height - pad.t - pad.b, fill: 'transparent' });
    hit.addEventListener('pointerenter', () => {
      const rect = svg.getBoundingClientRect();
      placeTip(container, tip, (cx / width) * rect.width, top - 4, `<div class="tip-head">${formatDate(b.ts)}</div>${b.count} session${b.count === 1 ? '' : 's'}`);
    });
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
    svg.appendChild(hit);
  });
  container.appendChild(svg);
}

/** Calendar heatmap of the last `weeks` weeks. byDay: Map(dayKey -> count). */
export function heatmap(container, { byDay, weeks = 12, dayKeyFn, addDaysFn, now = Date.now() }) {
  container.innerHTML = '';
  container.classList.add('chart');
  const t = tokens(container);
  const width = Math.max(240, container.clientWidth || 320);
  const cell = Math.floor((width - 28) / weeks) - 3;
  const size = Math.max(8, Math.min(18, cell));
  const gap = 3;
  const height = 7 * (size + gap) + 18;
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, role: 'img' });
  const today = new Date(now);
  const dow = (today.getDay() + 6) % 7; // Monday = 0
  const step = addDaysFn || ((ts, n) => ts + n * 86400000);
  const start = step(now, -((weeks - 1) * 7 + dow));
  const max = Math.max(1, ...byDay.values());
  const tip = ensureTip(container);
  const left = 24;
  ['M', 'W', 'F'].forEach((d, i) => {
    svg.appendChild(svgEl('text', { x: 4, y: 14 + (i * 2) * (size + gap) + size / 2 + 4, fill: t.muted, 'font-size': 10 }, d));
  });
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const ts = step(start, w * 7 + d);
      if (ts > now + 43200000) continue;
      const key = dayKeyFn(ts);
      const count = byDay.get(key) || 0;
      const alpha = count === 0 ? 0 : 0.3 + 0.7 * Math.min(1, count / max);
      const x = left + w * (size + gap);
      const y = 14 + d * (size + gap);
      const rect = svgEl('rect', {
        x, y, width: size, height: size, rx: 3,
        fill: count === 0 ? t.grid : `color-mix(in oklab, ${t.accent} ${Math.round(alpha * 100)}%, ${t.surface})`,
      });
      rect.addEventListener('pointerenter', () => {
        const r = svg.getBoundingClientRect();
        placeTip(container, tip, ((x + size / 2) / width) * r.width, y, `<div class="tip-head">${formatDate(ts)}</div>${count} session${count === 1 ? '' : 's'}`);
      });
      rect.addEventListener('pointerleave', () => { tip.hidden = true; });
      svg.appendChild(rect);
      const month = new Date(ts).getMonth();
      if (d === 0 && month !== lastMonth) {
        svg.appendChild(svgEl('text', { x, y: 9, fill: t.muted, 'font-size': 10 }, new Date(ts).toLocaleDateString(undefined, { month: 'short' })));
        lastMonth = month;
      }
    }
  }
  container.appendChild(svg);
}

/** Progress ring as an SVG string. value/max, with a big label in the middle. */
export function ring({ value, max, size = 96, stroke = 10, color = 'var(--accent)', track = 'var(--border)', label, sublabel }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return `<svg class="ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${label ?? ''} ${sublabel ?? ''}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 ${size / 2} ${size / 2})" style="transition: stroke-dashoffset .6s ease"/>
    ${label != null ? `<text x="50%" y="50%" dy="${sublabel ? '-0.05em' : '0.35em'}" text-anchor="middle" font-size="${size * 0.26}" font-weight="800" fill="var(--text)">${label}</text>` : ''}
    ${sublabel ? `<text x="50%" y="50%" dy="1.5em" text-anchor="middle" font-size="${size * 0.11}" fill="var(--muted)">${sublabel}</text>` : ''}
  </svg>`;
}
