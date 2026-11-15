// Desktop overlay: the creature lives in a small transparent always-on-top window.
// The shell (src-tauri) watches the cursor natively. It moves the window while the
// creature is held, lets clicks through everywhere except on the creature, and
// sends a "tick" only when something changed, so an idle creature costs very little.
import { Creature, DEFAULT_GENOME } from './creature.js';
import { createPacer } from './pacing.js';

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const pointer = { x: 0, y: 0 };
const due = createPacer();
const IDLE_FPS = 30, ACTIVE_FPS = 60;

let W = 0, H = 0, creature = null;
let held = false, over = false;
let travelled = 0;      // how far the window moved during this grab
let livelyUntil = 0;    // draw at full rate until this time (after a release or poke)

const spot = () => ({ x: W / 2, y: H * 0.36 });

function resize() {
  const dpr = window.devicePixelRatio || 1;
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (!creature) return;
  const s = spot();
  creature.moveTo(s.x, s.y);
  invoke('set_hit', { x: s.x, y: s.y, r: creature.reach * 1.05 }).catch(console.warn);
}

async function loadGenome() {
  try {
    const text = await invoke('load_genome');
    const data = text && JSON.parse(text);
    if (data?.genome) return data.genome;
  } catch (err) { console.warn('glowkin: could not read genome', err); }
  return { ...DEFAULT_GENOME, seed: (Math.random() * 2 ** 32) >>> 0 };
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const lively = held || over || now < livelyUntil;
  if (!due(now, lively ? ACTIVE_FPS : IDLE_FPS)) return;
  const dt = (now - last) / 1000;
  last = now;
  ctx.clearRect(0, 0, W, H);
  creature.update(dt, pointer);
  creature.draw(ctx);
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !creature.hitTest(e.clientX, e.clientY, 1.05)) return;
  canvas.setPointerCapture(e.pointerId);
  pointer.x = e.clientX; pointer.y = e.clientY;
  held = true;
  travelled = 0;
  creature.grab(e.clientX, e.clientY);
  canvas.classList.add('grabbing');
  invoke('grab_start', { gx: e.clientX, gy: e.clientY }).catch(console.warn);
});

function lift() {
  if (!held) return;
  held = false;
  canvas.classList.remove('grabbing');
  invoke('grab_end').catch(console.warn);
  creature.release();
  creature.home = spot();
  if (travelled < 6) creature.poke();
  livelyUntil = performance.now() + 2500;
}
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('resize', resize);

resize();
const s = spot();
pointer.x = s.x; pointer.y = s.y;
creature = new Creature(await loadGenome(), s.x, s.y);
creature.solid = 0.8;
creature.burst(24);
livelyUntil = performance.now() + 2500;

await listen('tick', ({ payload: t }) => {
  pointer.x = t.cx; pointer.y = t.cy;
  over = t.over;
  canvas.classList.toggle('grab', over && !held);
  if (t.dx || t.dy) {
    creature.shiftWorld(-t.dx, -t.dy, 0.6);
    travelled += Math.hypot(t.dx, t.dy);
  }
});
await invoke('set_hit', { x: s.x, y: s.y, r: creature.reach * 1.05 });
requestAnimationFrame(frame);
