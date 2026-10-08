# trickle-json

**Incremental, typed, zero-dependency partial-JSON parser for LLM streams.**

When a model streams a JSON response token by token, the text is syntactically
broken until the very last token — so `JSON.parse` throws on every intermediate
chunk. `trickle-json` gives you the **best valid value available right now**, on
every chunk, without throwing.

```ts
import { StreamingJsonParser } from "trickle-json";

const parser = new StreamingJsonParser();
parser.on("snapshot", (value) => render(value));                // progressive UI
parser.on("path", "choices[0].message.content", (t) => show(t)); // react to one field

for await (const chunk of stream) parser.write(chunk);
const final = parser.end();
```

One-shot, too:

```ts
import { parsePartial } from "trickle-json";

parsePartial('{"user":{"name":"Ja')  // → { user: { name: "Ja" } }
parsePartial('[1,2,3')                // → [1, 2, 3]
parsePartial("")                      // → undefined (never throws)
```

## Why another one?

The most-used package in this space (`partial-json`, ~35M downloads/month) has
not shipped a release since May 2024 and is stuck at `0.1.x`. The better-designed
approaches — true incremental parsing, path subscriptions, schema typing,
provider adapters — are each scattered across small, single-purpose packages.
`trickle-json` brings them together in one actively maintained library.

| | trickle-json | partial-json | best-effort-json-parser | jsonriver |
|---|:---:|:---:|:---:|:---:|
| Never throws on truncation | ✅ | ⚠️ | ✅ | ✅ |
| Progressive snapshots | ✅ | — | — | ✅ |
| Path subscriptions | ✅ | — | — | — |
| Typed / Zod entry point | ✅ | — | — | — |
| Provider SSE adapters | ✅ | — | — | — |
| Zero runtime deps (core) | ✅ | ✅ | ✅ | ✅ |
| Actively maintained | ✅ | ❌ (2024) | ✅ | ✅ |

> The comparison matrix above reflects the plan for 1.0. Rows marked ✅ that are
> still in progress are tracked in [ROADMAP.md](./ROADMAP.md).

Head-to-head measurements (throws-on-truncation, final correctness, no invented
data, throughput) are in [BENCHMARKS.md](./BENCHMARKS.md) and reproducible with
`npm run bench`. In that snapshot, `trickle-json` is the only parser that never
throws on truncation *and* returns `undefined` on empty input, and it is the
fastest sync partial parser in the set. **Re-run the harness yourself before
citing any number publicly.**

## Install

```sh
npm install trickle-json
```

## API

### `parsePartial(input): unknown`
Parse a possibly-truncated JSON string into the most-complete valid value.
Empty/whitespace input returns `undefined`. Never throws on truncation.

### `new StreamingJsonParser()`
- `.write(chunk)` — append text, emit updates, return the current value.
- `.end()` — finish, emit a final snapshot, return the final value.
- `.on("snapshot", (value, { done }) => …)`
- `.on("path", "a.b[0].c", (value) => …)` — fires when a path's value changes.
- `.buffered` — the raw text accumulated so far.

### `getPath(obj, "a.b[0].c"): unknown`
Read a value at a dotted/indexed path.

### Subpath entry points
- `trickle-json/zod` — `parsePartialZod(input, schema)` (optional `zod` peer dep).
- `trickle-json/openai` — `fromOpenAIStream(stream)`.
- `trickle-json/anthropic` — `fromAnthropicStream(stream)`.

## Semantics

- A **truncated string** yields the partial string decoded so far.
- A **truncated object/array** yields only members fully parsed so far; a trailing
  member whose value has not arrived yet is **dropped, not guessed**.
- A **partial literal** (`tru`, `nul`) is treated as "not available yet".
- **Numbers** at the end of input are returned as parsed so far (a trailing `12`
  could still become `123` in a later chunk — documented ambiguity shared by all
  snapshot parsers).

## Development

```sh
npm install
npm test          # vitest
npm run typecheck
npm run build     # tsup → ESM + CJS + .d.ts
npm run size      # size-limit
```

## License

MIT © Himanshu Sharma
