// Reads Claude Code session logs and keeps only timing and count information.
// Prompt text is measured (length, words, has "?") and never stored.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const pad = (n) => String(n).padStart(2, '0');

function promptText(message) {
  const c = message.content;
  if (typeof c === 'string') return c.trim();
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

export function eventsFromRecord(rec, opts = {}) {
  if (!rec || rec.timestamp == null) return [];
  const t = Date.parse(rec.timestamp);
  if (Number.isNaN(t)) return [];
  const d = new Date(t);
  const utc = opts.utc === true;
  const hour = utc ? d.getUTCHours() : d.getHours();
  const weekday = utc ? d.getUTCDay() : d.getDay();
  const year = utc ? d.getUTCFullYear() : d.getFullYear();
  const month = (utc ? d.getUTCMonth() : d.getMonth()) + 1;
  const date = utc ? d.getUTCDate() : d.getDate();
  const day = `${year}-${pad(month)}-${pad(date)}`;
  const session = rec.sessionId ?? '';
  const project = rec.cwd ?? '';

  if (rec.type === 'user') {
    if (rec.isSidechain || rec.isMeta || !rec.message) return [];
    const text = promptText(rec.message);
    if (!text) return [];
    if (text.startsWith('[Request interrupted')) return [{ kind: 'interrupt', t, session }];
    if (text.startsWith('<')) return [];
    return [{
      kind: 'prompt', t, hour, weekday, day,
      chars: text.length,
      words: text.split(/\s+/).length,
      question: text.includes('?'),
      session, project,
    }];
  }

  if (rec.type === 'assistant' && Array.isArray(rec.message?.content)) {
    return rec.message.content
      .filter((b) => b && b.type === 'tool_use')
      .map((b) => ({ kind: 'tool', t, name: b.name, session, project }));
  }
  return [];
}

function jsonlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsonlFiles(p));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

export function readEvents(dir, opts = {}) {
  if (!existsSync(dir)) return [];
  const seen = new Set();
  const events = [];
  for (const file of jsonlFiles(dir).sort()) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec && rec.uuid != null) {
        if (seen.has(rec.uuid)) continue;
        seen.add(rec.uuid);
      }
      events.push(...eventsFromRecord(rec, opts));
    }
  }
  return events;
}
