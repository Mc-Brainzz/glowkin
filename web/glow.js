// Soft glows are drawn once per colour into a small sprite and then stamped,
// which is far cheaper than building a gradient or a blur on every frame.
const sprites = new Map();

function sprite(kind, hue, size, stops) {
  const h = Math.round(((hue % 360) + 360) % 360);
  const key = kind + h;
  let s = sprites.get(key);
  if (!s) {
    s = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
    const c = s.getContext('2d'), m = size / 2;
    const grad = c.createRadialGradient(m, m, 0, m, m, m);
    for (const [at, light, alpha] of stops) grad.addColorStop(at, `hsla(${h}, 100%, ${light}%, ${alpha})`);
    c.fillStyle = grad;
    c.fillRect(0, 0, size, size);
    sprites.set(key, s);
  }
  return s;
}

export const dotSprite = (hue) => sprite('dot', hue, 96, [[0, 88, 1], [0.3, 68, 0.55], [1, 55, 0]]);
export const auraSprite = (hue) => sprite('aura', hue, 256, [[0, 62, 0.4], [0.11, 62, 0.4], [0.5, 55, 0.12], [1, 50, 0]]);
export const haloSprite = (hue) => sprite('halo', hue, 256, [[0, 60, 0.9], [0.5, 60, 0.75], [0.72, 58, 0.3], [1, 55, 0]]);

export function stamp(ctx, img, x, y, r, alpha) {
  ctx.globalAlpha = Math.min(1, Math.max(0, alpha));
  ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
  ctx.globalAlpha = 1;
}
