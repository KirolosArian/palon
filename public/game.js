/* PALON - Balloon climbing game
   Logical world width = 400. World Y goes negative as you climb (10 px = 1 meter). */
(() => {
'use strict';

const W = 400, WALL = 14, OUT = '#2b3440';
const $ = id => document.getElementById(id);
const canvas = $('game'), ctx = canvas.getContext('2d');
const app = $('app');
let H = 700, scale = 1, dpr = 1;

function resize() {
  const r = app.getBoundingClientRect();
  scale = r.width / W;
  H = r.height / scale;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
}
window.addEventListener('resize', resize);
resize();

/* ---------------- utils ---------------- */
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function rngOf(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1, l = dx * dx + dy * dy;
  let t = l ? ((px - x1) * dx + (py - y1) * dy) / l : 0;
  t = clamp(t, 0, 1);
  const qx = x1 + t * dx - px, qy = y1 + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}
function circRect(cx, cy, r, x, y, w, h) {
  const qx = clamp(cx, x, x + w), qy = clamp(cy, y, y + h);
  const dx = cx - qx, dy = cy - qy;
  return dx * dx + dy * dy < r * r;
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/* ---------------- save ---------------- */
const SAVE_KEY = 'palon_save_v1';
let save = { unlocked: 1, stars: [], bank: 0, muted: false };
try { const s = JSON.parse(localStorage.getItem(SAVE_KEY)); if (s) save = Object.assign(save, s); } catch (e) {}
while (save.stars.length < 20) save.stars.push(0);
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }

/* ---------------- audio ---------------- */
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0) {
  if (!actx || save.muted) return;
  const t0 = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.3) {
  if (!actx || save.muted) return;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const s = actx.createBufferSource(); s.buffer = buf;
  const g = actx.createGain(); g.gain.value = vol;
  s.connect(g).connect(actx.destination); s.start();
}
let coinPitch = 0, coinPitchT = 0;
const SFX = {
  coin() { const f = 880 * Math.pow(1.06, coinPitch); tone(f, 0.07, 'square', 0.05); tone(f * 1.5, 0.12, 'square', 0.05, 0, 0.05); },
  pop() { noise(0.4, 0.6); tone(220, 0.35, 'sawtooth', 0.12, -170); },
  power() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, 'triangle', 0.1, 0, i * 0.07)); },
  shieldBreak() { tone(700, 0.3, 'triangle', 0.14, -500); noise(0.15, 0.2); },
  win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'triangle', 0.12, 0, i * 0.1)); },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.28, 'triangle', 0.12, 0, i * 0.16)); },
  laser() { tone(1400, 0.12, 'sawtooth', 0.025, -900); },
  shoot() { tone(260, 0.1, 'square', 0.05, -160); },
  click() { tone(660, 0.05, 'triangle', 0.08); },
  locked() { tone(160, 0.25, 'square', 0.08); }
};
function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {} }

/* ---------------- content ---------------- */
const TRAPS = [
  { id: 'saw',      icon: '⚙️', name: 'المناشير',             desc: 'المسار ثابت وتقدر تعدّي منه، بس المنشار بيجري عليه يمين وشمال. عدّي قبل ما يرجعلك!' },
  { id: 'twin',     icon: '⚙️⚙️', name: 'منشارين على مسار واحد', desc: 'مسار بعرض الشاشة وعليه منشارين ماشيين مع بعض. لاقي الفتحة وعدّي.' },
  { id: 'spinner',  icon: '🌀', name: 'المراوح الدوّارة',     desc: 'عصاية بتلف وفي طرفيها مناشير. وجديد: الدرع 🛡️ بيحميك من خبطة واحدة!' },
  { id: 'bird',     icon: '🐦', name: 'الطيور المجنونة',      desc: 'طيور بتطير بعرض الشاشة. وجديد: المغناطيس 🧲 بيشد الكوينز ليك!' },
  { id: 'wind',     icon: '💨', name: 'تيارات الهوا',         desc: 'الهوا بيزقك ناحية المناشير! قاوم بأزرار الاتجاهات.' },
  { id: 'laser',    icon: '🔴', name: 'الليزر',               desc: 'الليزر بيولع ويطفي. لما يبدأ يرعش يبقى خلاص هيولع!' },
  { id: 'icicle',   icon: '🧊', name: 'الأشواك الواقعة',      desc: 'أشواك تلج بتقع عليك أول ما تقرب. لما تترعش.. اهرب!' },
  { id: 'pendulum', icon: '⛓️', name: 'البندول الشايك',       desc: 'كورة شوك بتتمرجح يمين وشمال. احسب التوقيت صح.' },
  { id: 'crusher',  icon: '🧱', name: 'الحيطان الكابسة',      desc: 'حيطتين بيقفلوا ويفتحوا. متنفخش البلونة وانت جواهم!' },
  { id: 'cannon',   icon: '💣', name: 'المدافع',              desc: 'مدافع على الحيطان بتضرب سهام.' },
  { id: 'ghost',    icon: '👻', name: 'المنشار الشبح',         desc: 'منشار بيختفي ويظهر.' },
  { id: 'bouncer',  icon: '🏐', name: 'الكور النطّاطة',        desc: 'كور شوك بتخبط في الحيطان وترتد.' },
  { id: 'orbit',    icon: '🪐', name: 'المناشير اللي بتلف',    desc: '3 مناشير بيلفوا حوالين نقطة.' },
  { id: 'vsaw',     icon: '↕️', name: 'المنشار الطالع النازل', desc: 'منشار على مسار واقف بيطلع وينزل.' },
  { id: 'rlaser',   icon: '🔦', name: 'الليزر الدوّار',        desc: 'شعاع ليزر بيلف.' },
  { id: 'bat',      icon: '🦇', name: 'الخفافيش',              desc: 'بتطير زيجزاج فوق وتحت.' },
  { id: 'mine',     icon: '💥', name: 'الألغام',               desc: 'لغم بينفجر لما تقرب منه.' },
  { id: 'vortex',   icon: '🌪️', name: 'الدوامة',               desc: 'بتشدك ناحية المنشار اللي في نصها.' },
  { id: 'vcrusher', icon: '🗜️', name: 'الحيطان الماشية',       desc: 'حيطان بتقفل وتفتح وكمان بتطلع وتنزل.' },
  { id: 'chaos',    icon: '👑', name: 'الليفل الأخير',         desc: 'كل الفخاخ مع بعض.' }
];
const NUM = TRAPS.length; // 20 levels
const LEN   = [240, 300, 360, 420, 480, 540, 600, 660, 720, 760, 780, 800, 820, 840, 860, 880, 900, 920, 940, 1000];
const RATIO = [.60, .64, .67, .69, .70, .71, .72, .73, .74, .74, .74, .74, .75, .75, .75, .75, .76, .76, .76, .77];
const THEMES = [
  { top: '#fdf9d8', bot: '#fbf3c4', wall: '#dedcae' },
  { top: '#ffe7d1', bot: '#fff4e0', wall: '#e8cfae' },
  { top: '#d9f3df', bot: '#f2fbe9', wall: '#b5d9b6' },
  { top: '#c9e7ff', bot: '#eef8ff', wall: '#a6cbe6' },
  { top: '#e3d8ff', bot: '#f6f1ff', wall: '#c4b6ea' },
  { top: '#ffd2c4', bot: '#fff0d9', wall: '#e8b6a2' },
  { top: '#cdeefa', bot: '#f1fbff', wall: '#a3d3e6' },
  { top: '#ffbf98', bot: '#ffe7b5', wall: '#e0a37a' },
  { top: '#a99ae0', bot: '#f2c4d6', wall: '#8d7cc4' },
  { top: '#4a3f8f', bot: '#9a7cc9', wall: '#3a3070' },
  { top: '#232b5c', bot: '#574c96', wall: '#181d40', night: 1 },
  { top: '#123a4a', bot: '#2d6f7a', wall: '#0c2731', night: 1 },
  { top: '#0f3b2e', bot: '#2f7a5a', wall: '#0a271f', night: 1 },
  { top: '#2a1846', bot: '#6a3c8a', wall: '#1b0f2f', night: 1 },
  { top: '#3b1430', bot: '#8a3a5c', wall: '#270c1f', night: 1 },
  { top: '#14213d', bot: '#3d5a80', wall: '#0b1426', night: 1 },
  { top: '#1d1d1d', bot: '#4a3b2a', wall: '#111111', night: 1 },
  { top: '#0b2545', bot: '#13315c', wall: '#06172e', night: 1 },
  { top: '#2b0f0f', bot: '#6b1f1f', wall: '#1a0808', night: 1 },
  { top: '#05010f', bot: '#2a1650', wall: '#020008', night: 1 }
];
const hex2rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixHex = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')'; };

/* inflation (pressure) */
const P_FILL = 0.25;   // per second while holding inflate (~4s from empty to burst)
const P_DRAIN = 0.4;  // per second when released (air leaks out slowly)
const MAX_GROW = 1.4;  // full balloon = 2.4x its normal size

/* ---------------- level generation ---------------- */
// A track (rod) is harmless. Only the saws on it kill. Saws slide left/right along the track.
function bar(x1, x2, y, extra) {
  return Object.assign({ type: 'bar', x1, x2, y, offs: [0], amp: 0.38, slide: 1.2, ph: 0, spin: 0, us: [0.5] }, extra || {});
}

function makeRow(type, y, ext, R, n, mul, obs) {
  const sp = () => (0.9 + R() * 0.6) * mul;
  switch (type) {
    case 'saw': {
      if (n >= 4 && R() < 0.35) {
        const gw = lerp(135, 108, (n - 4) / 6) + R() * 18, gc = 150 + R() * 100;
        obs.push(bar(WALL + 4, gc - gw / 2, y, { slide: sp(), ph: R() * 6.28 }), bar(gc + gw / 2, W - WALL - 4, y, { slide: sp(), ph: R() * 6.28 }));
      } else {
        const v = Math.floor(R() * 3), len = 150 + R() * 40;
        const x1 = v === 0 ? WALL + 4 : v === 1 ? W - WALL - 4 - len : 200 - len / 2;
        obs.push(bar(x1, x1 + len, y, { slide: sp(), ph: R() * 6.28 }));
      }
      break;
    }
    case 'twin': {
      if (n >= 7 && R() < 0.5) obs.push(bar(WALL + 4, W - WALL - 4, y, { offs: [-0.3, 0, 0.3], amp: 0.12, slide: (1.0 + R() * 0.5) * mul, ph: R() * 6.28 }));
      else obs.push(bar(WALL + 4, W - WALL - 4, y, { offs: [-0.25, 0.25], amp: 0.19, slide: (0.9 + R() * 0.5) * mul, ph: R() * 6.28 }));
      break;
    }
    case 'spinner': {
      const arm = Math.min(55 + Math.min(n, 12) * 3, ext - 24);
      const cx = WALL + arm + 22 + R() * (W - 2 * WALL - 2 * arm - 44);
      const mv = n >= 6 && R() < 0.6 ? (W - 2 * WALL - 2 * arm - 44) / 2 : 0;
      obs.push({ type: 'spinner', cx: mv ? 200 : cx, c0: 200, mv, sw: (0.5 + R() * 0.4) * mul, ph2: R() * 6.28, cy: y, arm, a: R() * 6.28, w: (1.2 + R() * 0.7) * mul * (R() < 0.5 ? -1 : 1) });
      break;
    }
    case 'bird': {
      const cnt = n >= 7 && R() < 0.5 ? 2 : 1;
      for (let i = 0; i < cnt; i++) {
        const dir = R() < 0.5 ? -1 : 1;
        obs.push({ type: 'bird', y: y + (i ? (R() < 0.5 ? -40 : 40) : 0), x: R() * W, vx: dir * (100 + R() * 60) * mul, ph: R() * 6, yy: y });
      }
      break;
    }
    case 'wind': {
      const dir = R() < 0.5 ? -1 : 1, hh = Math.min(95, ext - 8);
      const flip = n >= 7 ? 2.4 + R() * 1.2 : 0;
      obs.push({ type: 'wind', y, y1: y - hh, y2: y + hh, f: dir * (470 + n * 22), cur: dir * (470 + n * 22), flip, ph: R() * 100 });
      if (flip) {
        const len = 118 + R() * 12;
        obs.push(bar(WALL + 4, WALL + 4 + len, y, { slide: sp(), ph: R() * 6.28 }), bar(W - WALL - 4 - len, W - WALL - 4, y, { slide: sp(), ph: R() * 6.28 }));
      } else {
        const len = 150 + R() * 20;
        obs.push(dir > 0 ? bar(W - WALL - 4 - len, W - WALL - 4, y, { slide: sp(), ph: R() * 6.28 }) : bar(WALL + 4, WALL + 4 + len, y, { slide: sp(), ph: R() * 6.28 }));
      }
      break;
    }
    case 'laser': {
      const side = R() < 0.5 ? -1 : 1, len = Math.min(285, 220 + R() * 40 + n * 4);
      const ph = R() * 5;
      obs.push({ type: 'laser', y, side, len, off: 1.2 / Math.sqrt(mul), warn: 0.6, on: 0.95, ph, st: 0 });
      if (n >= 8 && R() < 0.5) obs.push({ type: 'laser', y: y - Math.min(60, ext - 30), side: -side, len, off: 1.2 / Math.sqrt(mul), warn: 0.6, on: 0.95, ph: ph + 1.3, st: 0 });
      break;
    }
    case 'icicle': {
      const slots = [60, 125, 200, 275, 340];
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
      const cnt = n >= 9 ? 4 : 3;
      for (let i = 0; i < cnt; i++) {
        const y0 = y - 20 + (R() - 0.5) * 40;
        obs.push({ type: 'icicle', x: slots[i] + (R() - 0.5) * 16, y0, y: y0, vy: 0, st: 0, t: 0, gone: false });
      }
      break;
    }
    case 'pendulum': {
      const len = Math.min(115, ext + 15), px = 120 + R() * 160;
      obs.push({ type: 'pendulum', px, py: y - len * 0.55, len, amp: 0.95 + R() * 0.35, w: (1.7 + R() * 0.5) * Math.sqrt(mul), ph: R() * 6.28, a: 0, mx: 0, my: 0 });
      break;
    }
    case 'crusher': {
      const gc = 140 + R() * 120;
      obs.push({ type: 'crusher', y, h: 34, gc, gmin: Math.max(72, 80 - Math.max(0, n - 9) * 4), gmax: 255, w: (1.5 + R() * 0.5) * Math.sqrt(mul), ph: R() * 6.28, gap: 200 });
      break;
    }
    case 'ghost': {
      const v = Math.floor(R() * 3), len = 170 + R() * 40;
      const x1 = v === 0 ? WALL + 4 : v === 1 ? W - WALL - 4 - len : 200 - len / 2;
      obs.push(bar(x1, x1 + len, y, { slide: sp(), ph: R() * 6.28, ghost: { per: 2.6 / Math.sqrt(mul), ph: R() * 3 } }));
      if (R() < 0.5) obs.push(bar(v === 1 ? WALL + 4 : W - WALL - 4 - 120, v === 1 ? WALL + 124 : W - WALL - 4, y, { slide: sp(), ph: R() * 6.28, ghost: { per: 2.6 / Math.sqrt(mul), ph: R() * 3 } }));
      break;
    }
    case 'bouncer': {
      const hh = Math.max(40, Math.min(90, ext - 25)), cnt = n >= 15 ? 2 : 1;
      for (let i = 0; i < cnt; i++) {
        const a = R() * 6.28, spd = (120 + R() * 50) * mul * 0.8;
        obs.push({ type: 'bouncer', y, y1: y - hh, y2: y + hh, x: 60 + R() * 280, yy: y + (R() - 0.5) * hh, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd * 0.6 + 30, rot: 0 });
      }
      break;
    }
    case 'orbit': {
      const rr = Math.min(62, ext - 30), cx = WALL + rr + 40 + R() * (W - 2 * WALL - 2 * rr - 80);
      obs.push({ type: 'orbit', cx, cy: y, rr, a: R() * 6.28, w: (1.1 + R() * 0.6) * mul * 0.7 * (R() < 0.5 ? -1 : 1), k: n >= 16 ? 4 : 3 });
      break;
    }
    case 'vsaw': {
      const hh = Math.max(50, Math.min(100, ext - 25)), cnt = n >= 16 ? 2 : 1 + (R() < 0.4 ? 1 : 0);
      const xs = cnt === 2 ? [110 + R() * 30, 260 + R() * 30] : [90 + R() * 220];
      xs.forEach(x => obs.push({ type: 'vsaw', x, y, y1: y - hh, y2: y + hh, w: (1.0 + R() * 0.6) * mul * 0.8, ph: R() * 6.28, sy: y, spin: 0 }));
      break;
    }
    case 'rlaser': {
      const L = 125, cx = 130 + R() * 140;
      obs.push({ type: 'rlaser', cx, cy: y, L: Math.min(L, ext + 20), a: R() * 6.28, w: (0.7 + R() * 0.4) * mul * 0.7 * (R() < 0.5 ? -1 : 1) });
      break;
    }
    case 'bat': {
      const cnt = n >= 17 ? 2 : 1 + (R() < 0.3 ? 1 : 0);
      for (let i = 0; i < cnt; i++) {
        const dir = R() < 0.5 ? -1 : 1;
        obs.push({ type: 'bird', bat: true, zig: Math.min(45, ext - 30), zw: 3 + R() * 2, y: y + (i ? (R() < 0.5 ? -30 : 30) : 0), x: R() * W, vx: dir * (95 + R() * 50) * mul * 0.8, ph: R() * 6, yy: y });
      }
      break;
    }
    case 'mine': {
      const cnt = n >= 18 ? 3 : 2, slots = [80, 200, 320];
      for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
      for (let i = 0; i < cnt; i++) obs.push({ type: 'mine', x: slots[i] + (R() - 0.5) * 30, y: y + (R() - 0.5) * 30, st: 0, t: 0, ph: R() * 6 });
      break;
    }
    case 'vortex': {
      const cx = 110 + R() * 180, rad = Math.min(140, ext + 30);
      obs.push({ type: 'vortex', cx, cy: y, rad, f: 520 + n * 10, spin: 0 });
      break;
    }
    case 'vcrusher': {
      const gc = 140 + R() * 120;
      obs.push({ type: 'crusher', y, y0: y, ym: Math.min(45, ext - 30), yw: (0.9 + R() * 0.4), h: 34, gc, gmin: 76, gmax: 255, w: (1.5 + R() * 0.5) * Math.sqrt(mul), ph: R() * 6.28, gap: 200 });
      break;
    }
    case 'chaos': {
      const pickT = TRAPS[Math.floor(R() * (NUM - 1))].id;
      makeRow(pickT === 'chaos' ? 'saw' : pickT, y, ext, R, n, mul, obs);
      break;
    }
    case 'cannon': {
      const side = R() < 0.5 ? -1 : 1;
      obs.push({ type: 'cannon', y, side, period: 1.9 / mul + R() * 0.4, timer: 0.3 + R() * 1.4, speed: (230 + R() * 50) * mul, recoil: 0, aim: R() < 0.5 });
      if (R() < 0.4) obs.push({ type: 'cannon', y: y - 55, side: -side, period: 2.1 / mul + R() * 0.4, timer: 0.8 + R() * 1.4, speed: (220 + R() * 50) * mul, recoil: 0 });
      break;
    }
  }
}

function bboxOf(o) {
  switch (o.type) {
    case 'bar': return [o.x1 - 24, o.y - 26, o.x2 + 24, o.y + 26];
    case 'spinner': { const m = o.mv || 0, c = o.mv ? o.c0 : o.cx; return [c - m - o.arm - 20, o.cy - o.arm - 20, c + m + o.arm + 20, o.cy + o.arm + 20]; }
    case 'bird': { const z = o.zig || 0; return [0, o.y - 32 - z, W, o.y + 32 + z]; }
    case 'laser': return o.side < 0 ? [0, o.y - 12, WALL + o.len + 6, o.y + 12] : [W - WALL - o.len - 6, o.y - 12, W, o.y + 12];
    case 'icicle': return [o.x - 14, o.y0 - 12, o.x + 14, o.y0 + 40];
    case 'pendulum': { const s = Math.sin(o.amp) * o.len + 22; return [o.px - s, o.py - 10, o.px + s, o.py + o.len + 22]; }
    case 'crusher': { const m = o.ym || 0, c = o.y0 !== undefined ? o.y0 : o.y; return [0, c - m - o.h / 2 - 8, W, c + m + o.h / 2 + 8]; }
    case 'cannon': return [0, o.y - 16, W, o.y + 16];
    case 'bouncer': return [0, o.y1 - 22, W, o.y2 + 22];
    case 'orbit': return [o.cx - o.rr - 22, o.cy - o.rr - 22, o.cx + o.rr + 22, o.cy + o.rr + 22];
    case 'vsaw': return [o.x - 26, o.y1 - 26, o.x + 26, o.y2 + 26];
    case 'rlaser': return [o.cx - o.L - 8, o.cy - o.L - 8, o.cx + o.L + 8, o.cy + o.L + 8];
    case 'mine': return [o.x - 80, o.y - 80, o.x + 80, o.y + 80];
    case 'vortex': return [o.cx - 30, o.cy - 30, o.cx + 30, o.cy + 30];
    default: return null;
  }
}

function safeSpot(x, y, obs, pad) {
  for (const o of obs) {
    const b = o.bb; if (!b) continue;
    if (x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad) return false;
  }
  return true;
}
function placeCoins(cy, R, obs, coins, sec) {
  for (let tries = 0; tries < 24; tries++) {
    const pat = Math.floor(R() * 4), x = 60 + R() * 280, pts = [];
    if (pat === 0) for (let i = 0; i < 3; i++) pts.push([x, cy - 32 + i * 32]);
    else if (pat === 1) for (let i = 0; i < 4; i++) pts.push([x - 45 + i * 30, cy - Math.sin(i / 3 * Math.PI) * 18]);
    else if (pat === 2) { const d = R() < 0.5 ? -1 : 1; for (let i = 0; i < 4; i++) pts.push([x + d * (-36 + i * 24), cy + 33 - i * 22]); }
    else for (let i = 0; i < 2; i++) pts.push([x - 15 + i * 30, cy]);
    if (pts.every(p => p[0] > WALL + 18 && p[0] < W - WALL - 18 && safeSpot(p[0], p[1], obs, 14))) {
      pts.forEach(p => coins.push({ x: p[0], y: p[1], got: false, ph: R() * 6, sec }));
      return;
    }
  }
}

// One continuous tower: level 1 at the bottom, level 10 at the top.
function buildTower() {
  const obs = [], coins = [], powers = [], sections = [];
  let startY = 0;
  for (let n = 1; n <= NUM; n++) {
    const R = rngOf(9001 + n * 7919);
    const mul = 1 + Math.min(n - 1, 9) * 0.11 + Math.max(0, n - 10) * 0.035;
    const finishY = startY - LEN[n - 1] * 10;
    const k = Math.min(1, (n - 1) / 9);
    const gMin = lerp(290, 190, k), gMax = lerp(360, 250, k);
    const sObs = [], sCoins = [];

    for (let i = 0; i < 5; i++) sCoins.push({ x: 200 + Math.sin(i * 1.1) * 45, y: startY - 150 - i * 50, got: false, ph: R() * 6, sec: n - 1 });

    const rows = []; let y = startY - 520;
    while (y > finishY + 380) { rows.push(y); y -= gMin + R() * (gMax - gMin); }

    const pool = [];
    for (let i = 0; i < n; i++) pool.push([TRAPS[i].id, i === n - 1 ? (n === 1 ? 1 : 2.6) : 1]);
    const pick = () => {
      let s = 0; for (const p of pool) s += p[1];
      let r = R() * s; for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
      return pool[0][0];
    };
    rows.forEach((ry, i) => {
      const gapBelow = i === 0 ? 400 : rows[i - 1] - ry;
      const gapAbove = i === rows.length - 1 ? 400 : ry - rows[i + 1];
      const ext = Math.min(gapBelow, gapAbove) / 2;
      const type = (n > 1 && (i === 0 || i === 2)) ? TRAPS[n - 1].id : pick();
      makeRow(type, ry, ext, R, n, mul, sObs);
      // combo rows: a bird flies just above/below another trap
      if (n >= 4 && type !== 'bird' && type !== 'cannon' && R() < Math.min(0.55, 0.12 * (n - 3))) {
        const off = (R() < 0.5 ? -1 : 1) * Math.max(40, Math.min(60, ext - 36)), dir = R() < 0.5 ? -1 : 1;
        sObs.push({ type: 'bird', y: ry + off, x: R() * W, vx: dir * (110 + R() * 60) * mul, ph: R() * 6, yy: ry + off });
      }
    });
    sObs.forEach(o => { o.sec = n - 1; updObs(o, 0, { time: 0, live: false }); o.bb = bboxOf(o); });

    const mids = [];
    for (let i = 0; i < rows.length - 1; i++) mids.push((rows[i] + rows[i + 1]) / 2);
    if (rows.length) mids.push((rows[rows.length - 1] + finishY) / 2);
    mids.forEach(cy => placeCoins(cy, R, sObs, sCoins, n - 1));

    if (n >= 3) {
      mids.forEach((cy, i) => {
        if (i < 1 || R() > 0.2) return;
        const type = n >= 4 && R() < 0.5 ? 'magnet' : 'shield';
        for (let t = 0; t < 10; t++) {
          const x = 50 + R() * 300, py = cy + (R() - 0.5) * 40;
          if (safeSpot(x, py, sObs, 20) && sCoins.every(c => Math.hypot(c.x - x, c.y - py) > 34)) { powers.push({ type, x, y: py, got: false, ph: R() * 6 }); break; }
        }
      });
    }
    sections.push({ n, startY, finishY, mul, total: sCoins.length, need: Math.ceil(sCoins.length * RATIO[n - 1]), got: 0 });
    obs.push(...sObs); coins.push(...sCoins);
    startY = finishY;
  }
  const R = rngOf(4242), clouds = [];
  for (let cy = 300; cy > startY * 0.4 - 900; cy -= 120 + R() * 140) clouds.push({ x: R() * W, y: cy, s: 0.6 + R() * 0.8 });
  return {
    sections, cur: 0, obs, coins, powers, clouds, topY: startY,
    darts: [], parts: [], texts: [],
    time: 0, live: false, camY: 0, shake: 0, flash: 0, flashColor: '#fff',
    result: null, endTimer: 0, wind: 0, mul: 1,
    B: { x: 200, y: 0, vx: 0, vy: -40, s: 1, p: 0, alive: true, shield: false, inv: 0, magnet: 0, boost: false, tilt: 0 }
  };
}

/* put the balloon at the start of a level (checkpoint) */
function resetTo(w, idx) {
  w.cur = idx;
  const sec = w.sections[idx];
  w.mul = sec.mul;
  for (let i = idx; i < NUM; i++) w.sections[i].got = 0;
  const B = w.B;
  Object.assign(B, { x: 200, y: sec.startY, vx: 0, vy: -40, s: 1, p: 0, alive: true, shield: false, inv: 0, magnet: 0, boost: false, tilt: 0 });
  w.camY = sec.startY - H * 0.72;
  w.result = null; w.endTimer = 0; w.darts = []; w.parts = []; w.texts = [];
  w.storm = makeStorm(sec);
}
function makeStorm(sec) {
  if (sec.n < 6) return null;
  return { y: sec.startY + 420, v: Math.min(40, 12 + (sec.n - 6) * 5), wait: 4 };
}

/* ---------------- obstacle update / collision ---------------- */
function updObs(o, dt, w) {
  const T = w.time;
  switch (o.type) {
    case 'bar': {
      o.spin += dt * 6;
      const s = Math.sin(T * o.slide + o.ph) * o.amp;
      o.us = o.offs.map(off => clamp(0.5 + off + s, 0.04, 0.96));
      if (o.ghost) {
        const p = (((T + o.ghost.ph) % o.ghost.per) + o.ghost.per) % o.ghost.per / o.ghost.per;
        o.alpha = p < 0.5 ? 1 : p < 0.6 ? 1 - (p - 0.5) / 0.1 : p < 0.88 ? 0 : (p - 0.88) / 0.12;
      }
      break;
    }
    case 'wind': o.cur = o.flip ? o.f * (Math.sin((T + o.ph) * Math.PI / o.flip) >= 0 ? 1 : -1) : o.f; break;
    case 'spinner': o.a += o.w * dt; if (o.mv) o.cx = o.c0 + Math.sin(T * o.sw + o.ph2) * o.mv; break;
    case 'bird':
      o.x += o.vx * dt;
      if (o.vx > 0 && o.x > W + 40) o.x = -40;
      if (o.vx < 0 && o.x < -40) o.x = W + 40;
      o.yy = o.y + Math.sin(T * 3 + o.ph) * 8 + (o.zig ? Math.sin(T * o.zw + o.ph) * o.zig : 0);
      break;
    case 'laser': {
      const c = o.off + o.warn + o.on, p = ((T + o.ph) % c + c) % c, prev = o.st;
      o.st = p < o.off ? 0 : p < o.off + o.warn ? 1 : 2;
      if (w.live && o.st === 2 && prev !== 2 && Math.abs(o.y - w.B.y) < H * 0.6) SFX.laser();
      break;
    }
    case 'icicle': {
      if (!w.live || o.gone) break;
      const B = w.B;
      if (o.st === 0 && B.alive && B.y > o.y && B.y - o.y < 320 && Math.abs(B.x - o.x) < 60) { o.st = 1; o.t = 0.45 / Math.sqrt(w.mul); }
      else if (o.st === 1) { o.t -= dt; if (o.t <= 0) o.st = 2; }
      else if (o.st === 2) { o.vy += 1300 * dt; o.y += o.vy * dt; if (o.y > w.camY + H + 80) o.gone = true; }
      break;
    }
    case 'bouncer':
      o.x += o.vx * dt; o.yy += o.vy * dt; o.rot += dt * 5;
      if (o.x < WALL + 14) { o.x = WALL + 14; o.vx = Math.abs(o.vx); }
      if (o.x > W - WALL - 14) { o.x = W - WALL - 14; o.vx = -Math.abs(o.vx); }
      if (o.yy < o.y1) { o.yy = o.y1; o.vy = Math.abs(o.vy); }
      if (o.yy > o.y2) { o.yy = o.y2; o.vy = -Math.abs(o.vy); }
      break;
    case 'orbit': o.a += o.w * dt; break;
    case 'vsaw': o.sy = (o.y1 + o.y2) / 2 + Math.sin(T * o.w + o.ph) * (o.y2 - o.y1) / 2; o.spin += dt * 7; break;
    case 'rlaser': o.a += o.w * dt; break;
    case 'vortex': o.spin += dt * 3; break;
    case 'mine': {
      if (!w.live || o.st >= 3) break;
      const B = w.B;
      if (o.st === 0 && B.alive && Math.hypot(B.x - o.x, B.y - o.y) < 105) { o.st = 1; o.t = 0.65 / Math.sqrt(w.mul); }
      else if (o.st === 1) { o.t -= dt; if (o.t <= 0) { o.st = 2; o.t = 0.28; noise(0.3, 0.45); w.shake = Math.max(w.shake, 8); burst(w, o.x, o.y, ['#ff8a1c', '#ffd23f', '#e8202a', '#555'], 22, 260); } }
      else if (o.st === 2) { o.t -= dt; if (o.t <= 0) o.st = 3; }
      break;
    }
    case 'pendulum':
      o.a = o.amp * Math.sin(T * o.w + o.ph);
      o.mx = o.px + Math.sin(o.a) * o.len; o.my = o.py + Math.cos(o.a) * o.len;
      break;
    case 'crusher':
      if (o.ym) o.y = o.y0 + Math.sin(T * o.yw + o.ph) * o.ym;
      o.gap = o.gmin + (o.gmax - o.gmin) * (0.5 + 0.5 * Math.sin(T * o.w + o.ph));
      break;
    case 'cannon':
      o.recoil = Math.max(0, o.recoil - dt * 4);
      if (!w.live) break;
      o.timer -= dt;
      if (o.timer <= 0) {
        o.timer = o.period;
        if (o.y > w.camY - 40 && o.y < w.camY + H + 20) {
          const dx0 = o.side < 0 ? WALL + 30 : W - WALL - 30;
          let vx = -o.side * o.speed, vy = 0;
          if (o.aim) { // aimed at the balloon (but never steeper than ~35 degrees)
            const ang = clamp(Math.atan2(w.B.y - o.y, Math.abs(w.B.x - dx0)), -0.6, 0.6);
            vx = -o.side * o.speed * Math.cos(ang); vy = o.speed * Math.sin(ang);
          }
          w.darts.push({ x: dx0, y: o.y, vx, vy });
          o.recoil = 1; SFX.shoot();
        }
      }
      break;
  }
}

function hitObs(o, cs) {
  for (const c of cs) {
    switch (o.type) {
      case 'bar': // only the saws hurt; the track is passable
        if (o.ghost && o.alpha < 0.5) break;
        for (const u of o.us) { const sx = o.x1 + (o.x2 - o.x1) * u; if (Math.hypot(c.x - sx, c.y - o.y) < c.r + 18) return true; }
        break;
      case 'spinner': {
        const ex = Math.cos(o.a) * o.arm, ey = Math.sin(o.a) * o.arm;
        if (segDist(c.x, c.y, o.cx - ex, o.cy - ey, o.cx + ex, o.cy + ey) < c.r + 3) return true;
        if (Math.hypot(c.x - o.cx - ex, c.y - o.cy - ey) < c.r + 13 || Math.hypot(c.x - o.cx + ex, c.y - o.cy + ey) < c.r + 13) return true;
        break;
      }
      case 'bird': if (Math.hypot(c.x - o.x, c.y - o.yy) < c.r + 11) return true; break;
      case 'laser':
        if (o.st === 2) {
          const x1 = o.side < 0 ? WALL : W - WALL - o.len, x2 = o.side < 0 ? WALL + o.len : W - WALL;
          if (c.x + c.r * 0.8 > x1 && c.x - c.r * 0.8 < x2 && Math.abs(c.y - o.y) < c.r * 0.85 + 3) return true;
        }
        break;
      case 'icicle': if (!o.gone && Math.hypot(c.x - o.x, c.y - (o.y + 14)) < c.r + 7) return true; break;
      case 'pendulum': if (Math.hypot(c.x - o.mx, c.y - o.my) < c.r + 15) return true; break;
      case 'bouncer': if (Math.hypot(c.x - o.x, c.y - o.yy) < c.r + 14) return true; break;
      case 'orbit':
        for (let i = 0; i < o.k; i++) { const a = o.a + i * Math.PI * 2 / o.k; if (Math.hypot(c.x - o.cx - Math.cos(a) * o.rr, c.y - o.cy - Math.sin(a) * o.rr) < c.r + 13) return true; }
        break;
      case 'vsaw': if (Math.hypot(c.x - o.x, c.y - o.sy) < c.r + 17) return true; break;
      case 'rlaser': {
        const ex = Math.cos(o.a) * o.L, ey = Math.sin(o.a) * o.L;
        if (segDist(c.x, c.y, o.cx - ex, o.cy - ey, o.cx + ex, o.cy + ey) < c.r * 0.85 + 3) return true;
        break;
      }
      case 'mine':
        if (o.st < 2 && Math.hypot(c.x - o.x, c.y - o.y) < c.r + 11) return true;
        if (o.st === 2 && Math.hypot(c.x - o.x, c.y - o.y) < c.r + 58) return true;
        break;
      case 'vortex': if (Math.hypot(c.x - o.cx, c.y - o.cy) < c.r + 18) return true; break;
      case 'crusher': {
        const lw = Math.max(WALL, o.gc - o.gap / 2), rx = Math.min(W - WALL, o.gc + o.gap / 2);
        if (circRect(c.x, c.y, c.r * 0.9, 0, o.y - o.h / 2, lw, o.h) || circRect(c.x, c.y, c.r * 0.9, rx, o.y - o.h / 2, W - rx, o.h)) return true;
        break;
      }
      case 'cannon': {
        const x = o.side < 0 ? WALL : W - WALL - 30;
        if (circRect(c.x, c.y, c.r, x, o.y - 12, 30, 24)) return true;
        break;
      }
    }
  }
  return false;
}

/* ---------------- drawing: obstacles ---------------- */
function drawRod(g, x1, y1, x2, y2) {
  g.lineCap = 'round';
  g.strokeStyle = OUT; g.lineWidth = 11; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = '#8fa6c1'; g.lineWidth = 6; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.45)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(x1, y1 - 1.5); g.lineTo(x2, y2 - 1.5); g.stroke();
}
function drawSaw(g, x, y, r, a) {
  const teeth = 10;
  g.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const ang = a + i * Math.PI / teeth, rr = i % 2 ? r * 0.72 : r;
    g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
  }
  g.closePath(); g.fillStyle = '#5f7fa3'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.lineJoin = 'round'; g.stroke();
  g.beginPath(); g.arc(x, y, r * 0.55, 0, 7); g.fillStyle = '#7d9abb'; g.fill(); g.stroke();
  g.beginPath(); g.arc(x, y, r * 0.17, 0, 7); g.fillStyle = OUT; g.fill();
}
function drawSpikeBall(g, x, y, r, a) {
  g.fillStyle = '#9aa3b2'; g.strokeStyle = OUT; g.lineWidth = 2.5; g.lineJoin = 'round';
  for (let i = 0; i < 8; i++) {
    const ang = a + i * Math.PI / 4;
    g.beginPath();
    g.moveTo(x + Math.cos(ang - 0.28) * r * 0.85, y + Math.sin(ang - 0.28) * r * 0.85);
    g.lineTo(x + Math.cos(ang) * (r + 9), y + Math.sin(ang) * (r + 9));
    g.lineTo(x + Math.cos(ang + 0.28) * r * 0.85, y + Math.sin(ang + 0.28) * r * 0.85);
    g.closePath(); g.fill(); g.stroke();
  }
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fillStyle = '#5d6576'; g.fill(); g.stroke();
  g.beginPath(); g.arc(x - r * 0.35, y - r * 0.35, r * 0.28, 0, 7); g.fillStyle = 'rgba(255,255,255,.35)'; g.fill();
}

function drawObs(g, o, T, night) {
  switch (o.type) {
    case 'bar': {
      drawRod(g, o.x1, o.y, o.x2, o.y);
      if (o.ghost) g.globalAlpha = 0.12 + 0.88 * (o.alpha || 0);
      for (const u of o.us) drawSaw(g, o.x1 + (o.x2 - o.x1) * u, o.y, 23, o.spin);
      g.globalAlpha = 1;
      break;
    }
    case 'bouncer': drawSpikeBall(g, o.x, o.yy, 13, o.rot); break;
    case 'orbit': {
      g.strokeStyle = 'rgba(120,140,170,.45)'; g.lineWidth = 3; g.setLineDash([6, 8]);
      g.beginPath(); g.arc(o.cx, o.cy, o.rr, 0, 7); g.stroke(); g.setLineDash([]);
      for (let i = 0; i < o.k; i++) { const a = o.a + i * Math.PI * 2 / o.k; drawRod(g, o.cx, o.cy, o.cx + Math.cos(a) * o.rr, o.cy + Math.sin(a) * o.rr); }
      for (let i = 0; i < o.k; i++) { const a = o.a + i * Math.PI * 2 / o.k; drawSaw(g, o.cx + Math.cos(a) * o.rr, o.cy + Math.sin(a) * o.rr, 16, T * 9); }
      g.beginPath(); g.arc(o.cx, o.cy, 9, 0, 7); g.fillStyle = '#c9d4e2'; g.fill(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
      break;
    }
    case 'vsaw': drawRod(g, o.x, o.y1, o.x, o.y2); drawSaw(g, o.x, o.sy, 23, o.spin); break;
    case 'rlaser': {
      const ex = Math.cos(o.a) * o.L, ey = Math.sin(o.a) * o.L;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,40,70,.28)'; g.lineWidth = 13; g.beginPath(); g.moveTo(o.cx - ex, o.cy - ey); g.lineTo(o.cx + ex, o.cy + ey); g.stroke();
      g.strokeStyle = '#ff3550'; g.lineWidth = 5; g.beginPath(); g.moveTo(o.cx - ex, o.cy - ey); g.lineTo(o.cx + ex, o.cy + ey); g.stroke();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(o.cx - ex, o.cy - ey); g.lineTo(o.cx + ex, o.cy + ey); g.stroke();
      rrect(g, o.cx - 12, o.cy - 12, 24, 24, 6); g.fillStyle = '#4f586b'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.arc(o.cx, o.cy, 5, 0, 7); g.fillStyle = '#ff3550'; g.fill();
      break;
    }
    case 'mine': {
      if (o.st >= 3) break;
      if (o.st === 2) {
        const k = 1 - o.t / 0.28;
        g.beginPath(); g.arc(o.x, o.y, 30 + 30 * k, 0, 7); g.fillStyle = `rgba(255,140,30,${0.85 - k * 0.5})`; g.fill();
        g.beginPath(); g.arc(o.x, o.y, 18 + 20 * k, 0, 7); g.fillStyle = `rgba(255,235,120,${0.9 - k * 0.6})`; g.fill();
        break;
      }
      const armed = o.st === 1, blink = armed ? Math.sin(T * 40) > 0 : Math.sin(T * 4 + o.ph) > 0.6;
      if (armed) { g.beginPath(); g.arc(o.x, o.y, 60, 0, 7); g.fillStyle = 'rgba(232,32,42,.12)'; g.fill(); g.strokeStyle = 'rgba(232,32,42,.5)'; g.lineWidth = 2; g.setLineDash([5, 6]); g.stroke(); g.setLineDash([]); }
      g.fillStyle = '#8a909e'; g.strokeStyle = OUT; g.lineWidth = 2;
      g.beginPath(); g.arc(o.x, o.y, 20, 0, 7); g.fillStyle = 'rgba(255,90,90,.18)'; g.fill(); g.fillStyle = '#8a909e';
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; g.beginPath(); g.moveTo(o.x + Math.cos(a) * 9, o.y + Math.sin(a) * 9); g.lineTo(o.x + Math.cos(a) * 16, o.y + Math.sin(a) * 16); g.lineWidth = 4; g.stroke(); }
      g.beginPath(); g.arc(o.x, o.y, 11, 0, 7); g.fill(); g.lineWidth = 2.5; g.stroke();
      g.beginPath(); g.arc(o.x, o.y, 4, 0, 7); g.fillStyle = blink ? '#ff3550' : '#6b1f1f'; g.fill();
      break;
    }
    case 'vortex': {
      g.lineWidth = 3; g.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const r0 = o.rad * (0.35 + i * 0.17);
        g.strokeStyle = night ? `rgba(190,170,255,${0.45 - i * 0.08})` : `rgba(110,80,180,${0.45 - i * 0.08})`;
        g.beginPath(); g.arc(o.cx, o.cy, r0, o.spin * (1.4 - i * 0.2) + i, o.spin * (1.4 - i * 0.2) + i + 2.2); g.stroke();
        g.beginPath(); g.arc(o.cx, o.cy, r0, o.spin * (1.4 - i * 0.2) + i + Math.PI, o.spin * (1.4 - i * 0.2) + i + Math.PI + 2.2); g.stroke();
      }
      drawSaw(g, o.cx, o.cy, 22, o.spin * 3);
      break;
    }
    case 'spinner': {
      const ex = Math.cos(o.a) * o.arm, ey = Math.sin(o.a) * o.arm;
      drawRod(g, o.cx - ex, o.cy - ey, o.cx + ex, o.cy + ey);
      drawSaw(g, o.cx + ex, o.cy + ey, 17, T * 9);
      drawSaw(g, o.cx - ex, o.cy - ey, 17, T * 9);
      g.beginPath(); g.arc(o.cx, o.cy, 9, 0, 7); g.fillStyle = '#c9d4e2'; g.fill(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.arc(o.cx, o.cy, 3, 0, 7); g.fillStyle = OUT; g.fill();
      break;
    }
    case 'bird': {
      const d = o.vx > 0 ? 1 : -1, y = o.yy;
      if (o.bat) {
        const f = Math.sin(T * 24 + o.ph);
        g.save(); g.translate(o.x, y); g.scale(d, 1);
        g.fillStyle = '#7a63a8'; g.strokeStyle = '#1a1424'; g.lineWidth = 2; g.lineJoin = 'round';
        for (const s2 of [-1, 1]) { g.beginPath(); g.moveTo(0, 0); g.lineTo(s2 * 20, -8 - f * 8); g.lineTo(s2 * 14, 2); g.lineTo(s2 * 22, 6 + f * 4); g.lineTo(0, 5); g.closePath(); g.fill(); g.stroke(); }
        g.beginPath(); g.ellipse(0, 1, 8, 9, 0, 0, 7); g.fill(); g.stroke();
        g.beginPath(); g.moveTo(-5, -6); g.lineTo(-3, -13); g.lineTo(-1, -7); g.moveTo(1, -7); g.lineTo(3, -13); g.lineTo(5, -6); g.fill(); g.stroke();
        g.fillStyle = '#ffd23f'; g.beginPath(); g.arc(-3, -1, 1.8, 0, 7); g.arc(3, -1, 1.8, 0, 7); g.fill();
        g.restore();
        break;
      }
      g.save(); g.translate(o.x, y); g.scale(d, 1);
      g.lineWidth = 2.5; g.strokeStyle = OUT; g.lineJoin = 'round';
      // beak
      g.beginPath(); g.moveTo(10, -4); g.lineTo(24, 1); g.lineTo(10, 5); g.closePath(); g.fillStyle = '#ffa41c'; g.fill(); g.stroke();
      // body
      g.beginPath(); g.ellipse(0, 0, 15, 12, 0, 0, 7); g.fillStyle = '#6a4fb3'; g.fill(); g.stroke();
      g.beginPath(); g.ellipse(2, 5, 8, 5, 0, 0, 7); g.fillStyle = '#c9b8f2'; g.fill();
      // eye + angry brow
      g.beginPath(); g.arc(6, -4, 4.2, 0, 7); g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.stroke();
      g.beginPath(); g.arc(7.5, -3.5, 1.9, 0, 7); g.fillStyle = OUT; g.fill();
      g.lineWidth = 2.5; g.beginPath(); g.moveTo(1, -10); g.lineTo(11, -7); g.stroke();
      // wing
      const f = Math.sin(T * 20 + o.ph);
      g.beginPath(); g.ellipse(-4, -2 - f * 4, 9, 5 + f * 3, -0.5 - f * 0.4, 0, 7); g.fillStyle = '#4e3790'; g.fill(); g.lineWidth = 2; g.stroke();
      g.restore();
      break;
    }
    case 'wind': {
      const dir = Math.sign(o.cur || o.f);
      g.fillStyle = night ? 'rgba(140,190,255,.10)' : 'rgba(120,175,240,.16)';
      g.fillRect(WALL, o.y1, W - 2 * WALL, o.y2 - o.y1);
      g.strokeStyle = night ? 'rgba(180,215,255,.55)' : 'rgba(70,130,200,.5)'; g.lineWidth = 3; g.lineCap = 'round';
      const span = W + 80;
      for (let i = 0; i < 10; i++) {
        const x = (((i * 61 + o.ph * 37 + T * 280 * dir) % span) + span) % span - 40;
        const yy = o.y1 + (i + 0.5) / 10 * (o.y2 - o.y1) + Math.sin(T * 4 + i) * 4;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x - dir * 38, yy); g.stroke();
      }
      // chevrons
      g.strokeStyle = night ? 'rgba(200,225,255,.7)' : 'rgba(50,100,170,.55)'; g.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        const cx = 200 + dir * (i * 22 - 22) + Math.sin(T * 6) * 4 * dir;
        g.beginPath(); g.moveTo(cx - dir * 8, o.y - 12); g.lineTo(cx + dir * 4, o.y); g.lineTo(cx - dir * 8, o.y + 12); g.stroke();
      }
      break;
    }
    case 'laser': {
      const x1 = o.side < 0 ? WALL : W - WALL - o.len, x2 = o.side < 0 ? WALL + o.len : W - WALL;
      const ex = o.side < 0 ? WALL - 2 : W - WALL - 16;
      const endX = o.side < 0 ? x2 : x1;
      if (o.st === 1) {
        if (Math.sin(T * 45) > -0.2) {
          g.strokeStyle = 'rgba(255,40,60,.7)'; g.lineWidth = 1.6; g.setLineDash([6, 6]);
          g.beginPath(); g.moveTo(x1, o.y); g.lineTo(x2, o.y); g.stroke(); g.setLineDash([]);
        }
      } else if (o.st === 2) {
        const flick = 1 + Math.sin(T * 50) * 0.15;
        g.lineCap = 'round';
        g.strokeStyle = 'rgba(255,40,70,.28)'; g.lineWidth = 14 * flick; g.beginPath(); g.moveTo(x1, o.y); g.lineTo(x2, o.y); g.stroke();
        g.strokeStyle = '#ff3550'; g.lineWidth = 5; g.beginPath(); g.moveTo(x1, o.y); g.lineTo(x2, o.y); g.stroke();
        g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x1, o.y); g.lineTo(x2, o.y); g.stroke();
        g.beginPath(); g.arc(endX, o.y, 6 * flick, 0, 7); g.fillStyle = 'rgba(255,90,110,.7)'; g.fill();
      }
      rrect(g, ex, o.y - 12, 18, 24, 5); g.fillStyle = '#4f586b'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.arc(o.side < 0 ? ex + 15 : ex + 3, o.y, 4.5, 0, 7);
      g.fillStyle = o.st === 0 ? '#7a2530' : '#ff3550'; g.fill(); g.lineWidth = 2; g.stroke();
      break;
    }
    case 'icicle': {
      // rock cap stays
      rrect(g, o.x - 15, o.y0 - 10, 30, 12, 6); g.fillStyle = '#8a8f9c'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
      if (o.gone) break;
      const sx = o.st === 1 ? Math.sin(T * 70) * 2.2 : 0;
      g.beginPath(); g.moveTo(o.x - 10 + sx, o.y); g.lineTo(o.x + 10 + sx, o.y); g.lineTo(o.x + sx, o.y + 34); g.closePath();
      g.fillStyle = '#bfe9ff'; g.fill(); g.lineJoin = 'round'; g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
      g.beginPath(); g.moveTo(o.x - 4 + sx, o.y + 3); g.lineTo(o.x - 1 + sx, o.y + 20); g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2; g.stroke();
      if (o.st === 1) { g.fillStyle = '#e8202a'; g.font = '900 18px Cairo, sans-serif'; g.textAlign = 'center'; g.fillText('!', o.x, o.y0 - 14); }
      break;
    }
    case 'pendulum': {
      const links = 9;
      g.fillStyle = '#c9d4e2'; g.strokeStyle = OUT; g.lineWidth = 2;
      for (let i = 1; i < links; i++) {
        const t = i / links;
        g.beginPath(); g.arc(lerp(o.px, o.mx, t), lerp(o.py, o.my, t), 3.2, 0, 7); g.fill(); g.stroke();
      }
      g.beginPath(); g.arc(o.px, o.py, 8, 0, 7); g.fillStyle = '#7d9abb'; g.fill(); g.lineWidth = 3; g.stroke();
      g.beginPath(); g.arc(o.px, o.py, 2.5, 0, 7); g.fillStyle = OUT; g.fill();
      drawSpikeBall(g, o.mx, o.my, 15, o.a * 2);
      break;
    }
    case 'crusher': {
      const lw = Math.max(WALL, o.gc - o.gap / 2), rx = Math.min(W - WALL, o.gc + o.gap / 2), top = o.y - o.h / 2;
      const block = (x, w, inner) => {
        rrect(g, x, top, w, o.h, 6); g.fillStyle = '#7f8ea3'; g.fill(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
        // hazard stripe at inner edge
        g.save(); rrect(g, x, top, w, o.h, 6); g.clip();
        const sx = inner > 0 ? x + w - 18 : x;
        g.fillStyle = '#ffd23f'; g.fillRect(sx, top, 18, o.h);
        g.fillStyle = OUT;
        for (let i = -2; i < 6; i++) { g.beginPath(); g.moveTo(sx + i * 9, top + o.h); g.lineTo(sx + i * 9 + 5, top + o.h); g.lineTo(sx + i * 9 + 5 + o.h, top); g.lineTo(sx + i * 9 + o.h, top); g.closePath(); g.fill(); }
        g.restore();
        rrect(g, x, top, w, o.h, 6); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
        // spikes
        const ex = inner > 0 ? x + w : x;
        g.fillStyle = '#c9d4e2'; g.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const yy = top + 6 + i * 11;
          g.beginPath(); g.moveTo(ex, yy - 4); g.lineTo(ex + inner * 10, yy + 1); g.lineTo(ex, yy + 6); g.closePath(); g.fill(); g.stroke();
        }
      };
      block(-4, lw + 4, 1);
      block(rx, W - rx + 4, -1);
      break;
    }
    case 'cannon': {
      const s = o.side, rc = o.recoil * 5;
      g.save(); g.translate(s < 0 ? WALL : W - WALL, o.y); g.scale(-s, 1);
      // facing inward (+x)
      rrect(g, 10 - rc, -8, 26, 16, 4); g.fillStyle = '#3d4454'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = OUT; g.stroke();
      rrect(g, 32 - rc, -10, 6, 20, 2); g.fillStyle = '#2b3040'; g.fill(); g.stroke();
      g.beginPath(); g.arc(8, 0, 13, -Math.PI / 2, Math.PI / 2); g.fillStyle = '#525b70'; g.fill(); g.stroke();
      g.fillStyle = '#e8202a'; g.beginPath(); g.arc(10, 0, 3.5, 0, 7); g.fill();
      if (o.recoil > 0.6) { g.beginPath(); g.arc(44, 0, 9 * o.recoil, 0, 7); g.fillStyle = 'rgba(255,190,60,.8)'; g.fill(); }
      g.restore();
      break;
    }
  }
}
function drawDart(g, d) {
  const s = Math.sign(d.vx);
  g.save(); g.translate(d.x, d.y); g.scale(s, 1); if (d.vy) g.rotate(Math.atan2(d.vy, Math.abs(d.vx)));
  g.strokeStyle = OUT; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-20, 0); g.lineTo(6, 0); g.stroke();
  g.beginPath(); g.moveTo(14, 0); g.lineTo(4, -6); g.lineTo(4, 6); g.closePath(); g.fillStyle = '#c9d4e2'; g.fill(); g.lineWidth = 2; g.stroke();
  g.fillStyle = '#e8202a';
  g.beginPath(); g.moveTo(-20, 0); g.lineTo(-26, -6); g.lineTo(-14, 0); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(-20, 0); g.lineTo(-26, 6); g.lineTo(-14, 0); g.closePath(); g.fill();
  g.restore();
}

/* ---------------- drawing: items, balloon, scene ---------------- */
function drawCoin(g, x, y, T, ph) {
  const sx = Math.abs(Math.cos(T * 3 + ph)) * 0.75 + 0.25;
  g.save(); g.translate(x, y); g.scale(sx, 1);
  g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fillStyle = '#f7c531'; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#a5720a'; g.stroke();
  g.beginPath(); g.arc(0, 0, 6.5, 0, 7); g.strokeStyle = '#d99c12'; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(-3.5, -3.5, 2.6, 0, 7); g.fillStyle = 'rgba(255,255,255,.8)'; g.fill();
  g.restore();
}
function drawPower(g, p, T) {
  const y = p.y + Math.sin(T * 3 + p.ph) * 5;
  g.beginPath(); g.arc(p.x, y, 20 + Math.sin(T * 5) * 2, 0, 7); g.fillStyle = 'rgba(255,255,255,.55)'; g.fill();
  g.beginPath(); g.arc(p.x, y, 16, 0, 7);
  g.fillStyle = p.type === 'shield' ? '#7fdcff' : '#ffb0b6'; g.fill(); g.lineWidth = 3; g.strokeStyle = OUT; g.stroke();
  if (p.type === 'shield') {
    g.beginPath(); g.moveTo(p.x, y - 9); g.lineTo(p.x + 8, y - 6); g.lineTo(p.x + 7, y + 2); g.quadraticCurveTo(p.x + 4, y + 8, p.x, y + 10);
    g.quadraticCurveTo(p.x - 4, y + 8, p.x - 7, y + 2); g.lineTo(p.x - 8, y - 6); g.closePath();
    g.fillStyle = '#2a8fbf'; g.fill(); g.lineWidth = 2; g.stroke();
  } else {
    g.lineCap = 'butt'; g.lineWidth = 6; g.strokeStyle = '#e8202a';
    g.beginPath(); g.arc(p.x, y + 1, 6, 0, Math.PI); g.stroke();
    g.beginPath(); g.moveTo(p.x - 6, y + 1); g.lineTo(p.x - 6, y - 6); g.moveTo(p.x + 6, y + 1); g.lineTo(p.x + 6, y - 6); g.stroke();
    g.strokeStyle = '#d6dbe3'; g.beginPath(); g.moveTo(p.x - 6, y - 4); g.lineTo(p.x - 6, y - 8); g.moveTo(p.x + 6, y - 4); g.lineTo(p.x + 6, y - 8); g.stroke();
  }
}

const RED = { hi: '#ff4a4f', lo: '#d10f1a', neck: '#b5121b', line: '#6b0a10' };
const BLUE = { hi: '#5aa9ff', lo: '#1f5fd1', neck: '#1a4aa0', line: '#0d2a66' };
function drawBalloon(g, B, T, col) {
  col = col || RED;
  const R = 20 * B.s;
  const jit = B.p > 0.75 ? (B.p - 0.75) * 16 : 0;
  g.save(); g.translate(B.x + Math.sin(T * 63) * jit, B.y + Math.cos(T * 71) * jit * 0.5); g.rotate(B.tilt);
  if (B.inv > 0 && Math.sin(T * 40) > 0) g.globalAlpha = 0.45;
  // strings + basket
  const by = R * 1.05 + 14;
  g.strokeStyle = '#7b5b3a'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(-R * 0.45, R * 0.9); g.lineTo(-5, by); g.moveTo(R * 0.45, R * 0.9); g.lineTo(5, by);
  g.moveTo(-R * 0.15, R * 1.0); g.lineTo(-2, by); g.moveTo(R * 0.15, R * 1.0); g.lineTo(2, by); g.stroke();
  // burner flame
  if (B.boost && B.alive) {
    const f = 6 + Math.sin(T * 50) * 2;
    g.beginPath(); g.moveTo(-4, by - 2); g.quadraticCurveTo(0, by - 2 - f * 2.2, 4, by - 2); g.closePath();
    g.fillStyle = '#ffb21c'; g.fill();
    g.beginPath(); g.moveTo(-2, by - 2); g.quadraticCurveTo(0, by - 2 - f * 1.2, 2, by - 2); g.closePath(); g.fillStyle = '#fff3a8'; g.fill();
  }
  rrect(g, -7, by, 14, 11, 2.5); g.fillStyle = '#a8662c'; g.fill(); g.lineWidth = 2; g.strokeStyle = '#4a2c12'; g.stroke();
  g.strokeStyle = 'rgba(74,44,18,.6)'; g.lineWidth = 1; g.beginPath(); g.moveTo(-7, by + 4); g.lineTo(7, by + 4); g.stroke();
  // neck
  g.beginPath(); g.moveTo(-R * 0.3, R * 0.85); g.lineTo(R * 0.3, R * 0.85); g.lineTo(R * 0.18, R * 1.08); g.lineTo(-R * 0.18, R * 1.08); g.closePath();
  g.fillStyle = col.neck; g.fill(); g.lineWidth = 2; g.strokeStyle = col.line; g.stroke();
  // envelope
  g.beginPath(); g.ellipse(0, 0, R, R * 1.06, 0, 0, 7);
  const gr = g.createRadialGradient(-R * 0.3, -R * 0.4, R * 0.1, 0, 0, R * 1.1);
  gr.addColorStop(0, col.hi); gr.addColorStop(1, col.lo);
  g.fillStyle = gr; g.fill(); g.lineWidth = 2.5; g.strokeStyle = col.line; g.stroke();
  g.strokeStyle = 'rgba(110,10,16,.45)'; g.lineWidth = 1.4;
  g.beginPath(); g.ellipse(0, 0, R * 0.45, R * 1.04, 0, -Math.PI / 2, Math.PI / 2); g.stroke();
  g.beginPath(); g.ellipse(0, 0, R * 0.45, R * 1.04, 0, Math.PI / 2, Math.PI * 1.5); g.stroke();
  g.beginPath(); g.moveTo(0, -R * 1.05); g.lineTo(0, R * 1.05); g.stroke();
  g.beginPath(); g.ellipse(-R * 0.45, -R * 0.5, R * 0.2, R * 0.3, -0.5, 0, 7); g.fillStyle = 'rgba(255,255,255,.6)'; g.fill();
  g.globalAlpha = 1;
  // shield bubble
  if (B.shield) {
    g.beginPath(); g.arc(0, 8, R + 22 + Math.sin(T * 6) * 1.5, 0, 7);
    g.fillStyle = 'rgba(127,220,255,.18)'; g.fill(); g.lineWidth = 3; g.strokeStyle = 'rgba(42,143,191,.75)'; g.stroke();
    g.beginPath(); g.arc(-R * 0.6, -R * 0.4, R + 14, Math.PI * 1.1, Math.PI * 1.35); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 3; g.stroke();
  }
  g.restore();
  if (B.magnet > 0) {
    g.beginPath(); g.arc(B.x, B.y + 6, 50 + (T * 60) % 60, 0, 7);
    g.strokeStyle = `rgba(232,32,42,${0.35 * (1 - ((T * 60) % 60) / 60)})`; g.lineWidth = 2; g.stroke();
  }
}

function drawStorm(g, w, T, bot) {
  const y = w.storm.y;
  const gr = g.createLinearGradient(0, y - 30, 0, y + 160);
  gr.addColorStop(0, 'rgba(60,52,92,0.0)'); gr.addColorStop(0.25, 'rgba(60,52,92,0.88)'); gr.addColorStop(1, 'rgba(34,30,58,0.97)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, bot + 10);
  for (let x = 0; x <= W; x += 20) g.lineTo(x, y + Math.sin(x * 0.07 + T * 3) * 9 + Math.sin(x * 0.19 - T * 5) * 5);
  g.lineTo(W, bot + 10); g.closePath(); g.fill();
  // thorn tips on the top edge
  g.fillStyle = '#2b2442';
  for (let x = 10; x < W; x += 26) {
    const yy = y + 18 + Math.sin(x * 0.07 + T * 3) * 9;
    g.beginPath(); g.moveTo(x - 7, yy + 8); g.lineTo(x, yy - 12 - Math.sin(T * 6 + x) * 3); g.lineTo(x + 7, yy + 8); g.closePath(); g.fill();
  }
  // lightning flicker
  if (Math.sin(T * 7.3) > 0.93) {
    const lx = 60 + ((T * 997) % 280);
    g.strokeStyle = 'rgba(255,240,140,.95)'; g.lineWidth = 3; g.beginPath();
    g.moveTo(lx, y + 30); g.lineTo(lx + 12, y + 60); g.lineTo(lx - 6, y + 80); g.lineTo(lx + 8, y + 120); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '900 14px Cairo, sans-serif'; g.textAlign = 'center';
  g.fillText('⚡ العاصفة ⚡', 200, y + 70);
}

function drawGhost(g, w, T, top, bot, o, name, col, nameCol, slot) {
  if (!o) return;
  if (o.y > top - 40 && o.y < bot) {
    if (!o.alive) return;
    g.save(); g.globalAlpha = 0.92;
    drawBalloon(g, { x: o.x, y: o.y, s: 1 + o.p * MAX_GROW, p: o.p, tilt: o.tl || 0, alive: true, boost: !!(o.k & 1), inv: 0, shield: false, magnet: 0 }, T, col);
    g.restore();
    g.font = '800 13px Cairo, sans-serif'; g.textAlign = 'center';
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(name, o.x, o.y - 30 - o.p * 28);
    g.fillStyle = nameCol; g.fillText(name, o.x, o.y - 30 - o.p * 28);
  } else {
    const above = o.y < top, y = above ? w.camY + 118 + slot * 28 : w.camY + H - 210 - slot * 28;
    const dist = Math.round(Math.abs(o.y - (w.camY + H * 0.55)) / 10);
    const label = (above ? '⬆ ' : '⬇ ') + name + ' ' + dist + 'm';
    g.font = '800 13px Cairo, sans-serif'; g.textAlign = 'center';
    const tw = g.measureText(label).width + 18, x = clamp(o.x, WALL + tw / 2 + 4, W - WALL - tw / 2 - 4);
    rrect(g, x - tw / 2, y - 14, tw, 24, 10); g.fillStyle = nameCol; g.globalAlpha = 0.88; g.fill(); g.globalAlpha = 1;
    g.fillStyle = '#fff'; g.fillText(label, x, y + 3);
  }
}

function drawCloud(g, x, y, s, night) {
  g.fillStyle = night ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.75)';
  g.beginPath();
  g.arc(x, y, 22 * s, 0, 7); g.arc(x + 24 * s, y - 10 * s, 26 * s, 0, 7); g.arc(x + 50 * s, y, 20 * s, 0, 7);
  g.rect(x, y - 2 * s, 50 * s, 22 * s);
  g.fill();
}

function sectionAt(w, y) {
  for (let i = 0; i < NUM; i++) if (y > w.sections[i].finishY) return i;
  return NUM - 1;
}
function themeAt(w, y) {
  const i = sectionAt(w, y), sec = w.sections[i], a = THEMES[i];
  const d = y - sec.finishY;
  const na = a.night ? 1 : 0;
  if (i < NUM - 1 && d < 500) {
    const b = THEMES[i + 1], t = 1 - d / 500;
    return { top: mixHex(a.top, b.top, t), bot: mixHex(a.bot, b.bot, t), wall: mixHex(a.wall, b.wall, t), nightT: lerp(na, b.night ? 1 : 0, t), idx: i };
  }
  return { top: a.top, bot: a.bot, wall: a.wall, nightT: na, idx: i };
}

function drawGate(g, w, i) {
  const sec = w.sections[i], y = sec.finishY;
  const passed = i < w.cur, current = i === w.cur, ok = passed || (current && sec.got >= sec.need);
  const dark = ok ? '#2fb162' : current ? OUT : '#9aa0ab';
  for (let k = 0; k < 20; k++) for (let j = 0; j < 2; j++) {
    g.fillStyle = (k + j) % 2 ? dark : '#fff';
    g.fillRect(WALL + k * ((W - 2 * WALL) / 20), y - 10 + j * 10, (W - 2 * WALL) / 20 + 0.5, 10);
  }
  g.strokeStyle = OUT; g.lineWidth = 3; g.strokeRect(WALL, y - 10, W - 2 * WALL, 20);
  let label;
  if (passed) label = '✔ ليفل ' + (i + 1);
  else if (current) label = ok ? (i === NUM - 1 ? '🏆 النهاية' : 'افتحت ✔ ليفل ' + (i + 2)) : '🔒 ' + sec.got + '/' + sec.need;
  else label = '🔒 ليفل ' + (i + 2);
  g.font = '900 19px Cairo, sans-serif'; g.textAlign = 'center';
  const tw = g.measureText(label).width + 26;
  rrect(g, 200 - tw / 2, y - 50, tw, 32, 12);
  g.fillStyle = ok ? '#2fb162' : current ? '#e8202a' : '#9aa0ab'; g.fill(); g.lineWidth = 3; g.stroke();
  g.fillStyle = '#fff'; g.fillText(label, 200, y - 27);
}

function drawWorld(w, T) {
  const B = w.B, th = themeAt(w, w.camY + H * 0.5), night = th.nightT > 0.5;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, th.top); sky.addColorStop(1, th.bot);
  ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  if (th.nightT > 0) {
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 97.3) % W, sy = (((i * 131.7) - w.camY * 0.15) % H + H) % H;
      ctx.globalAlpha = th.nightT * (0.4 + 0.4 * Math.sin(T * 2 + i));
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;
  }
  for (const c of w.clouds) {
    const sy = c.y - w.camY * 0.4;
    if (sy > -60 && sy < H + 60) drawCloud(ctx, c.x - 25, sy, c.s, night);
  }

  let sx = 0, sy = 0;
  if (w.shake > 0) { sx = (Math.random() - 0.5) * w.shake; sy = (Math.random() - 0.5) * w.shake; }
  ctx.translate(sx, -w.camY + sy);
  const top = w.camY - 80, bot = w.camY + H + 80;

  // height markers
  ctx.font = '700 12px Cairo, sans-serif'; ctx.textAlign = 'left';
  const m0 = Math.floor(-bot / 500) * 50, m1 = Math.ceil(-top / 500) * 50;
  for (let m = Math.max(50, m0); m <= m1; m += 50) {
    const y = -m * 10;
    ctx.strokeStyle = night ? 'rgba(255,255,255,.1)' : 'rgba(43,52,64,.08)'; ctx.lineWidth = 2; ctx.setLineDash([8, 10]);
    ctx.beginPath(); ctx.moveTo(WALL, y); ctx.lineTo(W - WALL, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = night ? 'rgba(255,255,255,.35)' : 'rgba(43,52,64,.3)';
    ctx.fillText(m + 'm', WALL + 6, y - 5);
  }

  // ground
  if (bot > 30) {
    ctx.fillStyle = '#8fcf5c'; ctx.fillRect(0, 40, W, 400);
    ctx.fillStyle = '#7cbc4a'; for (let i = 0; i < 10; i++) { ctx.beginPath(); ctx.arc(i * 44 + 10, 44, 18, Math.PI, 0); ctx.fill(); }
    ctx.strokeStyle = OUT; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(W, 40); ctx.stroke();
    rrect(ctx, 170, 26, 60, 16, 5); ctx.fillStyle = '#a8662c'; ctx.fill(); ctx.stroke();
  }

  for (let i = 0; i < NUM; i++) { const y = w.sections[i].finishY; if (y > top - 60 && y < bot + 60) drawGate(ctx, w, i); }

  for (const c of w.coins) if (!c.got && c.y > top && c.y < bot) drawCoin(ctx, c.x, c.y, T, c.ph);
  for (const p of w.powers) if (!p.got && p.y > top && p.y < bot) drawPower(ctx, p, T);

  for (const o of w.obs) if (o.type === 'wind' && o.y2 > top && o.y1 < bot) drawObs(ctx, o, T, night);
  for (const o of w.obs) {
    if (o.type === 'wind') continue;
    const b = o.bb;
    if (o.type === 'icicle' && o.st === 2 && !o.gone) { drawObs(ctx, o, T, night); continue; }
    if (b && (b[3] < top || b[1] > bot)) continue;
    drawObs(ctx, o, T, night);
  }
  for (const d of w.darts) drawDart(ctx, d);

  if (w.storm && w.storm.y < bot) drawStorm(ctx, w, T, bot);
  if (NET.on && NET.g && NET.g.od) drawGhost(ctx, w, T, top, bot, NET.g.od, NET.oppName, BLUE, '#1f5fd1', 0);
  if (SPEC.on) for (let i = 0; i < 2; i++) if (SPEC.g[i]) drawGhost(ctx, w, T, top, bot, SPEC.g[i].od, SPEC.names[i] || '', i ? BLUE : RED, i ? '#1f5fd1' : '#d10f1a', i);
  if (B.alive) drawBalloon(ctx, B, T);

  for (const p of w.parts) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
    ctx.fillStyle = p.c;
    if (p.sq) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); ctx.restore(); }
    else { ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 7); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  for (const t of w.texts) {
    ctx.globalAlpha = clamp(t.life, 0, 1);
    ctx.font = '900 18px Cairo, sans-serif';
    ctx.lineWidth = 4; ctx.strokeStyle = '#fff'; ctx.strokeText(t.s, t.x, t.y);
    ctx.fillStyle = t.c; ctx.fillText(t.s, t.x, t.y);
  }
  ctx.globalAlpha = 1;

  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  ctx.fillStyle = th.wall; ctx.fillRect(0, 0, WALL, H); ctx.fillRect(W - WALL, 0, WALL, H);
  ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(WALL - 3, 0, 3, H); ctx.fillRect(W - WALL, 0, 3, H);
  // red vignette when about to burst
  if (B.alive && B.p > 0.75) {
    const a = (B.p - 0.75) * 4 * (0.6 + 0.4 * Math.sin(T * 20));
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    vg.addColorStop(0, 'rgba(232,32,42,0)'); vg.addColorStop(1, `rgba(232,32,42,${0.45 * a})`);
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  }
  if (w.flash > 0) { ctx.globalAlpha = Math.min(0.6, w.flash); ctx.fillStyle = w.flashColor; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
}

/* ---------------- effects ---------------- */
function burst(w, x, y, colors, count, speed, sq) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.9);
    w.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6 + Math.random() * 0.6, max: 1.2,
      c: colors[i % colors.length], size: sq ? 6 + Math.random() * 8 : 2 + Math.random() * 3, sq, r: Math.random() * 6, vr: (Math.random() - 0.5) * 12 });
  }
}
function floatText(w, x, y, s, c) { w.texts.push({ x, y, s, c, life: 1 }); }
const CONFETTI = ['#e8202a', '#f7c531', '#2fb162', '#6f8fb0', '#a66bff'];

/* ---------------- game state ---------------- */
let state = 'menu';
let world = buildTower();
resetTo(world, Math.min(save.unlocked, NUM) - 1);
const input = { left: false, right: false, up: false, down: false };
let warnT = 0;

function startRun(idx) {
  world = buildTower();
  resetTo(world, idx);
  world.live = true;
  state = 'play';
  hideOverlay();
  $('hud').classList.remove('hidden');
  $('controls').classList.remove('hidden');
  showBanner(idx);
  updateHud(true);
}

function update(dt) {
  const w = world, B = w.B, sec = w.sections[w.cur];
  w.time += dt;
  const top = w.camY - 260, bot = w.camY + H + 260;

  for (const o of w.obs) {
    const b = o.bb;
    if (o.type === 'icicle' && o.st >= 1) { updObs(o, dt, w); continue; }
    if (o.type === 'wind') { if (o.y2 < top || o.y1 > bot) continue; }
    else if (b && (b[3] < top || b[1] > bot)) continue;
    updObs(o, dt, w);
  }
  for (const d of w.darts) { d.x += d.vx * dt; d.y += (d.vy || 0) * dt; }
  w.darts = w.darts.filter(d => d.x > -40 && d.x < W + 40);

  if (B.alive && !w.result) {
    B.boost = input.up;
    // inflation pressure: holding inflate fills it, releasing lets air out. Full = burst!
    const deflating = input.down && !B.boost;
    B.p = clamp(B.p + (B.boost ? P_FILL : deflating ? -1.4 : -P_DRAIN) * dt, 0, 1);
    // the more it is inflated, the faster it climbs
    // not inflated -> it sinks; a little air -> hovers; lots of air -> climbs fast
    // holding inflate = climb fast right away; otherwise the leftover air decides (sink / hover / drift up)
    const targetVy = B.boost ? -260 : 110 - B.p * 430 + (deflating ? 170 : 0);
    B.vy += (targetVy - B.vy) * Math.min(1, dt * (B.boost ? 6 : 2.6));
    w.wind = 0;
    for (const o of w.obs) if (o.type === 'wind' && B.y > o.y1 && B.y < o.y2) w.wind += o.cur;
    for (const o of w.obs) {
      if (o.type !== 'vortex' || Math.abs(o.cy - B.y) > o.rad) continue;
      const dx = o.cx - B.x, dy = o.cy - B.y, d = Math.hypot(dx, dy);
      if (d < o.rad && d > 1) { const k = 1 - d / o.rad; w.wind += dx / d * o.f * k * 1.6; B.vy += dy / d * 260 * k * dt; }
    }
    let ax = w.wind;
    if (input.left) ax -= 1150;
    if (input.right) ax += 1150;
    B.vx += ax * dt;
    B.vx *= Math.pow(!input.left && !input.right ? 0.03 : 0.5, dt);
    B.vx = clamp(B.vx, -240, 240);
    B.x += B.vx * dt; B.y += B.vy * dt;
    B.s += ((1 + B.p * MAX_GROW) - B.s) * Math.min(1, dt * 10);
    const R = 20 * B.s;
    const floorY = w.sections[w.cur].startY - (w.cur === 0 ? R * 1.05 + 30 : 0);
    if (B.y > floorY) { B.y = floorY; if (B.vy > 0) B.vy = 0; }
    if (B.x < WALL + R) { B.x = WALL + R; B.vx = Math.abs(B.vx) * 0.3; }
    if (B.x > W - WALL - R) { B.x = W - WALL - R; B.vx = -Math.abs(B.vx) * 0.3; }
    B.tilt += (B.vx * 0.0011 - B.tilt) * Math.min(1, dt * 8);
    if (B.inv > 0) B.inv -= dt;
    if (B.magnet > 0) B.magnet -= dt;

    if (B.p > 0.75) { warnT -= dt; if (warnT <= 0) { warnT = lerp(0.3, 0.1, (B.p - 0.75) * 4); tone(900 + B.p * 400, 0.05, 'square', 0.04); } }
    if (B.p >= 1) { burstBalloon('over'); }
    else {
      const cs = [{ x: B.x, y: B.y, r: R * 0.92 }, { x: B.x, y: B.y + R * 1.05 + 19, r: 6 }];
      let hit = false;
      for (const o of w.obs) {
        if (o.type === 'wind') continue;
        const b = o.bb;
        if (!(o.type === 'icicle' && o.st === 2) && b && (b[3] < B.y - 120 || b[1] > B.y + 120)) continue;
        if (hitObs(o, cs)) { hit = true; break; }
      }
      if (!hit) for (const d of w.darts) {
        const s = Math.sign(d.vx);
        const sp = Math.hypot(d.vx, d.vy || 0) || 1, ux = d.vx / sp, uy = (d.vy || 0) / sp;
        if (segDist(cs[0].x, cs[0].y, d.x - ux * 22, d.y - uy * 22, d.x + ux * 14, d.y + uy * 14) < cs[0].r + 2) { hit = true; d.x = 9999; break; }
      }
      if (hit) onHit();
    }

    // coins
    const magR = B.magnet > 0 ? 150 : 0;
    for (const c of w.coins) {
      if (c.got || Math.abs(c.y - B.y) > 200) continue;
      const dx = B.x - c.x, dy = B.y - c.y, d = Math.hypot(dx, dy);
      if (magR && d < magR) { c.x += dx / d * 520 * dt; c.y += dy / d * 520 * dt; }
      if (d < R + 12) {
        c.got = true; w.sections[c.sec].got++;
        if (w.time - coinPitchT < 0.6) coinPitch = Math.min(coinPitch + 1, 12); else coinPitch = 0;
        coinPitchT = w.time;
        SFX.coin(); burst(w, c.x, c.y, ['#f7c531', '#fff3a8'], 6, 120);
        floatText(w, c.x, c.y - 14, '+1', '#c98a00');
        if (c.sec === w.cur && sec.got === sec.need) { hudMsg('البوابة اتفتحت! ✔', 1.4); SFX.power(); }
      }
    }
    for (const p of w.powers) {
      if (p.got) continue;
      if (Math.hypot(B.x - p.x, B.y - p.y) < R + 16) {
        p.got = true; SFX.power(); burst(w, p.x, p.y, p.type === 'shield' ? ['#7fdcff', '#fff'] : ['#ff6b74', '#fff'], 14, 160);
        if (p.type === 'shield') { B.shield = true; floatText(w, p.x, p.y - 20, 'درع! 🛡️', '#2a8fbf'); }
        else { B.magnet = 8; floatText(w, p.x, p.y - 20, 'مغناطيس! 🧲', '#e8202a'); }
      }
    }

    // rising storm
    if (w.storm && B.alive) {
      const st = w.storm;
      if (st.wait > 0) st.wait -= dt;
      else st.y -= st.v * dt;
      st.y = Math.min(st.y, w.camY + H + 140); // never too far behind: keeps the pressure on
      if (B.y + R * 0.8 > st.y) burstBalloon('storm');
    }

    // level gate
    if (B.alive && B.y < sec.finishY + 10) {
      if (sec.got >= sec.need) passGate();
      else {
        // gate is locked: bounce off it, go back down and collect the missed coins
        B.y = sec.finishY + 12 + R; B.vy = 160;
        if (w.time - (w.lockMsgT || -9) > 1.5) {
          w.lockMsgT = w.time; SFX.locked(); w.shake = 6; vibrate(80);
          hudMsg('ناقصك ' + (sec.need - sec.got) + ' كوينز.. انزل هاتهم! ⬇', 2.2);
        }
      }
    }
  } else if (w.result === 'win') {
    B.vy += (-300 - B.vy) * Math.min(1, dt * 3); B.y += B.vy * dt; B.boost = true;
    B.p = Math.max(0, B.p - dt);
    if (Math.random() < 0.3) burst(w, 30 + Math.random() * 340, w.camY + 40, CONFETTI, 1, 60, true);
  }

  // camera follows up and down, but never below the start of the current level
  const camFloor = w.sections[w.cur].startY - H * 0.72;
  const target = Math.min(B.y - H * 0.55, camFloor);
  w.camY += (target - w.camY) * Math.min(1, dt * 6);

  for (const p of w.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += (p.sq ? 260 : 420) * dt; p.vx *= 0.98; p.life -= dt; p.r += p.vr * dt; }
  w.parts = w.parts.filter(p => p.life > 0);
  for (const t of w.texts) { t.y -= 40 * dt; t.life -= dt * 1.3; }
  w.texts = w.texts.filter(t => t.life > 0);
  if (w.shake > 0) w.shake = Math.max(0, w.shake - dt * 30);
  if (w.flash > 0) w.flash -= dt * 2;

  if (w.result) {
    w.endTimer -= dt;
    if (w.endTimer <= 0) {
      const r = w.result; w.result = 'done';
      if (NET.on) { if (r === 'win') netFinish(); else vsRespawn(); }
      else if (r === 'win') showVictory(); else showLose(r);
    }
  }
}

function passGate() {
  const w = world, sec = w.sections[w.cur], i = w.cur;
  const ratio = sec.got / sec.total;
  const stars = ratio >= 0.95 ? 3 : ratio >= 0.82 ? 2 : 1;
  if (!NET.on) {
    save.stars[i] = Math.max(save.stars[i], stars);
    save.bank += sec.got;
    save.unlocked = Math.max(save.unlocked, Math.min(NUM, i + 2));
    persist();
  }
  for (let k = 0; k < 4; k++) burst(w, 60 + k * 90, sec.finishY, CONFETTI, 16, 300, true);
  floatText(w, 200, sec.finishY - 70, '★'.repeat(stars), '#f7c531');
  vibrate(50);
  if (i === NUM - 1) {
    if (NET.on) { NET.fin = true; sendState(); }
    w.result = 'win'; w.endTimer = 1.8; SFX.win();
    w.flash = 0.4; w.flashColor = '#ffffff';
    return;
  }
  SFX.win();
  w.cur = i + 1; w.mul = w.sections[w.cur].mul;
  w.storm = makeStorm(w.sections[w.cur]);
  showBanner(w.cur);
  updateHud(true);
}

function burstBalloon(reason) {
  const w = world, B = w.B;
  B.alive = false; w.result = reason; w.endTimer = 1.2;
  SFX.pop(); vibrate([80, 40, 120]);
  w.shake = 14; w.flash = 0.6; w.flashColor = '#ff4a4f';
  burst(w, B.x, B.y, ['#e8202a', '#b5121b', '#ff6b70'], 18, 300, true);
  burst(w, B.x, B.y, ['#ffffff'], 10, 200);
  w.parts.push({ x: B.x, y: B.y + 30, vx: 0, vy: 0, life: 1.2, max: 1.2, c: '#a8662c', size: 12, sq: true, r: 0, vr: 2 });
  if (reason === 'over') hudMsg('نفختها زيادة! 💥', 1.5);
}
function onHit() {
  const w = world, B = w.B;
  if (B.inv > 0) return;
  if (B.shield) {
    B.shield = false; B.inv = 1.4; SFX.shieldBreak(); vibrate(60);
    burst(w, B.x, B.y, ['#7fdcff', '#ffffff'], 18, 220); w.shake = 8;
    floatText(w, B.x, B.y - 40, 'الدرع اتكسر!', '#2a8fbf');
    return;
  }
  burstBalloon('pop');
}

/* ---------------- HUD ---------------- */
let lastHud = '';
function updateHud(force) {
  const w = world, B = w.B, sec = w.sections[w.cur];
  const m = Math.max(0, Math.floor(-B.y / 10));
  const pr = clamp((sec.startY - B.y) / (sec.startY - sec.finishY), 0, 1);
  const pBar = $('hudPress');
  pBar.style.width = (B.p * 100).toFixed(1) + '%';
  pBar.className = B.p > 0.75 ? 'danger' : B.p > 0.5 ? 'warn' : '';
  $('hudLP').style.width = (pr * 100).toFixed(1) + '%';
  const key = m + '|' + sec.got + '|' + w.cur;
  if (!force && key === lastHud) return;
  lastHud = key;
  $('hudM').textContent = m + ' m';
  $('hudC').textContent = sec.got + '/' + sec.need;
  $('hudC').parentElement.classList.toggle('ok', sec.got >= sec.need);
  $('hudL').textContent = 'ليفل ' + (w.cur + 1) + ' / ' + NUM;
}
let msgTimer = null;
function hudMsg(s, sec) {
  const el = $('hudMsg'); el.textContent = s; el.classList.add('on');
  clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('on'), sec * 1000);
}
let bannerTimer = null;
function showBanner(idx) {
  // tiny, see-through celebration: just the level number, gone in ~2s
  const el = $('banner');
  const tr = TRAPS[idx];
  const sub = idx === 5 ? '⚡ عاصفة طالعة وراك!' : idx > 0 ? tr.icon + ' ' + tr.name : '';
  el.innerHTML = `<div class="b-big">${idx === 0 ? '' : '🎉 '}ليفل ${idx + 1}</div>${sub ? `<div class="b-sub">${sub}</div>` : ''}`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

/* ---------------- online: real-time 1v1 + spectators (WebSocket to the PALON server) ---------------- */
const NET = { on: false, started: false, fin: false, done: false, code: null, kind: null, oppName: 'الخصم', opp: null,
              startAt: 0, lastCount: null, watchers: 0, sendTimer: 0, g: null };
const SPEC = { on: false, code: null, names: ['', ''], st: [null, null], g: [null, null], follow: 0, startAt: 0, over: false, listTimer: 0 };
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function savedName() { try { return localStorage.getItem('palon_name') || ''; } catch (e) { return ''; } }
function vsErr(t) { const el = $('vsErr'); if (el) el.textContent = t; }

let sock = null, sockReady = null;
function wsConnect() {
  if (sock && sock.readyState === 1) return Promise.resolve(sock);
  if (sockReady) return sockReady;
  sockReady = new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
    catch (e) { sockReady = null; reject(e); return; }
    const to = setTimeout(() => { try { ws.close(); } catch (e) {} }, 8000);
    ws.onopen = () => { clearTimeout(to); sock = ws; sockReady = null; resolve(ws); };
    ws.onerror = () => {};
    ws.onclose = () => { clearTimeout(to); if (sock === ws) sock = null; if (sockReady) { sockReady = null; reject(new Error('closed')); } onSocketClosed(); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } onMsg(m); };
  });
  return sockReady;
}
function wsSend(m) { if (sock && sock.readyState === 1) sock.send(JSON.stringify(m)); }
function onSocketClosed() {
  if (NET.on && !NET.done) { NET.done = true; stopRace(); showVsResult(false, 'gone'); }
  if (SPEC.on) { stopSpectate(); showSpecList('انقطع الاتصال'); }
}

/* ---- opponent / spectated balloons: replayed from their own recording (smooth, same tilt & size) ---- */
function makeGhost() { return { buf: [], lat: [], clockOffT: undefined, delay: undefined, delayT: 120, od: null }; }
function ghostSample(G, o, recv) {
  const buf = G.buf, last = buf[buf.length - 1];
  if (last && o.ct <= last.t) return;
  if (last && (o.lvl !== last.lvl || Math.abs(o.y - last.y) > 600)) buf.length = 0; // respawn / new level
  buf.push({ lvl: o.lvl, t: o.ct, x: o.x, y: o.y, p: o.p, tl: o.tl, k: o.k, alive: o.alive, vx: o.vx, vy: o.vy });
  while (buf.length > 2 && buf[0].t < o.ct - 3000) buf.shift();
  const off = recv - o.ct;
  G.lat.push({ at: recv, off });
  while (G.lat.length && G.lat[0].at < recv - 5000) G.lat.shift();
  let mn = Infinity; for (const l of G.lat) if (l.off < mn) mn = l.off;
  G.clockOffT = mn;
  const j = G.lat.map(l => l.off - mn).sort((a, b) => a - b);
  G.delayT = clamp(j[Math.floor((j.length - 1) * 0.95)] + 30, 40, 450);
}
function ghostFrame(G, dt) {
  const buf = G.buf;
  if (!buf.length || G.clockOffT === undefined) return;
  const target = G.clockOffT + G.delayT;
  if (G.delay === undefined || Math.abs(target - G.delay) > 300) G.delay = target;
  else G.delay += clamp(target - G.delay, -dt * 100, dt * 100);
  const ts = performance.now() - G.delay;
  let a = buf[0], b = null;
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= ts) { a = buf[i]; b = buf[i + 1] || null; break; }
  let st;
  if (b) {
    const u = clamp((ts - a.t) / Math.max(1, b.t - a.t), 0, 1);
    st = { x: lerp(a.x, b.x, u), y: lerp(a.y, b.y, u), p: lerp(a.p, b.p, u), tl: lerp(a.tl, b.tl, u), k: a.k, alive: a.alive && b.alive, lvl: a.lvl };
  } else {
    const ex = clamp((ts - a.t) / 1000, 0, 0.25);
    st = { x: a.x + (a.alive ? a.vx * ex : 0), y: a.y + (a.alive ? a.vy * ex : 0), p: a.p, tl: a.tl, k: a.k, alive: a.alive, lvl: a.lvl };
  }
  const od = G.od;
  if (od && od.alive && st.alive && Math.abs(od.y - st.y) < 300) {
    const k = Math.min(1, dt * 22);
    st.x = od.x + (st.x - od.x) * k; st.y = od.y + (st.y - od.y) * k; st.tl = od.tl + (st.tl - od.tl) * k; st.p = od.p + (st.p - od.p) * k;
  }
  G.od = st;
}

/* ---- messages from the server ---- */
function onMsg(m) {
  switch (m.t) {
    case 'room': NET.code = m.code; if (!NET.started) showWaiting(); break;
    case 'err':
      if (state === 'speclist' || SPEC.on) { stopSpectate(); showSpecList('الماتش ده خلص أو مش موجود'); }
      else { NET.on = false; vsErr(m.err === 'nocode' ? 'الكود ده مش موجود' : m.err === 'full' ? 'الأوضة دي مليانة أو اللعب بدأ' : 'حصل خطأ، جرّب تاني'); }
      break;
    case 'start': {
      NET.started = true; NET.oppName = m.opp || 'الخصم'; NET.startAt = performance.now() + m.in; NET.lastCount = null;
      world = buildTower(); resetTo(world, 0); world.live = false;
      hideOverlay(); state = 'vscount';
      $('hud').classList.remove('hidden'); $('controls').classList.remove('hidden');
      updateHud(true); updateOppHud();
      clearInterval(NET.sendTimer); NET.sendTimer = setInterval(sendState, 50);
      break;
    }
    case 'opp': if (NET.on) { NET.opp = m; ghostSample(NET.g, m, performance.now()); updateOppHud(); } break;
    case 'watchers': NET.watchers = m.n; updateOppHud(); break;
    case 'over':
      if (NET.on && !NET.done) { NET.done = true; stopRace(); showVsResult(m.won, m.reason); }
      break;
    case 'list': if (state === 'speclist') renderSpecList(m.matches); break;
    case 'winfo':
      if (!SPEC.on || m.code !== SPEC.code) break;
      SPEC.names = m.names; SPEC.startAt = performance.now() - m.since; SPEC.watchers = m.watchers;
      updateSpecBar();
      break;
    case 'w':
      if (!SPEC.on) break;
      SPEC.st[m.i] = m; ghostSample(SPEC.g[m.i], m, performance.now());
      updateSpecBar();
      break;
    case 'wover':
      if (!SPEC.on || SPEC.over) break;
      SPEC.over = true; SPEC.winner = m.winner;
      updateSpecBar();
      showOverlay(`<h2>🏆 ${esc(m.winnerName)} كسب!</h2>
        <p>${m.reason === 'left' ? 'الخصم التاني خرج من الماتش.' : 'وصل ليفل ' + NUM + ' الأول.'}</p>
        <button class="btn" style="background:#1f5fd1" data-act="spec">👀 ماتشات تانية</button>
        <button class="btn ghost" data-act="menu">القائمة</button>`);
      overlay.classList.add('clear');
      SFX.win();
      break;
  }
}

/* ---- racing ---- */
function sendState() {
  if (!NET.on || !NET.started || NET.done) return;
  const B = world.B;
  wsSend({ t: 'st', lvl: world.cur, x: Math.round(B.x * 10) / 10, y: Math.round(B.y * 10) / 10, p: Math.round(B.p * 1000) / 1000,
    tl: Math.round(B.tilt * 1000) / 1000, k: (input.up ? 1 : 0) | (input.down ? 2 : 0) | (input.left ? 4 : 0) | (input.right ? 8 : 0),
    alive: !!B.alive, vx: Math.round(B.vx), vy: Math.round(B.alive ? B.vy : 0), ct: Math.round(performance.now()),
    m: Math.max(0, Math.floor(-B.y / 10)), fin: NET.fin });
}
async function showVsLobby() {
  state = 'vslobby'; hideGameUI();
  showOverlay(`<h2>⚔️ ضد خصم أونلاين</h2>
    <p class="small">انتو الاتنين بتطلعوا في نفس البرج. أول واحد يوصل ليفل ${NUM} يكسب.<br>لو فرقعت بترجع لأول الليفل اللي انت فيه.</p>
    <input id="vsName" class="inp" maxlength="14" placeholder="اكتب اسمك" value="${esc(savedName())}">
    <button class="btn" style="background:#1f5fd1" data-act="vsquick">🔎 دوّر على خصم</button>
    <button class="btn" data-act="vscreate">🏠 اعمل أوضة بكود لصاحبك</button>
    <div class="row" style="align-items:center"><input id="vsCode" class="inp" inputmode="numeric" maxlength="4" placeholder="عندك كود؟"><button class="btn green" style="flex:0 0 38%" data-act="vsjoin">ادخل</button></div>
    <p id="vsErr" class="small" style="color:#e8202a;opacity:1;min-height:18px"></p>
    <button class="btn ghost" data-act="menu">رجوع</button>`);
  try { await wsConnect(); } catch (e) { vsErr('مش قادر أوصل للسيرفر الأونلاين.'); }
}
async function vsStart(kind) {
  const name = (($('vsName') || {}).value || '').trim().slice(0, 14) || 'لاعب';
  try { localStorage.setItem('palon_name', name); } catch (e) {}
  const code = (($('vsCode') || {}).value || '').trim();
  if (kind === 'join' && !/^\d{4}$/.test(code)) { vsErr('اكتب الكود (4 أرقام)'); return; }
  vsErr('...');
  try { await wsConnect(); } catch (e) { vsErr('مش قادر أوصل للسيرفر الأونلاين.'); return; }
  stopSpectate();
  Object.assign(NET, { on: true, started: false, fin: false, done: false, code: null, kind, oppName: 'الخصم', opp: null, watchers: 0, g: makeGhost(), lastCount: null });
  wsSend({ t: kind, name, code });
}
function showWaiting() {
  state = 'vswait';
  showOverlay(`<h2>مستني خصم... ⏳</h2>
    ${NET.kind === 'quick' ? '<p>بدوّرلك على حد يلعب ضدك.<br>خلّي صاحبك يدوس "دوّر على خصم" في نفس الوقت.</p>' : `<p>ابعت الكود ده لصاحبك:</p><div class="code">${NET.code}</div>`}
    <div class="spinner"></div>
    <button class="btn ghost" data-act="vscancel">إلغاء</button>`);
}
function updateOppHud() {
  const el = $('hudOpp');
  if (!NET.on || !NET.started) { el.classList.add('hidden'); return; }
  const o = NET.opp, mine = world.cur;
  let t = '🆚 ' + NET.oppName, ahead = false;
  if (o) { ahead = o.lvl > mine || (o.lvl === mine && o.y < world.B.y); t += ': ليفل ' + (o.lvl + 1) + (ahead ? ' ⬆' : ' ⬇'); }
  if (NET.watchers) t += '  👀' + NET.watchers;
  el.textContent = t;
  el.classList.toggle('ahead', ahead);
  el.classList.remove('hidden');
}
function stopRace() {
  clearInterval(NET.sendTimer); NET.on = false; NET.started = false; NET.opp = null;
  const el = $('hudOpp'); if (el) el.classList.add('hidden');
}
function netStop(sendLeave) {
  if (sendLeave && (NET.on || SPEC.on)) wsSend({ t: 'leave' });
  stopRace(); stopSpectate();
}
function vsRespawn() {
  const cur = world.cur;
  world = buildTower(); resetTo(world, cur); world.live = true;
  state = 'play'; updateHud(true);
  hudMsg('💥 رجعت لأول ليفل ' + (cur + 1), 1.6);
}
function netFinish() {
  if (NET.done || !NET.on) return;
  NET.fin = true; sendState();
  state = 'vsfin'; world.live = false; hideGameUI();
  showOverlay('<h2>وصلت للآخر! ⏳</h2><p>بنتأكد مين وصل الأول...</p><div class="spinner"></div>');
}
function showVsResult(won, reason) {
  state = 'vsresult'; hideGameUI(); world.live = false;
  const n = esc(NET.oppName);
  let h;
  if (won) h = reason === 'left' ? `<h2>🏆 كسبت!</h2><p>${n} خرج من اللعبة.</p>` : `<h2>🏆 كسبت السباق!</h2><p>وصلت ليفل ${NUM} قبل ${n} 🎉</p>`;
  else if (reason === 'quit') h = '<h2>🏳️ انسحبت</h2><p>الخصم كسب المرة دي.</p>';
  else if (reason === 'gone') h = '<h2>الاتصال اتقطع 📶</h2><p>اتأكد من النت وجرّب تاني.</p>';
  else h = `<h2>😢 خسرت</h2><p>${n} وصل ليفل ${NUM} الأول.<br>انت كنت في ليفل ${world.cur + 1}.</p>`;
  if (won) { SFX.win(); for (let k = 0; k < 5; k++) burst(world, 40 + k * 80, world.camY + 200, CONFETTI, 14, 280, true); }
  else if (reason !== 'quit') SFX.lose();
  showOverlay(h + `<button class="btn" style="background:#1f5fd1" data-act="vs">⚔️ العب تاني</button><button class="btn ghost" data-act="menu">القائمة</button>`);
}
function countBanner(t) {
  const el = $('banner');
  el.innerHTML = `<div class="b-big" style="font-size:64px">${t}</div>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(bannerTimer); bannerTimer = setTimeout(() => el.classList.remove('on'), 800);
}

/* ---- spectators ---- */
async function showSpecList(msg) {
  stopSpectate();
  state = 'speclist'; hideGameUI();
  showOverlay(`<h2>👀 اتفرج على ماتش</h2>
    <p class="small">الماتشات اللي شغالة دلوقتي</p>
    <div id="specList" class="spec-list"><div class="spinner"></div></div>
    <p id="vsErr" class="small" style="color:#e8202a;opacity:1;min-height:18px">${msg ? esc(msg) : ''}</p>
    <button class="btn ghost" data-act="menu">رجوع</button>`);
  try { await wsConnect(); } catch (e) { vsErr('مش قادر أوصل للسيرفر الأونلاين.'); return; }
  const ask = () => { if (state === 'speclist') { wsSend({ t: 'list' }); SPEC.listTimer = setTimeout(ask, 2000); } };
  clearTimeout(SPEC.listTimer); ask();
}
function renderSpecList(list) {
  const el = $('specList'); if (!el) return;
  if (!list.length) { el.innerHTML = '<p>مفيش ماتشات شغالة دلوقتي 😴<br><span class="small">أول ما حد يبدأ ماتش هيظهر هنا</span></p>'; return; }
  el.innerHTML = list.map(m => {
    const done = m.status === 'over';
    const who = done ? '🏆 ' + esc(m.names[m.winner] || '') + ' كسب' : m.status === 'countdown' ? 'بيبدأ دلوقتي...' : `ليفل ${m.lvls[0] + 1} ضد ليفل ${m.lvls[1] + 1}`;
    return `<button class="spec-item${done ? ' done' : ''}" data-act="specwatch" data-code="${m.code}">
      <b><span class="dot red"></span>${esc(m.names[0])} <span class="vs">ضد</span> <span class="dot blue"></span>${esc(m.names[1])}</b>
      <small>${who} • 👀 ${m.watchers}</small></button>`;
  }).join('');
}
async function startSpectate(code) {
  try { await wsConnect(); } catch (e) { vsErr('مش قادر أوصل للسيرفر الأونلاين.'); return; }
  clearTimeout(SPEC.listTimer);
  Object.assign(SPEC, { on: true, code, names: ['', ''], st: [null, null], g: [makeGhost(), makeGhost()], follow: -1, startAt: performance.now(), over: false, winner: null, watchers: 0 });
  world = buildTower(); resetTo(world, 0); world.live = false; world.B.alive = false; world.storm = null;
  state = 'spec'; hideOverlay(); hideGameUI();
  $('specBar').classList.remove('hidden');
  wsSend({ t: 'watch', code });
  updateSpecBar();
}
function stopSpectate() {
  clearTimeout(SPEC.listTimer);
  if (!SPEC.on) return;
  SPEC.on = false;
  $('specBar').classList.add('hidden');
}
function updateSpecBar() {
  if (!SPEC.on) return;
  for (let i = 0; i < 2; i++) {
    const st = SPEC.st[i], el = $('spec' + i);
    const lv = st ? st.lvl + 1 : 1;
    el.innerHTML = `<span class="dot ${i ? 'blue' : 'red'}"></span>${esc(SPEC.names[i] || '...')} <small>ليفل ${lv}</small>${SPEC.over && SPEC.winner === i ? ' 🏆' : ''}`;
    el.classList.toggle('on', specFollowIdx() === i);
    $('specP' + i).style.width = (st ? clamp(st.lvl / NUM + clamp((world.sections[st.lvl].startY - st.y) / (world.sections[st.lvl].startY - world.sections[st.lvl].finishY), 0, 1) / NUM, 0, 1) * 100 : 0) + '%';
  }
  $('specW').textContent = '👀 ' + (SPEC.watchers || 1);
}
function specFollowIdx() {
  if (SPEC.follow >= 0) return SPEC.follow;
  const a = SPEC.g[0] && SPEC.g[0].od, b = SPEC.g[1] && SPEC.g[1].od;
  if (a && b) return a.y <= b.y ? 0 : 1; // auto: follow whoever is higher
  return b && !a ? 1 : 0;
}
function specFrame(dt) {
  const w = world;
  w.time = (performance.now() - SPEC.startAt) / 1000;
  for (const o of w.obs) { const b = o.bb; if (b && (b[3] < w.camY - 120 || b[1] > w.camY + H + 120)) continue; if (o.type !== 'icicle' && o.type !== 'cannon' && o.type !== 'mine') updObs(o, dt, w); }
  for (let i = 0; i < 2; i++) if (SPEC.g[i]) ghostFrame(SPEC.g[i], dt);
  const f = SPEC.g[specFollowIdx()];
  if (f && f.od) {
    const target = Math.min(f.od.y - H * 0.55, -H * 0.72 + 0);
    w.camY += (target - w.camY) * Math.min(1, dt * 4);
    w.cur = clamp(f.od.lvl | 0, 0, NUM - 1);
  }
  for (const p of w.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
  w.parts = w.parts.filter(p => p.life > 0);
}

/* ---------------- overlays ---------------- */
const overlay = $('overlay');
function showOverlay(html) {
  overlay.innerHTML = '<div class="card">' + html + '</div>';
  overlay.classList.add('on'); overlay.classList.remove('clear');
}
function hideOverlay() { overlay.classList.remove('on'); overlay.innerHTML = ''; }
function hideGameUI() {
  { const el = $('hudOpp'); if (el) el.classList.add('hidden'); }
  $('hud').classList.add('hidden'); $('controls').classList.add('hidden'); clearInput();
  $('banner').classList.remove('on');
}
const coinSpan = '<span class="coin-ic" style="width:18px;height:18px;vertical-align:middle"></span>';
function starsHtml(n) { let s = ''; for (let i = 0; i < 3; i++) s += i < n ? '★' : '<span class="off">★</span>'; return s; }

function idleWorld() { world = buildTower(); resetTo(world, Math.min(save.unlocked, NUM) - 1); }

function showMenu() {
  state = 'menu'; hideGameUI();
  const totalStars = save.stars.reduce((a, b) => a + b, 0);
  const cont = save.unlocked > 1 ? `<button class="btn green" data-act="cont">كمّل من ليفل ${save.unlocked} ▶</button>` : '';
  showOverlay(`
    <div class="title">PALON</div>
    <div class="subtitle">طلّع البلونة ${NUM} ليفل لفوق.. من غير ما تفرقع! 🎈</div>
    <div class="row" style="justify-content:center;gap:8px;margin-bottom:6px">
      <span class="bank">${coinSpan} ${save.bank}</span>
      <span class="bank" style="color:#c98a00">★ ${totalStars}/${NUM * 3}</span>
    </div>
    <button class="btn red" data-act="solo">🎈 لعب سولو</button>
    <button class="btn" style="background:#1f5fd1" data-act="vs">⚔️ العب ضد خصم أونلاين</button>
    <button class="btn" style="background:#7a5bd1" data-act="spec">👀 اتفرج على ماتش</button>
    <div class="row">
      <button class="btn ghost" data-act="how">إزاي ألعب؟</button>
      <button class="btn ghost" data-act="mute">${save.muted ? '🔇 الصوت' : '🔊 الصوت'}</button>
    </div>
    <p class="small">نسخة 24</p>`);
}
function showSolo() {
  state = 'solo';
  const cont = save.unlocked > 1 ? `<button class="btn green" data-act="cont">كمّل من ليفل ${save.unlocked} ▶</button>` : '';
  showOverlay(`<h2>🎈 لعب سولو</h2>
    ${cont}
    <button class="btn red" data-act="new">${save.unlocked > 1 ? 'ابدأ من الأول' : 'العب ▶'}</button>
    <button class="btn" data-act="levels">ابدأ من ليفل...</button>
    <button class="btn ghost" data-act="menu">رجوع</button>`);
}
function showLevels() {
  state = 'levels';
  let g = '';
  for (let i = 1; i <= NUM; i++) {
    const locked = i > save.unlocked, st = save.stars[i - 1];
    g += `<button class="lv ${locked ? 'locked' : st ? 'done' : ''}" ${locked ? '' : `data-act="lvl" data-n="${i}"`}>
      ${locked ? '🔒' : i}<small>${locked ? '' : '★'.repeat(st) || '&nbsp;'}</small></button>`;
  }
  showOverlay(`<h2>تبدأ منين؟</h2><div class="grid">${g}</div>
    <p class="small">الليفلات كلها ورا بعض في نفس الطلعة. اختار ليفل وصلتله عشان تكمّل منه.</p>
    <button class="btn ghost" data-act="menu">رجوع</button>`);
}
function showHow() {
  showOverlay(`<h2>إزاي ألعب؟</h2>
    <ul class="how">
      <li>🎈 لو مش بتنفخ البلونة بتنزل لتحت، فتقدر ترجع تجيب الكوينز اللي فاتتك.</li>
      <li>⏫ الزرار الكبير اليمين = نفخ: البلونة <b>بتكبر وتطلع أسرع</b>.</li>
      <li>⚠️ الشريط اللي فوق على الشمال هو <b>عدّاد النفخ</b>. لو اتملى للآخر البلونة <b>بتفرقع</b>! سيب الزرار شوية عشان يفضى.</li>
      <li>⏬ الزرار البرتقالي تحت زرار النفخ = يفسّي البلونة وينزّلها بسرعة.</li>
      <li>◀ ▶ الأزرار الشمال = يمين وشمال.</li>
      <li>👍 أو بصباع واحد: امسك زرار النفخ وزحلق صباعك شمال أو يمين عشان توجّه البلونة.</li>
      <li>⚙️ المسار الحديد بتعدّي منه عادي، المنشار اللي ماشي عليه هو اللي بيفرقعك.</li>
      <li>${coinSpan} في آخر كل ليفل بوابة.. لازم تجمع عدد الكوينز المكتوب عشان تفتح وتطلع على الليفل اللي بعده على طول.</li>
      <li>⚡ من ليفل 6 فيه عاصفة طالعة من تحت ورا البلونة.. لو لحقتك بتفرقع!</li>
      <li>🛡️ الدرع بيحميك من خبطة، و🧲 المغناطيس بيشد الكوينز.</li>
      <li>💻 كمبيوتر: <span class="kbd">← →</span> / <span class="kbd">A D</span> حركة، <span class="kbd">Space</span> / <span class="kbd">↑</span> نفخ، <span class="kbd">↓</span> / <span class="kbd">S</span> تفسية، <span class="kbd">P</span> إيقاف.</li>
    </ul>
    <button class="btn" data-act="menu">تمام 👍</button>`);
}
function showLose(reason) {
  state = 'lose'; hideGameUI(); SFX.lose();
  const w = world, sec = w.sections[w.cur], lv = w.cur + 1;
  const pr = clamp((sec.startY - w.B.y) / (sec.startY - sec.finishY), 0, 1);
  let msg;
  if (reason === 'coins') msg = `<h2>البوابة مقفولة 🔒</h2><p>محتاج <b>${sec.need}</b> كوينز وانت جمعت <b>${sec.got}</b> بس.</p>`;
  else if (reason === 'over') msg = `<h2>نفختها زيادة! 💥</h2><p>عدّاد النفخ اتملى والبلونة فرقعت.<br>سيب زرار النفخ قبل ما الشريط يحمرّ.</p>`;
  else if (reason === 'storm') msg = `<h2>العاصفة لحقتك! ⚡</h2><p>من ليفل 6 فيه عاصفة طالعة من تحت.. متتأخرش!</p>`;
  else msg = `<h2>البلونة فرقعت! 💥</h2>`;
  showOverlay(`${msg}
    <p class="small">ليفل ${lv} • وصلت ${Math.round(pr * 100)}% منه</p>
    <div class="prog" style="width:100%;height:14px;margin:8px 0"><div style="height:100%;width:${pr * 100}%;background:linear-gradient(90deg,#3fd06b,#a6f05a)"></div></div>
    <button class="btn red" data-act="retry">↻ حاول تاني من ليفل ${lv}</button>
    <div class="row"><button class="btn ghost" data-act="new">من الأول</button><button class="btn ghost" data-act="menu">القائمة</button></div>`);
}
function showVictory() {
  state = 'victory'; hideGameUI();
  const totalStars = save.stars.reduce((a, b) => a + b, 0);
  showOverlay(`
    <div class="title" style="font-size:40px">🏆 بطل 🏆</div>
    <h2>طلعت الـ ${NUM} ليفل!</h2>
    <p>البلونة وصلت للسما من غير ما تفرقع 🎈✨</p>
    <div class="stars">★ ${totalStars}/${NUM * 3}</div>
    <p class="small">حاول تجمع 3 نجوم في كل ليفل!</p>
    <button class="btn green" data-act="new">العب تاني</button>
    <button class="btn ghost" data-act="menu">القائمة</button>`);
}
function showPause() {
  if (state !== 'play') return;
  if (NET.on) {
    state = 'paused'; clearInput();
    showOverlay(`<h2>⏸ وقفت</h2><p>خد بالك: الخصم لسه بيلعب!</p>
      <button class="btn green" data-act="resume">▶ كمّل</button>
      <button class="btn ghost" data-act="vsquit">🏳️ انسحب</button>`);
    return;
  }
  state = 'paused'; clearInput();
  showOverlay(`<h2>إيقاف مؤقت ⏸</h2>
    <button class="btn green" data-act="resume">▶ كمّل</button>
    <button class="btn" data-act="retry">↻ ابدأ ليفل ${world.cur + 1} من الأول</button>
    <div class="row"><button class="btn ghost" data-act="mute">${save.muted ? '🔇' : '🔊'}</button><button class="btn ghost" data-act="menu">القائمة</button></div>`);
}

overlay.addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  audio(); SFX.click();
  const a = b.dataset.act;
  if (a === 'new') startRun(0);
  else if (a === 'cont') startRun(Math.min(save.unlocked, NUM) - 1);
  else if (a === 'levels') showLevels();
  else if (a === 'how') showHow();
  else if (a === 'menu') { netStop(true); idleWorld(); showMenu(); }
  else if (a === 'solo') showSolo();
  else if (a === 'vs') showVsLobby();
  else if (a === 'vsquick') vsStart('quick');
  else if (a === 'vscreate') vsStart('create');
  else if (a === 'vsjoin') vsStart('join');
  else if (a === 'vscancel') { netStop(true); showVsLobby(); }
  else if (a === 'spec') showSpecList();
  else if (a === 'specwatch') startSpectate(b.dataset.code);
  else if (a === 'vsquit') { netStop(true); idleWorld(); showVsResult(false, 'quit'); }
  else if (a === 'lvl') startRun(+b.dataset.n - 1);
  else if (a === 'retry') startRun(world.cur);
  else if (a === 'resume') { hideOverlay(); state = 'play'; }
  else if (a === 'mute') { save.muted = !save.muted; persist(); if (state === 'paused') { state = 'play'; showPause(); } else showMenu(); }
});

/* ---------------- input ---------------- */
function clearInput() {
  input.left = input.right = input.up = input.down = false;
  document.querySelectorAll('.ctl.pressed').forEach(b => b.classList.remove('pressed'));
}
// Mouse: classic hold per button.
function bindHold(id, key) {
  const el = $(id); const ptrs = new Set();
  const set = () => { input[key] = ptrs.size > 0; el.classList.toggle('pressed', ptrs.size > 0); };
  el.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') return; e.preventDefault(); audio(); ptrs.add(e.pointerId); try { el.setPointerCapture(e.pointerId); } catch (_) {} set(); });
  const up = e => { if (e.pointerType === 'touch') return; ptrs.delete(e.pointerId); set(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
bindHold('btnL', 'left'); bindHold('btnR', 'right'); bindHold('btnU', 'up'); bindHold('btnD', 'down');

// Touch: every finger is checked against every button on each touch event, so holding
// inflate with one thumb and left/right with the other always works the same on both sides
// (and you can slide a finger from one button to the next).
const CTL = [['btnU', 'up'], ['btnD', 'down'], ['btnL', 'left'], ['btnR', 'right']];
// Big touch zones instead of exact button circles, so a thumb that lands a bit off
// still counts every time:
//   bottom half, left side  -> left / right (split between the two buttons)
//   bottom half, right side -> inflate (upper part) / deflate (lower part)
// A finger that starts on inflate and slides sideways also steers.
const upTouches = new Map();
function zoneOf(t, rc) {
  const a = rc.app;
  if (t.clientY < a.top + a.height * 0.45) return null;
  if (t.clientX < a.left + a.width / 2) return t.clientX < (rc.L.right + rc.R.left) / 2 ? 'left' : 'right';
  return t.clientY < (rc.U.bottom + rc.D.top) / 2 ? 'up' : 'down';
}
function touchControls(e) {
  if (state !== 'play') { upTouches.clear(); return; }
  const rc = { app: app.getBoundingClientRect(), U: $('btnU').getBoundingClientRect(), D: $('btnD').getBoundingClientRect(),
               L: $('btnL').getBoundingClientRect(), R: $('btnR').getBoundingClientRect() };
  const st = { left: false, right: false, up: false, down: false };
  let onCtl = false, slide = 0;
  const alive = new Set();
  for (const t of e.touches) {
    alive.add(t.identifier);
    if (upTouches.has(t.identifier)) {
      st.up = true; onCtl = true;
      const dx = t.clientX - upTouches.get(t.identifier);
      if (dx < -22) slide = -1; else if (dx > 22) slide = 1;
      continue;
    }
    const z = zoneOf(t, rc);
    if (!z) continue;
    onCtl = true; st[z] = true;
    if (z === 'up') upTouches.set(t.identifier, t.clientX);
  }
  for (const id of [...upTouches.keys()]) if (!alive.has(id)) upTouches.delete(id);
  // the left/right buttons always win over thumb-slide steering
  if (!st.left && !st.right) { if (slide < 0) st.left = true; else if (slide > 0) st.right = true; }
  if (onCtl && e.cancelable) { e.preventDefault(); audio(); }
  for (const [id, key] of CTL) { input[key] = st[key]; $(id).classList.toggle('pressed', st[key]); }
}
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(t => document.addEventListener(t, touchControls, { passive: false }));
$('pauseBtn').addEventListener('click', () => { audio(); showPause(); });
$('spec0').addEventListener('click', () => { SPEC.follow = SPEC.follow === 0 ? -1 : 0; updateSpecBar(); });
$('spec1').addEventListener('click', () => { SPEC.follow = SPEC.follow === 1 ? -1 : 1; updateSpecBar(); });
$('specExit').addEventListener('click', () => { audio(); SFX.click(); wsSend({ t: 'leave' }); showSpecList(); });

const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down' };
window.addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  audio();
  const k = KEYS[e.code];
  if (k) { if (state === 'play') input[k] = true; e.preventDefault(); return; }
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state === 'play') showPause(); else if (state === 'paused') { hideOverlay(); state = 'play'; }
  }
  if (e.code === 'Enter' && !(e.target && e.target.tagName === 'INPUT')) { const b = overlay.querySelector('.btn'); if (b) b.click(); }
});
window.addEventListener('keyup', e => { const k = KEYS[e.code]; if (k) input[k] = false; });
window.addEventListener('blur', () => { clearInput(); if (state === 'play') showPause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') showPause(); });
document.addEventListener('touchmove', e => { if (!e.target.closest || !e.target.closest('.card')) e.preventDefault(); }, { passive: false });

/* ---------------- main loop ---------------- */
let last = performance.now(), T = 0;
function frame(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000); last = now; T += dt;
  if (NET.on && NET.g) ghostFrame(NET.g, dt);
  if (state === 'vscount') {
    world.time = (performance.now() - NET.startAt) / 1000;
    const left = Math.ceil((NET.startAt - performance.now()) / 1000);
    if (left !== NET.lastCount) { NET.lastCount = left; if (left > 0) { countBanner(String(left)); tone(520, 0.12, 'triangle', 0.1); } }
    if (left <= 0) { state = 'play'; world.live = true; countBanner('يلا! 🎈'); tone(880, 0.25, 'triangle', 0.12); }
  }
  if (state === 'spec') specFrame(dt);
  else if (state === 'play') {
    update(dt);
    if (NET.on && NET.started) world.time = (performance.now() - NET.startAt) / 1000; // same trap timing on both phones
    updateHud();
  } else if (state !== 'paused' && state !== 'vsresult' && state !== 'vsfin') {
    const w = world;
    w.time += dt;
    for (const o of w.obs) { const b = o.bb; if (b && (b[3] < w.camY - 100 || b[1] > w.camY + H + 100)) continue; if (o.type !== 'icicle' && o.type !== 'cannon') updObs(o, dt, w); }
    if (!w.result) { w.B.y = w.sections[w.cur].startY + Math.sin(T * 2) * 6; w.B.tilt = Math.sin(T * 1.3) * 0.05; }
    for (const p of w.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 300 * dt; p.life -= dt; }
    w.parts = w.parts.filter(p => p.life > 0);
  }
  drawWorld(world, T);
  requestAnimationFrame(frame);
}
showMenu();
requestAnimationFrame(frame);

window.__palon = { get world() { return world; }, get state() { return state; }, startRun, input, save, step: update };
window.__palon_net = NET;
})();
