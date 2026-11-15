// Draws the share card: the creature on the left, what it is made of on the right.
import { Creature } from './creature.js';
import { cardModel } from './card-model.js';

export const CARD = { w: 1200, h: 630 };
export const REPO = 'github.com/Mc-Brainzz/glowkin';
const FONT = 'ui-rounded, "SF Pro Rounded", "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif';

function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text.length;
  while (cut > 1 && ctx.measureText(text.slice(0, cut) + '…').width > maxWidth) cut--;
  return text.slice(0, cut).trimEnd() + '…';
}

export function renderCard(canvas, data, { mine = true, scale = 2 } = {}) {
  const { w, h } = CARD;
  const g = data.genome;
  const model = cardModel(data, { mine, repo: REPO });
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const bg = ctx.createRadialGradient(300, 280, 0, 300, 280, 900);
  bg.addColorStop(0, '#0d1638'); bg.addColorStop(0.55, '#060916'); bg.addColorStop(1, '#020308');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Plankton, placed from the creature's own seed so a card always looks the same.
  let s = g.seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(170, 200, 255, ${0.06 + rnd() * 0.16})`;
    ctx.beginPath(); ctx.arc(rnd() * w, rnd() * h, 0.5 + rnd() * 1.4, 0, 6.283); ctx.fill();
  }

  // Let the creature settle for a few simulated seconds, looking toward the text.
  const creature = new Creature(g, 300, 255);
  creature.solid = 0.35;
  const gaze = { x: 640, y: 230 };
  for (let i = 0; i < 240; i++) creature.update(1 / 60, gaze);
  creature.blink = 1;
  ctx.save();
  ctx.translate(300, 250); ctx.scale(1.45, 1.45); ctx.translate(-creature.pos.x, -creature.pos.y);
  creature.draw(ctx);
  ctx.restore();

  const x = 590, right = w - 56, width = right - x;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = `hsl(${g.accentHue} 95% 76%)`;
  ctx.font = `600 14px ${FONT}`;
  ctx.letterSpacing = '2px';
  ctx.fillText(model.eyebrow, x, 70);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8f97b5';
  ctx.font = '13px ui-monospace, "Cascadia Code", Consolas, monospace';
  ctx.letterSpacing = '0px';
  ctx.fillText(model.id, right, 70);
  ctx.textAlign = 'left';

  ctx.save();
  ctx.shadowColor = `hsl(${g.hue} 100% 60% / 0.5)`; ctx.shadowBlur = 26;
  ctx.fillStyle = `hsl(${g.hue} 100% 84%)`;
  ctx.font = `700 54px ${FONT}`;
  ctx.fillText(model.title, x - 2, 126);
  ctx.restore();

  ctx.fillStyle = '#c3c9e0';
  ctx.font = `16px ${FONT}`;
  ctx.fillText(fit(ctx, model.summary, width), x, 158);

  let y = 174;
  const rowH = 55;
  for (const row of model.rows) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
    ctx.fillRect(x, y, width, 1);
    ctx.font = `600 12px ${FONT}`;
    ctx.letterSpacing = '1.2px';
    ctx.fillStyle = '#8f97b5';
    ctx.fillText(row.label.toUpperCase(), x, y + 22);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'right';
    ctx.font = `650 16px ${FONT}`;
    ctx.fillStyle = `hsl(${g.hue} 95% 80%)`;
    ctx.fillText(row.value, right, y + 22);
    ctx.textAlign = 'left';
    ctx.font = `14px ${FONT}`;
    ctx.fillStyle = '#c3c9e0';
    ctx.fillText(fit(ctx, row.reason, width), x, y + 42);
    y += rowH;
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.fillRect(56, h - 62, w - 112, 1);
  ctx.font = `700 20px ${FONT}`;
  ctx.fillStyle = `hsl(${g.hue} 95% 78%)`;
  ctx.fillText('glowkin', 56, h - 28);
  ctx.textAlign = 'right';
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = '#8f97b5';
  ctx.fillText(fit(ctx, model.footer, w - 112 - 110), right, h - 29);
  ctx.textAlign = 'left';
  return canvas;
}

export function downloadCard(data, { mine = true } = {}) {
  const canvas = renderCard(document.createElement('canvas'), data, { mine });
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `glowkin-${data.genome.archetype}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }, 'image/png');
}
