// Pure helpers and usage statistics. Only counts and ratios come out of here.

export const clamp01 = (x) => (Number.isNaN(x) ? 0 : Math.min(1, Math.max(0, x)));

export const lerp = (a, b, t) => a + (b - a) * t;

export function logScale(x, lo, hi) {
  if (!(x > 0)) return 0;
  return clamp01((Math.log(x) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)));
}

export function median(numbers) {
  if (!numbers.length) return 0;
  const s = [...numbers].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const EXACT = {
  Edit: 'build', Write: 'build', MultiEdit: 'build', NotebookEdit: 'build',
  Read: 'explore', Grep: 'explore', Glob: 'explore',
  Bash: 'run', PowerShell: 'run',
  WebSearch: 'web', WebFetch: 'web',
  Agent: 'delegate', Task: 'delegate', SendMessage: 'delegate', Workflow: 'delegate',
};

export function toolCategory(name) {
  const n = String(name);
  if (Object.hasOwn(EXACT, n)) return EXACT[n];
  const lower = n.toLowerCase();
  return lower.includes('browser') || lower.includes('chrome') ? 'web' : 'other';
}

export function computeStats(events) {
  const sessions = new Map(); // session -> prompt count
  const projects = new Set();
  const days = new Set();
  const hours = new Array(24).fill(0);
  const words = [];
  const counts = { build: 0, explore: 0, run: 0, web: 0, delegate: 0, other: 0 };
  let prompts = 0, tools = 0, interrupts = 0, night = 0, weekend = 0, questions = 0;

  for (const e of events) {
    if (e.kind === 'prompt') {
      prompts++;
      sessions.set(e.session, (sessions.get(e.session) ?? 0) + 1);
      projects.add(e.project);
      days.add(e.day);
      hours[e.hour]++;
      words.push(e.words);
      if (e.hour >= 22 || e.hour < 5) night++;
      if (e.weekday === 0 || e.weekday === 6) weekend++;
      if (e.question === true) questions++;
    } else if (e.kind === 'tool') {
      tools++;
      counts[toolCategory(e.name)]++;
    } else if (e.kind === 'interrupt') {
      interrupts++;
    }
  }

  const ratio = (n) => (prompts ? n / prompts : 0);
  const toolMix = {};
  for (const k of Object.keys(counts)) toolMix[k] = tools ? counts[k] / tools : 0;

  let peakHour = null;
  if (prompts) {
    peakHour = 0;
    for (let h = 1; h < 24; h++) if (hours[h] > hours[peakHour]) peakHour = h;
  }

  return {
    prompts,
    tools,
    interrupts,
    sessions: sessions.size,
    projects: projects.size,
    activeDays: days.size,
    nightRatio: ratio(night),
    weekendRatio: ratio(weekend),
    questionRatio: ratio(questions),
    medianPromptWords: median(words),
    medianSessionPrompts: median([...sessions.values()]),
    promptsPerActiveDay: prompts / Math.max(days.size, 1),
    toolsPerPrompt: tools / Math.max(prompts, 1),
    interruptRate: interrupts / Math.max(prompts, 1),
    toolMix,
    peakHour,
  };
}
