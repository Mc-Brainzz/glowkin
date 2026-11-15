// Turns stats into a genome (numbers for the renderer) and plain-language traits.
import { clamp01, lerp, logScale } from './stats.js';

export function hashSeed(stats) {
  const { prompts, tools, sessions, projects, activeDays, peakHour } = stats;
  const text = JSON.stringify([prompts, tools, sessions, projects, activeDays, peakHour]);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ARCHETYPES = [
  ['build', 'builder'], ['explore', 'explorer'], ['run', 'operator'],
  ['web', 'researcher'], ['delegate', 'conductor'],
];

function pickArchetype(stats) {
  if (stats.tools === 0) return 'wanderer';
  let best = ARCHETYPES[0];
  for (const a of ARCHETYPES) if (stats.toolMix[a[0]] > stats.toolMix[best[0]]) best = a;
  return best[1];
}

export function toGenome(stats) {
  const hue = Math.round(lerp(38, 265, clamp01(stats.nightRatio / 0.6)));
  return {
    version: 1,
    seed: hashSeed(stats),
    hue,
    accentHue: (hue + 150 + Math.round(60 * stats.weekendRatio)) % 360,
    stretch: logScale(stats.medianPromptWords, 4, 80),
    size: logScale(stats.prompts, 20, 5000),
    tendrils: 2 + Math.round(6 * logScale(stats.toolsPerPrompt, 1, 40)),
    tendrilLength: logScale(stats.medianSessionPrompts, 1, 30),
    pulse: logScale(stats.promptsPerActiveDay, 2, 80),
    jitter: clamp01(stats.interruptRate / 0.2),
    motes: Math.min(stats.projects, 8),
    eyeSize: clamp01(stats.questionRatio / 0.5),
    glow: logScale(stats.activeDays, 1, 120),
    archetype: pickArchetype(stats),
  };
}

const pct = (x) => `${Math.round(x * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pick = (x, low, mid, high) => (x < 0.33 ? low : x < 0.66 ? mid : high);

function hueName(hue) {
  if (hue < 60) return 'amber';
  if (hue < 100) return 'lime';
  if (hue < 160) return 'green';
  if (hue < 200) return 'teal';
  if (hue < 245) return 'blue';
  return 'violet';
}

const ARCHETYPE_REASON = {
  builder: 'building',
  explorer: 'exploring',
  operator: 'running',
  researcher: 'web',
  conductor: 'delegation',
};

export function describe(stats, genome) {
  const trait = (key, label, value, reason) => ({ key, label, value, reason });
  const mixKey = ARCHETYPES.find((a) => a[1] === genome.archetype)?.[0];
  const archetypeReason = mixKey
    ? `${pct(stats.toolMix[mixKey])} of the tools used for you go to ${ARCHETYPE_REASON[genome.archetype]}, more than anything else.`
    : 'Your history shows 0 tool uses so far, so your creature has not picked a specialty yet.';

  return [
    trait('hue', 'Glow colour', hueName(genome.hue),
      `${pct(stats.nightRatio)} of your prompts land between 10pm and 5am, which sets the colour.`),
    trait('stretch', 'Body shape', pick(genome.stretch, 'compact', 'balanced', 'long'),
      `Your typical prompt is about ${Math.round(stats.medianPromptWords)} words long, which sets how stretched the body is.`),
    trait('size', 'Size', pick(genome.size, 'small', 'medium', 'large'),
      `You have sent ${stats.prompts} prompts in total, and more prompts make a bigger creature.`),
    trait('tendrils', 'Tendrils', plural(genome.tendrils, 'tendril'),
      `Your agent uses about ${Math.round(stats.toolsPerPrompt)} tools for every prompt you send.`),
    trait('pulse', 'Pulse', pick(genome.pulse, 'slow', 'steady', 'quick'),
      `On the days you are active you send about ${Math.round(stats.promptsPerActiveDay)} prompts.`),
    trait('jitter', 'Jitter', pick(genome.jitter, 'calm', 'restless', 'twitchy'),
      `You interrupt your agent on about ${pct(stats.interruptRate)} of your prompts.`),
    trait('motes', 'Motes', plural(genome.motes, 'mote'),
      `You have worked across ${plural(stats.projects, 'project')}, and each one (up to 8) adds a mote.`),
    trait('archetype', 'Archetype', genome.archetype[0].toUpperCase() + genome.archetype.slice(1),
      archetypeReason),
  ];
}
