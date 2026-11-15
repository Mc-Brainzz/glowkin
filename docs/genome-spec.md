# Glowkin genome spec (v1)

Glowkin turns how a person uses their AI coding agent into a small set of numbers
(the **genome**) that a renderer draws as a glowing creature. Everything runs locally.
Only counts and ratios are ever computed or written: never prompt text, file names,
project names or paths.

Pipeline: `session logs -> events -> stats -> genome -> traits -> genome.json`

All source files are ES modules, zero dependencies, Node 20+. `src/stats.js` and
`src/genome.js` must also run unchanged in a browser (no `node:` imports).

## 1. Events

An event is a plain object. Three kinds:

| kind | fields |
|---|---|
| `prompt` | `t` (epoch ms), `hour` (0-23), `weekday` (0=Sunday..6), `day` (`"YYYY-MM-DD"`), `chars`, `words`, `question` (bool), `session` (string), `project` (string) |
| `tool` | `t`, `name` (string), `session`, `project` |
| `interrupt` | `t`, `session` |

## 2. `src/adapters/claude-code.mjs` (Node only)

### `eventsFromRecord(rec, opts = {})` -> `Event[]`

`rec` is one parsed JSON line of a Claude Code session log. Returns zero or more events.

- If `rec.timestamp` is missing or `Date.parse` gives `NaN`, return `[]`.
- `t = Date.parse(rec.timestamp)`. `hour`, `weekday`, `day` come from `new Date(t)` using
  local-time getters, or UTC getters when `opts.utc === true`. `day` is zero-padded.
- `session = rec.sessionId ?? ''`, `project = rec.cwd ?? ''`.
- **User records** (`rec.type === 'user'`): ignore if `rec.isSidechain` or `rec.isMeta` is truthy,
  or if there is no `rec.message`. Text is `rec.message.content` when it is a string; when it is an
  array, the `text` fields of blocks with `type === 'text'` joined with `"\n"` (other block types,
  such as `tool_result` and `image`, contribute nothing). Trim the text. Then:
  - empty -> `[]`
  - starts with `[Request interrupted` -> one `interrupt` event
  - starts with `<` (command and system wrappers) -> `[]`
  - otherwise one `prompt` event: `chars = text.length`, `words = text.split(/\s+/).length`,
    `question = text.includes('?')`
- **Assistant records** (`rec.type === 'assistant'`) with an array `rec.message.content`: one `tool`
  event per block with `type === 'tool_use'`, `name = block.name`. Sidechain records ARE included here.
- Any other `type` -> `[]`.

### `readEvents(dir, opts = {})` -> `Event[]`

Recursively reads every `*.jsonl` file under `dir`, one JSON record per line. Blank lines and lines
that fail `JSON.parse` are skipped silently. Records with a `uuid` already seen (across all files)
are skipped. A missing `dir` returns `[]`. `opts` is passed through to `eventsFromRecord`.

## 3. `src/stats.js`

### Helpers (all exported)

- `clamp01(x)`: clamp to [0, 1]; `NaN` -> 0.
- `lerp(a, b, t)`: `a + (b - a) * t`.
- `logScale(x, lo, hi)`: `clamp01((ln x - ln lo) / (ln hi - ln lo))`; `x <= 0` -> 0.
- `median(numbers)`: 0 for an empty array; mean of the two middle values for even length.
  Must not mutate its input.
- `toolCategory(name)` -> one of `build | explore | run | web | delegate | other`:
  - `build`: `Edit`, `Write`, `MultiEdit`, `NotebookEdit`
  - `explore`: `Read`, `Grep`, `Glob`
  - `run`: `Bash`, `PowerShell`
  - `web`: `WebSearch`, `WebFetch`, or any name containing `browser` or `chrome` (case-insensitive)
  - `delegate`: `Agent`, `Task`, `SendMessage`, `Workflow`
  - `other`: anything else. Exact names are checked before the `browser`/`chrome` rule.

### `computeStats(events)` -> `Stats`

`events` is any iterable of events. Returns:

| field | definition |
|---|---|
| `prompts` | number of `prompt` events |
| `tools` | number of `tool` events |
| `interrupts` | number of `interrupt` events |
| `sessions` | distinct `session` values among prompts |
| `projects` | distinct `project` values among prompts |
| `activeDays` | distinct `day` values among prompts |
| `nightRatio` | prompts with `hour >= 22 || hour < 5`, divided by `prompts` |
| `weekendRatio` | prompts with `weekday` 0 or 6, divided by `prompts` |
| `questionRatio` | prompts with `question === true`, divided by `prompts` |
| `medianPromptWords` | `median` of `words` over prompts |
| `medianSessionPrompts` | `median` of the prompt count of each session |
| `promptsPerActiveDay` | `prompts / max(activeDays, 1)` |
| `toolsPerPrompt` | `tools / max(prompts, 1)` |
| `interruptRate` | `interrupts / max(prompts, 1)` |
| `toolMix` | `{ build, explore, run, web, delegate, other }`, each the fraction of `tool` events in that category (all 0 when there are no tools) |
| `peakHour` | hour with the most prompts; ties go to the lowest hour; `null` with no prompts |

Every ratio is 0 when there are no prompts. No field may be `NaN`.

## 4. `src/genome.js`

Imports helpers from `./stats.js`.

### `hashSeed(stats)` -> unsigned 32-bit integer

FNV-1a (offset basis `0x811c9dc5`, prime `0x01000193`, `Math.imul`, final `>>> 0`) over the UTF-16
code units of `JSON.stringify([prompts, tools, sessions, projects, activeDays, peakHour])`.

### `toGenome(stats)` -> `Genome`

| field | formula | range |
|---|---|---|
| `version` | `1` | |
| `seed` | `hashSeed(stats)` | uint32 |
| `hue` | `round(lerp(38, 265, clamp01(nightRatio / 0.6)))` | 38..265 |
| `accentHue` | `(hue + 150 + round(60 * weekendRatio)) % 360` | 0..359 |
| `stretch` | `logScale(medianPromptWords, 4, 80)` | 0..1 |
| `size` | `logScale(prompts, 20, 5000)` | 0..1 |
| `tendrils` | `2 + round(6 * logScale(toolsPerPrompt, 1, 40))` | 2..8 integer |
| `tendrilLength` | `logScale(medianSessionPrompts, 1, 30)` | 0..1 |
| `pulse` | `logScale(promptsPerActiveDay, 2, 80)` | 0..1 |
| `jitter` | `clamp01(interruptRate / 0.2)` | 0..1 |
| `motes` | `min(projects, 8)` | 0..8 integer |
| `eyeSize` | `clamp01(questionRatio / 0.5)` | 0..1 |
| `glow` | `logScale(activeDays, 1, 120)` | 0..1 |
| `archetype` | see below | string |

`archetype`: `wanderer` when `stats.tools === 0`. Otherwise the largest of `toolMix.build`,
`explore`, `run`, `web`, `delegate` (ties resolved in that order; `other` is ignored), mapped to
`builder`, `explorer`, `operator`, `researcher`, `conductor`.

### `describe(stats, genome)` -> `Trait[]`

Exactly 8 traits, in this key order: `hue`, `stretch`, `size`, `tendrils`, `pulse`, `jitter`,
`motes`, `archetype`. Each is `{ key, label, value, reason }`, all non-empty strings.

- `label`: short name for the body part, e.g. "Glow colour".
- `value`: what the creature got, e.g. "violet", "7 tendrils", "Operator".
- `reason`: one plain sentence in the second person that states the usage number behind it,
  e.g. "41% of your prompts land between 10pm and 5am." Percentages are whole numbers followed
  by `%`. The `motes` reason contains the project count; the `tendrils` reason contains
  `toolsPerPrompt` rounded to a whole number; the `size` reason contains the prompt count.

Hue names for `value`: below 60 "amber", below 100 "lime", below 160 "green", below 200 "teal",
below 245 "blue", otherwise "violet".

## 5. `src/hatch.mjs` (CLI, Node only)

`node src/hatch.mjs [--dir <path>] [--out <path>]`

- `--dir` defaults to `~/.claude/projects`; `--out` defaults to `genome.json` in the current directory.
- Runs `readEvents` -> `computeStats` -> `toGenome` -> `describe`, then writes
  `{ version: 1, stats, genome, traits }` as pretty JSON. Non-integer numbers in `stats` and `genome`
  are rounded to 4 decimal places in the file.
- Prints the archetype and the 8 traits (`label: value - reason`) to stdout.
- When `--out` is not given and there is history, the CLI also copies the file to
  `~/.glowkin/genome.json`, which is where the desktop overlay looks for it.
- Exports `hatch({ dir, out, utc })` returning the written object, and only runs the CLI when
  executed directly (not when imported).
- If there are no prompts it still writes a valid file and says no history was found.
