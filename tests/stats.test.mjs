import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp01, lerp, logScale, median, toolCategory, computeStats } from '../src/stats.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} !~ ${b}`);

const prompt = (o) => ({ kind: 'prompt', t: 0, hour: 12, weekday: 2, day: '2026-01-01', chars: 10, words: 2, question: false, session: 's', project: 'p', ...o });
const tool = (name) => ({ kind: 'tool', t: 0, name, session: 's', project: 'p' });
const interrupt = () => ({ kind: 'interrupt', t: 0, session: 's' });

const allNumbers = (v, out = []) => {
  if (typeof v === 'number') out.push(v);
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allNumbers(x, out));
  return out;
};

test('clamp01 clamps and maps NaN to 0', () => {
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(0.25), 0.25);
  assert.equal(clamp01(7), 1);
});

test('lerp interpolates', () => {
  assert.equal(lerp(10, 20, 0), 10);
  assert.equal(lerp(10, 20, 1), 20);
  assert.equal(lerp(10, 20, 0.5), 15);
});

test('logScale hits 0 at lo, 1 at hi, 0.5 at geometric mean', () => {
  assert.equal(logScale(4, 4, 80), 0);
  near(logScale(80, 4, 80), 1);
  near(logScale(Math.sqrt(4 * 80), 4, 80), 0.5);
});

test('logScale clamps below lo, above hi and for x <= 0', () => {
  assert.equal(logScale(1, 4, 80), 0);
  assert.equal(logScale(1000, 4, 80), 1);
  assert.equal(logScale(0, 4, 80), 0);
  assert.equal(logScale(-5, 4, 80), 0);
});

test('median handles odd, even and empty arrays', () => {
  assert.equal(median([]), 0);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('median does not mutate its input', () => {
  const input = [3, 1, 2];
  median(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test('toolCategory maps every exact name', () => {
  const expected = {
    build: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
    explore: ['Read', 'Grep', 'Glob'],
    run: ['Bash', 'PowerShell'],
    web: ['WebSearch', 'WebFetch'],
    delegate: ['Agent', 'Task', 'SendMessage', 'Workflow'],
  };
  for (const [cat, names] of Object.entries(expected)) {
    for (const n of names) assert.equal(toolCategory(n), cat, n);
  }
  assert.equal(toolCategory('SomethingElse'), 'other');
});

test('toolCategory treats browser/chrome names as web, case-insensitively, after exact names', () => {
  assert.equal(toolCategory('mcp__claude-in-chrome__navigate'), 'web');
  assert.equal(toolCategory('Built_in_BROWSER_click'), 'web');
  assert.equal(toolCategory('Edit'), 'build');
  assert.equal(toolCategory('Agent'), 'delegate');
});

test('computeStats on empty input has no NaN, null peakHour and zero toolMix', () => {
  const s = computeStats([]);
  assert.equal(s.prompts, 0);
  assert.equal(s.tools, 0);
  assert.equal(s.interrupts, 0);
  assert.equal(s.peakHour, null);
  assert.deepEqual(s.toolMix, { build: 0, explore: 0, run: 0, web: 0, delegate: 0, other: 0 });
  for (const n of allNumbers(s)) assert.ok(!Number.isNaN(n));
  assert.equal(s.nightRatio, 0);
  assert.equal(s.promptsPerActiveDay, 0);
  assert.equal(s.medianSessionPrompts, 0);
});

test('computeStats on a hand-built list matches every field', () => {
  const events = [
    prompt({ hour: 23, weekday: 0, day: '2026-01-01', words: 10, question: true, session: 'A', project: 'P1' }),
    prompt({ hour: 9, weekday: 1, day: '2026-01-01', words: 20, question: false, session: 'A', project: 'P1' }),
    prompt({ hour: 9, weekday: 6, day: '2026-01-02', words: 4, question: true, session: 'B', project: 'P2' }),
    prompt({ hour: 3, weekday: 3, day: '2026-01-03', words: 6, question: false, session: 'A', project: 'P1' }),
    ...['Edit', 'Write', 'Read', 'Read', 'Bash', 'mcp__chrome__go', 'Agent', 'Mystery'].map(tool),
    interrupt(),
    interrupt(),
  ];
  const s = computeStats(events);
  assert.equal(s.prompts, 4);
  assert.equal(s.tools, 8);
  assert.equal(s.interrupts, 2);
  assert.equal(s.sessions, 2);
  assert.equal(s.projects, 2);
  assert.equal(s.activeDays, 3);
  assert.equal(s.nightRatio, 0.5);
  assert.equal(s.weekendRatio, 0.5);
  assert.equal(s.questionRatio, 0.5);
  assert.equal(s.medianPromptWords, 8);
  assert.equal(s.medianSessionPrompts, 2);
  near(s.promptsPerActiveDay, 4 / 3);
  assert.equal(s.toolsPerPrompt, 2);
  assert.equal(s.interruptRate, 0.5);
  assert.deepEqual(s.toolMix, { build: 0.25, explore: 0.25, run: 0.125, web: 0.125, delegate: 0.125, other: 0.125 });
  assert.equal(s.peakHour, 9);
});

test('computeStats night window is hour >= 22 or hour < 5', () => {
  const ratio = (h) => computeStats([prompt({ hour: h })]).nightRatio;
  assert.equal(ratio(22), 1);
  assert.equal(ratio(4), 1);
  assert.equal(ratio(21), 0);
  assert.equal(ratio(5), 0);
});

test('computeStats peakHour ties go to the lowest hour and accepts any iterable', () => {
  const s = computeStats(new Set([prompt({ hour: 15 }), prompt({ hour: 7 }), prompt({ hour: 20 })]));
  assert.equal(s.peakHour, 7);
});
