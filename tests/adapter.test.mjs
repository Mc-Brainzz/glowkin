import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eventsFromRecord, readEvents } from '../src/adapters/claude-code.mjs';
import { hatch } from '../src/hatch.mjs';

const UTC = { utc: true };
const ts = '2026-03-08T23:30:00.000Z';
const T = Date.parse(ts);
const user = (content, o = {}) => ({ type: 'user', timestamp: ts, sessionId: 's1', cwd: '/p', message: { content }, ...o });
const asst = (content, o = {}) => ({ type: 'assistant', timestamp: ts, sessionId: 's1', cwd: '/p', message: { content }, ...o });

test('eventsFromRecord returns [] for missing or invalid timestamps', () => {
  assert.deepEqual(eventsFromRecord(user('hi', { timestamp: undefined }), UTC), []);
  assert.deepEqual(eventsFromRecord(user('hi', { timestamp: 'not a date' }), UTC), []);
});

test('string user content becomes a prompt with derived fields', () => {
  const [e, ...rest] = eventsFromRecord(user('  what is this?  '), UTC);
  assert.equal(rest.length, 0);
  assert.equal(e.kind, 'prompt');
  assert.equal(e.t, T);
  assert.equal(e.hour, 23);
  assert.equal(e.weekday, 0);
  assert.equal(e.day, '2026-03-08');
  assert.equal(e.chars, 13);
  assert.equal(e.words, 3);
  assert.equal(e.question, true);
  assert.equal(e.session, 's1');
  assert.equal(e.project, '/p');
});

test('day is zero-padded, weekday is UTC-based, session and project default to empty', () => {
  const rec = { type: 'user', timestamp: '2026-01-05T04:00:00Z', message: { content: 'hello there' } };
  const [e] = eventsFromRecord(rec, UTC);
  assert.equal(e.day, '2026-01-05');
  assert.equal(e.hour, 4);
  assert.equal(e.weekday, 1);
  assert.equal(e.question, false);
  assert.equal(e.session, '');
  assert.equal(e.project, '');
});

test('array content joins text blocks with newline and ignores other block types', () => {
  const content = [
    { type: 'text', text: 'hello' },
    { type: 'tool_result', content: 'ignored words here' },
    { type: 'image', source: {} },
    { type: 'text', text: 'world' },
  ];
  const [e] = eventsFromRecord(user(content), UTC);
  assert.equal(e.kind, 'prompt');
  assert.equal(e.chars, 'hello\nworld'.length);
  assert.equal(e.words, 2);
  assert.deepEqual(eventsFromRecord(user([{ type: 'tool_result', content: 'x' }]), UTC), []);
});

test('user records that are sidechain, meta, message-less, empty or wrapped yield nothing', () => {
  assert.deepEqual(eventsFromRecord(user('hi', { isSidechain: true }), UTC), []);
  assert.deepEqual(eventsFromRecord(user('hi', { isMeta: true }), UTC), []);
  assert.deepEqual(eventsFromRecord({ type: 'user', timestamp: ts }, UTC), []);
  assert.deepEqual(eventsFromRecord(user('   \n '), UTC), []);
  assert.deepEqual(eventsFromRecord(user('<command-name>/clear</command-name>'), UTC), []);
});

test('interrupt text becomes a single interrupt event', () => {
  const out = eventsFromRecord(user('[Request interrupted by user]'), UTC);
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'interrupt');
  assert.equal(out[0].t, T);
  assert.equal(out[0].session, 's1');
});

test('assistant tool_use blocks become tool events, sidechain included, other types ignored', () => {
  const content = [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'Read' }, { type: 'tool_use', name: 'Bash' }];
  const out = eventsFromRecord(asst(content, { isSidechain: true }), UTC);
  assert.deepEqual(out.map((e) => [e.kind, e.name]), [['tool', 'Read'], ['tool', 'Bash']]);
  assert.equal(out[0].project, '/p');
  assert.deepEqual(eventsFromRecord(asst('just a string'), UTC), []);
  assert.deepEqual(eventsFromRecord({ type: 'summary', timestamp: ts }, UTC), []);
});

let root;
let logDir;
const line = (o) => JSON.stringify(o);

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'glowkin-'));
  logDir = path.join(root, 'logs');
  fs.mkdirSync(path.join(logDir, 'proj', 'deep'), { recursive: true });
  const secret = { uuid: 'u1', ...user('xylophone secret question?', { cwd: 'C:\\zebra\\proj' }) };
  fs.writeFileSync(path.join(logDir, 'proj', 'a.jsonl'), [
    line(secret),
    '',
    '{ this is not json',
    line(secret),
    line({ uuid: 'u2', ...asst([{ type: 'tool_use', name: 'Read' }], { cwd: 'C:\\zebra\\proj' }) }),
  ].join('\n'));
  fs.writeFileSync(path.join(logDir, 'proj', 'deep', 'b.jsonl'), [
    line(secret),
    line({ uuid: 'u3', ...user('second prompt here', { sessionId: 's2', cwd: 'C:\\zebra\\proj' }) }),
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(logDir, 'proj', 'notes.txt'), line({ uuid: 'u9', ...user('not a jsonl file') }));
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('readEvents walks nested dirs, skips junk, dedupes uuids and ignores non-jsonl files', () => {
  const events = readEvents(logDir, UTC);
  assert.equal(events.filter((e) => e.kind === 'prompt').length, 2);
  assert.equal(events.filter((e) => e.kind === 'tool').length, 1);
  assert.equal(events.length, 3);
});

test('readEvents returns [] for a missing directory', () => {
  assert.deepEqual(readEvents(path.join(root, 'nope'), UTC), []);
});

test('hatch writes a file with counts only: no prompt text, no project path, rounded numbers', () => {
  const out = path.join(root, 'genome.json');
  const result = hatch({ dir: logDir, out, utc: true });
  const raw = fs.readFileSync(out, 'utf8');
  const file = JSON.parse(raw);
  assert.deepEqual(Object.keys(file), ['version', 'stats', 'genome', 'traits']);
  assert.equal(file.version, 1);
  assert.equal(result.stats.prompts, 2);
  assert.equal(file.stats.prompts, 2);
  assert.equal(file.stats.projects, 1);
  assert.equal(file.traits.length, 8);
  assert.ok(!/xylophone|second prompt/i.test(raw));
  assert.ok(!/zebra/i.test(raw));
  const walk = (v) => {
    if (typeof v === 'number') assert.equal(v, Math.round(v * 1e4) / 1e4);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(file.stats);
  walk(file.genome);
});

test('hatch with no history still writes a valid file', () => {
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  const out = path.join(root, 'empty.json');
  hatch({ dir: empty, out, utc: true });
  const file = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(file.stats.prompts, 0);
  assert.equal(file.genome.archetype, 'wanderer');
  assert.equal(file.traits.length, 8);
});
