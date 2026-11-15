// CLI: node src/hatch.mjs [--dir <path>] [--out <path>]
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readEvents } from './adapters/claude-code.mjs';
import { computeStats } from './stats.js';
import { toGenome, describe } from './genome.js';

// Round non-integer numbers to 4 decimals, recursing into plain objects.
function round4(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') out[k] = round4(v);
    else if (typeof v === 'number' && !Number.isInteger(v)) out[k] = Math.round(v * 1e4) / 1e4;
    else out[k] = v;
  }
  return out;
}

export function hatch({ dir = join(homedir(), '.claude', 'projects'), out = 'genome.json', utc } = {}) {
  const stats = computeStats(readEvents(dir, { utc }));
  const genome = toGenome(stats);
  const traits = describe(stats, genome);
  const result = { version: 1, stats: round4(stats), genome: round4(genome), traits };
  writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  return result;
}

function main(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir' && argv[i + 1]) opts.dir = resolve(argv[++i]);
    else if (argv[i] === '--out' && argv[i + 1]) opts.out = resolve(argv[++i]);
  }
  const result = hatch(opts);
  if (result.stats.prompts === 0) {
    console.log('No history was found, so this is a blank starter creature.');
  }
  console.log(`Your creature: the ${result.genome.archetype}.`);
  for (const t of result.traits) console.log(`${t.label}: ${t.value} - ${t.reason}`);
  console.log(`Wrote ${opts.out ?? resolve('genome.json')}`);
  // The desktop overlay looks in ~/.glowkin, so it finds the creature from anywhere.
  if (!opts.out && result.stats.prompts > 0) {
    const home = join(homedir(), '.glowkin');
    mkdirSync(home, { recursive: true });
    copyFileSync(resolve('genome.json'), join(home, 'genome.json'));
    console.log(`Copied to ${join(home, 'genome.json')} for the desktop overlay`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2));
}
