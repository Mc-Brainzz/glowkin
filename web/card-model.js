// The words on the share card. Pure and DOM-free so it can be tested in Node.

// Trait reasons are written to the owner ("you"). On a card they post, they
// should read as the owner speaking ("I").
export function firstPerson(text) {
  const out = text
    .replace(/\bfor you\b/gi, 'for me')
    .replace(/\byou are\b/gi, 'I am')
    .replace(/\byours\b/gi, 'mine')
    .replace(/\byour\b/gi, 'my')
    .replace(/\byou\b/gi, 'I');
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_, lead, ch) => lead + ch.toUpperCase());
}

export function cardModel(data, { mine = true, repo = '' } = {}) {
  const { genome, stats, traits } = data;
  const say = mine ? firstPerson : (s) => s;
  const name = genome.archetype[0].toUpperCase() + genome.archetype.slice(1);
  const archetype = traits.find((t) => t.key === 'archetype');
  const count = new Intl.NumberFormat('en').format(stats.prompts);
  const grown = mine
    ? `Grown from my ${count} prompts. Only counts were read, on my own machine.`
    : `Grown from ${count} made-up prompts.`;
  return {
    eyebrow: mine ? 'MY GLOWKIN' : 'A GLOWKIN',
    title: `The ${name}`,
    summary: archetype ? say(archetype.reason) : '',
    rows: traits
      .filter((t) => t.key !== 'archetype')
      .map((t) => ({ label: t.label, value: t.value, reason: say(t.reason) })),
    id: '#' + (genome.seed >>> 0).toString(16).padStart(8, '0'),
    footer: repo ? `${grown}  Grow yours: ${repo}` : grown,
  };
}
