// Demo page: shows the creature hatched into genome.json, or a made-up stranger.
import { Creature } from './creature.js';
import { toGenome, describe } from '../src/genome.js';
import { downloadCard, renderCard } from './card.js';

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const card = document.getElementById('card');
const $ = (id) => document.getElementById(id);
const pointer = { x: 0, y: 0 };
const fmt = new Intl.NumberFormat('en');

let W = 0, H = 0, creature = null, mine = null, showingMine = false, current = null;
let down = null, userMoved = false;

// A plausible random usage profile, so visitors can see how usage changes the creature.
function strangerData() {
  const r = Math.random;
  const prompts = Math.round(20 * 250 ** r());
  const activeDays = Math.max(1, Math.min(200, Math.round(prompts / (2 + r() * 30))));
  const tools = Math.round(prompts * (1 + r() * r() * 45));
  const interrupts = Math.round(prompts * r() * r() * 0.3);
  const w = Array.from({ length: 5 }, () => r() ** 3);
  const total = w.reduce((a, b) => a + b, 0) * 1.1;
  const stats = {
    prompts, tools, interrupts,
    sessions: Math.max(1, Math.round(prompts / (1 + r() * 25))),
    projects: 1 + Math.floor(r() * r() * 12),
    activeDays,
    nightRatio: r() * 0.7,
    weekendRatio: r() * 0.6,
    questionRatio: r() * 0.6,
    medianPromptWords: Math.round(3 + r() * r() * 90),
    medianSessionPrompts: 1 + Math.round(r() * r() * 35),
    promptsPerActiveDay: prompts / activeDays,
    toolsPerPrompt: tools / prompts,
    interruptRate: interrupts / prompts,
    toolMix: { build: w[0] / total, explore: w[1] / total, run: w[2] / total, web: w[3] / total, delegate: w[4] / total, other: 1 - 1 / 1.1 },
    peakHour: Math.floor(r() * 24),
  };
  const genome = toGenome(stats);
  return { version: 1, stats, genome, traits: describe(stats, genome) };
}

function restingSpot() {
  const narrow = W <= 760;
  const cardWidth = narrow ? 0 : card.getBoundingClientRect().width + 22;
  return narrow ? { x: W / 2, y: H * 0.27 } : { x: (W - cardWidth) / 2, y: H * 0.46 };
}

function show(data, isMine) {
  showingMine = isMine;
  current = data;
  userMoved = false;
  const spot = restingSpot();
  creature = new Creature(data.genome, spot.x, spot.y);
  creature.bounds = { w: W, h: H };
  creature.burst(24);

  const { genome, stats, traits } = data;
  document.documentElement.style.setProperty('--hue', genome.hue);
  document.documentElement.style.setProperty('--accent', genome.accentHue);

  const name = genome.archetype[0].toUpperCase() + genome.archetype.slice(1);
  $('eyebrow').textContent = isMine ? 'Your glowkin' : "A stranger's glowkin";
  $('title').textContent = `The ${name}`;

  const lede = $('lede');
  lede.textContent = '';
  if (isMine) {
    lede.textContent = `Grown from ${fmt.format(stats.prompts)} prompts and ${fmt.format(stats.tools)} tool calls across ${fmt.format(stats.projects)} projects. Only the counts were read, and nothing left this machine.`;
  } else {
    lede.append('A made-up usage profile, to show how different habits grow a different creature.');
    if (!mine) {
      const code = document.createElement('code');
      code.textContent = 'npm run hatch';
      lede.append(' Run ', code, ' to grow your own.');
    }
  }

  const list = $('traits');
  list.textContent = '';
  for (const t of traits) {
    if (t.key === 'archetype') continue; // already the headline
    const li = document.createElement('li');
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t.label;
    const value = document.createElement('span');
    value.className = 'value';
    value.textContent = t.value;
    row.append(label, value);
    const reason = document.createElement('p');
    reason.className = 'reason';
    reason.textContent = t.reason;
    li.append(row, reason);
    list.append(li);
  }
  const arch = traits.find((t) => t.key === 'archetype');
  if (arch) {
    const li = document.createElement('li');
    const reason = document.createElement('p');
    reason.className = 'reason';
    reason.textContent = arch.reason;
    li.append(reason);
    list.prepend(li);
  }

  $('swap').textContent = isMine || !mine ? 'Meet a stranger' : 'Back to mine';
  $('seed').textContent = '#' + (genome.seed >>> 0).toString(16).padStart(8, '0');
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (creature) {
    creature.bounds = { w: W, h: H };
    if (userMoved) creature.clampHome();
    else { const spot = restingSpot(); creature.moveTo(spot.x, spot.y); }
  }
}

// Faint drifting plankton so the dark water has depth.
const plankton = Array.from({ length: 46 }, () => ({
  x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.3,
  s: 0.004 + Math.random() * 0.012, ph: Math.random() * 6.28,
}));

let last = performance.now();
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  ctx.clearRect(0, 0, W, H);
  for (const p of plankton) {
    p.y -= p.s * dt; if (p.y < -0.02) p.y = 1.02;
    const a = 0.1 + 0.1 * Math.sin(now / 1400 + p.ph);
    ctx.fillStyle = `rgba(170, 200, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(p.x * W + Math.sin(now / 3000 + p.ph) * 8, p.y * H, p.r, 0, 6.283);
    ctx.fill();
  }
  if (creature) { creature.update(dt, pointer); creature.draw(ctx); }
  requestAnimationFrame(frame);
}

canvas.addEventListener('pointermove', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (down) down.moved = Math.max(down.moved, Math.hypot(e.clientX - down.x, e.clientY - down.y));
  canvas.classList.toggle('can-grab', !down && !!creature?.hitTest(e.clientX, e.clientY));
});
canvas.addEventListener('pointerdown', (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY;
  if (!creature?.hitTest(e.clientX, e.clientY)) return;
  canvas.setPointerCapture(e.pointerId);
  down = { x: e.clientX, y: e.clientY, moved: 0 };
  creature.grab(e.clientX, e.clientY);
  canvas.classList.add('grabbing');
});
function lift() {
  if (!down) return;
  const tapped = down.moved < 6;
  down = null;
  if (!tapped) userMoved = true;
  creature.release();
  if (tapped) creature.poke();
  canvas.classList.remove('grabbing');
}
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);

$('swap').addEventListener('click', () => {
  if (showingMine || !mine) show(strangerData(), false);
  else show(mine, true);
});
$('save').addEventListener('click', () => downloadCard(current, { mine: showingMine }));
window.addEventListener('resize', resize);

resize();
pointer.x = W / 2; pointer.y = H / 2;
try {
  const res = await fetch('./genome.json', { cache: 'no-store' });
  if (res.ok) {
    const data = await res.json();
    if (data?.genome && Array.isArray(data.traits) && data.stats?.prompts > 0) mine = data;
  }
} catch { /* no genome yet: show a stranger */ }
show(mine ?? strangerData(), !!mine);

// index.html?card shows only the share card, full window (used to make the README image).
if (new URLSearchParams(location.search).has('card')) {
  const share = Object.assign(document.createElement('canvas'), { id: 'share' });
  document.body.classList.add('card-only');
  document.body.append(renderCard(share, current, { mine: showingMine }));
} else {
  requestAnimationFrame(frame);
}
