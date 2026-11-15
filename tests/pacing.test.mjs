import test from 'node:test';
import assert from 'node:assert/strict';
import { createPacer } from '../web/pacing.js';

// Feed the pacer one second of display frames and count how many it lets through.
function rendersPerSecond(displayHz, fps, { start = 0, pacer = createPacer() } = {}) {
  let count = 0;
  for (let i = 1; i <= displayHz; i++) if (pacer(start + (i * 1000) / displayHz, fps)) count++;
  return count;
}

test('a 60Hz display at 30fps renders every other frame', () => {
  const n = rendersPerSecond(60, 30);
  assert.ok(n >= 29 && n <= 31, `got ${n}`);
});

test('a 60Hz display at 60fps renders every frame', () => {
  const n = rendersPerSecond(60, 60);
  assert.ok(n >= 59 && n <= 60, `got ${n}`);
});

test('a 144Hz display is capped near 60fps, not 48 or 72', () => {
  const n = rendersPerSecond(144, 60);
  assert.ok(n >= 57 && n <= 62, `got ${n}`);
});

test('a 165Hz display is capped near 30fps when idle', () => {
  const n = rendersPerSecond(165, 30);
  assert.ok(n >= 28 && n <= 32, `got ${n}`);
});

test('the first frame always renders', () => {
  assert.equal(createPacer()(12345.6, 30), true);
});

test('no burst of catch-up frames after a long pause', () => {
  const pacer = createPacer();
  rendersPerSecond(60, 30, { pacer });
  const n = rendersPerSecond(60, 30, { pacer, start: 60_000 });
  assert.ok(n >= 29 && n <= 31, `got ${n}`);
});

test('the rate can change from one frame to the next', () => {
  const pacer = createPacer();
  const idle = rendersPerSecond(120, 30, { pacer });
  const active = rendersPerSecond(120, 60, { pacer, start: 1000 });
  assert.ok(idle >= 28 && idle <= 32, `idle ${idle}`);
  assert.ok(active >= 57 && active <= 62, `active ${active}`);
});
