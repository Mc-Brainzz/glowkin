import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashSeed, toGenome, describe } from '../src/genome.js';
import { logScale } from '../src/stats.js';

const stats = (o = {}) => ({
  prompts: 100,
  tools: 200,
  interrupts: 0,
  sessions: 5,
  projects: 3,
  activeDays: 10,
  nightRatio: 0,
  weekendRatio: 0,
  questionRatio: 0,
  medianPromptWords: 10,
  medianSessionPrompts: 5,
  promptsPerActiveDay: 10,
  toolsPerPrompt: 2,
  interruptRate: 0,
  toolMix: { build: 0.2, explore: 0.2, run: 0.2, web: 0.2, delegate: 0.2, other: 0 },
  peakHour: 14,
  ...o,
});
const mix = (o) => ({ build: 0, explore: 0, run: 0, web: 0, delegate: 0, other: 0, ...o });
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);
const UNIT = ['stretch', 'size', 'tendrilLength', 'pulse', 'jitter', 'eyeSize', 'glow'];

test('hashSeed is deterministic, uint32 and matches FNV-1a of the spec string', () => {
  const s = stats();
  assert.equal(hashSeed(s), hashSeed({ ...s }));
  let h = 0x811c9dc5;
  for (const ch of JSON.stringify([100, 200, 5, 3, 10, 14])) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  assert.equal(hashSeed(s), h >>> 0);
  assert.ok(Number.isInteger(hashSeed(s)) && hashSeed(s) >= 0 && hashSeed(s) <= 0xffffffff);
});

test('hashSeed changes when prompts changes and ignores unrelated fields', () => {
  assert.notEqual(hashSeed(stats({ prompts: 101 })), hashSeed(stats()));
  assert.equal(hashSeed(stats({ nightRatio: 0.9 })), hashSeed(stats()));
});

test('toGenome basics: version, seed, accentHue', () => {
  const s = stats({ nightRatio: 1, weekendRatio: 1 });
  const g = toGenome(s);
  assert.equal(g.version, 1);
  assert.equal(g.seed, hashSeed(s));
  assert.equal(g.accentHue, (265 + 150 + 60) % 360);
});

test('hue is 38 at nightRatio 0 and 265 from 0.6 upward', () => {
  assert.equal(toGenome(stats({ nightRatio: 0 })).hue, 38);
  assert.equal(toGenome(stats({ nightRatio: 0.6 })).hue, 265);
  assert.equal(toGenome(stats({ nightRatio: 1 })).hue, 265);
  assert.equal(toGenome(stats({ nightRatio: 0.3 })).hue, Math.round(38 + (265 - 38) * 0.5));
});

test('size hits 0 at 20 prompts, 1 at 5000, 0.5 at the geometric mean', () => {
  assert.equal(toGenome(stats({ prompts: 20 })).size, 0);
  near(toGenome(stats({ prompts: 5000 })).size, 1);
  near(toGenome(stats({ prompts: Math.sqrt(20 * 5000) })).size, 0.5);
});

test('tendrils run from 2 to 8 and are integers', () => {
  assert.equal(toGenome(stats({ toolsPerPrompt: 0 })).tendrils, 2);
  assert.equal(toGenome(stats({ toolsPerPrompt: 40 })).tendrils, 8);
  assert.equal(toGenome(stats({ toolsPerPrompt: 5000 })).tendrils, 8);
  const mid = toGenome(stats({ toolsPerPrompt: 6 })).tendrils;
  assert.equal(mid, 2 + Math.round(6 * logScale(6, 1, 40)));
  assert.ok(Number.isInteger(mid));
});

test('motes cap at 8', () => {
  assert.equal(toGenome(stats({ projects: 0 })).motes, 0);
  assert.equal(toGenome(stats({ projects: 5 })).motes, 5);
  assert.equal(toGenome(stats({ projects: 8 })).motes, 8);
  assert.equal(toGenome(stats({ projects: 30 })).motes, 8);
});

test('jitter and eyeSize saturate at interruptRate 0.2 and questionRatio 0.5', () => {
  const g = toGenome(stats({ interruptRate: 0.1, questionRatio: 0.25 }));
  near(g.jitter, 0.5);
  near(g.eyeSize, 0.5);
  const top = toGenome(stats({ interruptRate: 3, questionRatio: 1 }));
  assert.equal(top.jitter, 1);
  assert.equal(top.eyeSize, 1);
});

test('archetype maps the dominant tool category', () => {
  const a = (m) => toGenome(stats({ toolMix: mix(m) })).archetype;
  assert.equal(a({ build: 0.5, explore: 0.1 }), 'builder');
  assert.equal(a({ explore: 0.5 }), 'explorer');
  assert.equal(a({ run: 0.5 }), 'operator');
  assert.equal(a({ web: 0.5 }), 'researcher');
  assert.equal(a({ delegate: 0.5 }), 'conductor');
  assert.equal(a({ other: 0.9, run: 0.1 }), 'operator');
});

test('archetype ties resolve in build, explore, run, web, delegate order', () => {
  const a = (m) => toGenome(stats({ toolMix: mix(m) })).archetype;
  assert.equal(a({ build: 0.3, explore: 0.3, run: 0.3 }), 'builder');
  assert.equal(a({ explore: 0.3, run: 0.3, web: 0.3 }), 'explorer');
  assert.equal(a({ web: 0.4, delegate: 0.4 }), 'researcher');
});

test('archetype is wanderer when there are no tools', () => {
  assert.equal(toGenome(stats({ tools: 0, toolMix: mix({ build: 1 }) })).archetype, 'wanderer');
});

test('unit-range fields stay within 0..1 for extreme stats', () => {
  const high = stats({
    prompts: 1e9, activeDays: 1e6, medianPromptWords: 1e6, medianSessionPrompts: 1e6,
    promptsPerActiveDay: 1e9, interruptRate: 50, questionRatio: 5, nightRatio: 5, weekendRatio: 1, toolsPerPrompt: 1e6, projects: 1e6,
  });
  const low = stats({
    prompts: 0, tools: 0, sessions: 0, projects: 0, activeDays: 0, medianPromptWords: 0, medianSessionPrompts: 0,
    promptsPerActiveDay: 0, toolsPerPrompt: 0, peakHour: null, toolMix: mix({}),
  });
  for (const s of [high, low]) {
    const g = toGenome(s);
    for (const k of UNIT) assert.ok(g[k] >= 0 && g[k] <= 1 && !Number.isNaN(g[k]), `${k}=${g[k]}`);
    assert.ok(g.hue >= 38 && g.hue <= 265);
    assert.ok(g.accentHue >= 0 && g.accentHue < 360);
  }
});

test('describe returns 8 traits in spec key order with non-empty strings', () => {
  const s = stats();
  const traits = describe(s, toGenome(s));
  assert.deepEqual(traits.map((t) => t.key), ['hue', 'stretch', 'size', 'tendrils', 'pulse', 'jitter', 'motes', 'archetype']);
  for (const t of traits) {
    for (const f of ['key', 'label', 'value', 'reason']) {
      assert.equal(typeof t[f], 'string');
      assert.ok(t[f].length > 0, `${t.key}.${f}`);
    }
  }
});

test('describe reasons contain the numbers the spec requires', () => {
  const s = stats({ prompts: 321, projects: 7, toolsPerPrompt: 6.4, nightRatio: 0.41 });
  const g = toGenome(s);
  const by = Object.fromEntries(describe(s, g).map((t) => [t.key, t]));
  assert.ok(by.motes.reason.includes('7'));
  assert.ok(by.tendrils.reason.includes('6'));
  assert.ok(by.size.reason.includes('321'));
  assert.ok(by.hue.reason.includes('41%'));
  assert.equal(by.tendrils.value, `${g.tendrils} tendrils`);
  assert.equal(by.archetype.value, 'Builder');
});

test('describe names hues by the spec thresholds', () => {
  const s = stats();
  const name = (hue) => describe(s, { ...toGenome(s), hue })[0].value;
  const cases = [[38, 'amber'], [59, 'amber'], [60, 'lime'], [99, 'lime'], [100, 'green'], [159, 'green'],
    [160, 'teal'], [199, 'teal'], [200, 'blue'], [244, 'blue'], [245, 'violet'], [265, 'violet']];
  for (const [h, n] of cases) assert.equal(name(h), n, `hue ${h}`);
});
