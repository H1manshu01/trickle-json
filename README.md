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

Head-to-head measurements are in [BENCHMARKS.md](./BENCHMARKS.md), reproducible
with `npm run bench` (correctness + sync throughput) and `npm run bench:stream`
(streaming throughput). In that snapshot, `trickle-json` is the only parser that
never throws on truncation *and* returns `undefined` on empty input; it is the
fastest sync partial parser in the set; and because it parses each character once
across chunks (O(n), not O(n²) re-parsing), streaming a 2,000-record document is
~2,150× faster than re-parsing the buffer on every chunk. **Re-run the harness
yourself before citing any number publicly.**

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
- `.on("path", "a.b[0].c", (value, segments) => …)` — fires when a matched
  path's value changes. Supports `*` wildcards: `items[*].id`,
  `choices[*].message.content`, `data.*`. `segments` is the concrete path
  matched (e.g. `["items", 2, "id"]`).
- `.on("append", "items", (item, index, segments) => …)` — fires once per array
  element as it first appears; the path may contain wildcards.
- `.buffered` — the raw text accumulated so far.

Every `.on(...)` returns an **unsubscribe** function, and accepts an optional
`{ once: true }` to auto-remove after the first fire:

```ts
const stop = parser.on("append", "items", addRow);
parser.on("path", "status", onStatus, { once: true });
// ...later
stop();
```

### `getPath(obj, "a.b[0].c"): unknown`
Read a single value at a concrete (wildcard-free) dotted/indexed path.

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
npm run bench         # correctness + sync throughput vs. incumbents
npm run bench:stream  # streaming throughput (incremental vs. re-parse)
```

## License

MIT © Himanshu Sharma
