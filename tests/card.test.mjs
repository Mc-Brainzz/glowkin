import test from 'node:test';
import assert from 'node:assert/strict';
import { cardModel, firstPerson } from '../web/card-model.js';
import { toGenome, describe } from '../src/genome.js';

function sample(over = {}) {
  const stats = {
    prompts: 321, tools: 9000, interrupts: 9, sessions: 20, projects: 5, activeDays: 40,
    nightRatio: 0.41, weekendRatio: 0.2, questionRatio: 0.3, medianPromptWords: 17,
    medianSessionPrompts: 6, promptsPerActiveDay: 8, toolsPerPrompt: 28, interruptRate: 0.03,
    toolMix: { build: 0.2, explore: 0.1, run: 0.6, web: 0.05, delegate: 0.02, other: 0.03 },
    peakHour: 23, ...over,
  };
  const genome = toGenome(stats);
  return { version: 1, stats, genome, traits: describe(stats, genome) };
}

test('firstPerson rewrites every second-person form', () => {
  assert.equal(firstPerson('You have sent 12 prompts.'), 'I have sent 12 prompts.');
  assert.equal(firstPerson('On the days you are active you send about 7 prompts.'),
    'On the days I am active I send about 7 prompts.');
  assert.equal(firstPerson('61% of the tools used for you go to running.'),
    '61% of the tools used for me go to running.');
  assert.equal(firstPerson('Your agent uses 31 tools for every prompt you send.'),
    'My agent uses 31 tools for every prompt I send.');
  assert.equal(firstPerson('You interrupt your agent on about 3% of your prompts.'),
    'I interrupt my agent on about 3% of my prompts.');
});

test('no reason on the card still addresses the reader as "you"', () => {
  for (const over of [{}, { tools: 0, toolsPerPrompt: 0, toolMix: { build: 0, explore: 0, run: 0, web: 0, delegate: 0, other: 0 } },
    { nightRatio: 0 }, { projects: 1 }]) {
    const model = cardModel(sample(over), { mine: true });
    for (const text of [model.summary, ...model.rows.map((r) => r.reason)]) {
      assert.doesNotMatch(text, /\byou(r|rs)?\b/i, text);
    }
  }
});

test('card has a headline, seven trait rows and an id', () => {
  const data = sample();
  const model = cardModel(data, { mine: true, repo: 'github.com/someone/glowkin' });
  assert.equal(model.eyebrow, 'MY GLOWKIN');
  assert.equal(model.title, 'The Operator');
  assert.equal(model.rows.length, 7);
  assert.deepEqual(model.rows.map((r) => r.label),
    ['Glow colour', 'Body shape', 'Size', 'Tendrils', 'Pulse', 'Jitter', 'Motes']);
  for (const r of model.rows) assert.ok(r.label && r.value && r.reason);
  assert.match(model.id, /^#[0-9a-f]{8}$/);
  assert.ok(model.summary.includes('60%'), model.summary);
  assert.ok(model.footer.includes('github.com/someone/glowkin'));
  assert.ok(model.footer.includes('321'));
});

test('a stranger card does not claim to be mine', () => {
  const model = cardModel(sample(), { mine: false });
  assert.equal(model.eyebrow, 'A GLOWKIN');
  assert.doesNotMatch(model.footer, /\bmy\b/i);
});

test('the card model is built from numbers and trait text only', () => {
  const data = sample();
  data.stats.secretPath = 'C:\\Users\\someone\\private-project';
  const text = JSON.stringify(cardModel(data, { mine: true }));
  assert.ok(!text.includes('private-project'));
});
