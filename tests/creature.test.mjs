import test from 'node:test';
import assert from 'node:assert/strict';
import { Creature, DEFAULT_GENOME } from '../web/creature.js';

const make = (over = {}) => new Creature({ ...DEFAULT_GENOME, seed: 42, tendrils: 4, motes: 2, ...over }, 200, 200);
const pointer = { x: 200, y: 200 };
const finite = (c) => [c.pos.x, c.pos.y, c.vel.x, c.vel.y, ...c.tendrils.flatMap((t) => t.pts.flatMap((p) => [p.x, p.y]))]
  .every(Number.isFinite);

test('simulation stays finite across small and very large frame times', () => {
  const c = make({ jitter: 1, pulse: 1 });
  for (const dt of [0.016, 0, 0.5, 5, 0.001, 0.033]) c.update(dt, pointer);
  assert.ok(finite(c));
});

test('a long frame advances the clock by at most a quarter second', () => {
  const c = make();
  const before = c.t;
  c.update(10, pointer);
  assert.ok(c.t - before <= 0.25 + 1e-9);
  assert.ok(c.t - before > 0.2);
});

test('moveTo teleports body, home and tendrils together', () => {
  const c = make();
  const tip = { ...c.tendrils[0].pts.at(-1) };
  c.moveTo(500, 350);
  assert.deepEqual(c.pos, { x: 500, y: 350 });
  assert.deepEqual(c.home, { x: 500, y: 350 });
  assert.deepEqual(c.vel, { x: 0, y: 0 });
  const moved = c.tendrils[0].pts.at(-1);
  assert.equal(moved.x - tip.x, 300);
  assert.equal(moved.y - tip.y, 150);
  assert.equal(moved.px - tip.px, 300);
});

test('shiftWorld moves trailing parts fully and the body by the given factor', () => {
  const c = make();
  const tip = { ...c.tendrils[1].pts.at(-1) };
  const mote = { ...c.moteCenter };
  c.shiftWorld(-40, 10, 0.5);
  assert.equal(c.pos.x, 180);
  assert.equal(c.pos.y, 205);
  assert.deepEqual(c.home, { x: 200, y: 200 }, 'home is not moved');
  const moved = c.tendrils[1].pts.at(-1);
  assert.equal(moved.x - tip.x, -40);
  assert.equal(moved.y - tip.y, 10);
  assert.equal(moved.px - tip.px, -40, 'velocity is preserved');
  assert.equal(c.moteCenter.x - mote.x, -40);
});

test('after a shift the body springs back toward where it is held', () => {
  const c = make();
  c.grab(200, 200);
  c.shiftWorld(-60, 0, 1);
  for (let i = 0; i < 120; i++) c.update(1 / 60, pointer);
  assert.ok(Math.abs(c.pos.x - 200) < 2, `x settled at ${c.pos.x}`);
});

test('tendrils stay attached to the body after a shift', () => {
  const c = make();
  c.shiftWorld(-80, -30, 0);
  for (let i = 0; i < 90; i++) c.update(1 / 60, pointer);
  for (const td of c.tendrils) {
    const root = td.pts[0];
    assert.ok(Math.hypot(root.x - c.pos.x, root.y - c.pos.y) < c.reach, 'root is on the body');
    for (let j = 1; j < td.pts.length; j++) {
      const d = Math.hypot(td.pts[j].x - td.pts[j - 1].x, td.pts[j].y - td.pts[j - 1].y);
      assert.ok(d < td.seg * 1.5, 'segments are not stretched apart');
    }
  }
});

test('hitTest accepts a tighter radius factor', () => {
  const c = make();
  const edge = c.reach * 1.15;
  assert.equal(c.hitTest(200 + edge, 200), true);
  assert.equal(c.hitTest(200 + edge, 200, 1.05), false);
});

test('release sends the creature home where it stands and makes it happy', () => {
  const c = make();
  c.grab(210, 190);
  assert.equal(c.held, true);
  c.release();
  assert.equal(c.held, false);
  assert.equal(c.joy, 1);
  assert.ok(c.sparks.length > 0);
});
