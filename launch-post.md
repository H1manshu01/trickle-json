---
title: "JSON.parse throws on every token your LLM streams. Here's a cleaner fix."
published: false
description: "Streaming structured output from an LLM? The JSON is broken until the last token. Here's why the usual fixes fall short — and trickle-json, a zero-dependency incremental parser built for it."
tags: javascript, typescript, ai, opensource
cover_image: https://raw.githubusercontent.com/H1manshu01/trickle-json/main/assets/cover.png
canonical_url: https://github.com/H1manshu01/trickle-json
---

If you've ever streamed structured output from an LLM, you've met this bug:

```js
for await (const part of stream) {
  buffer += part.choices[0]?.delta?.content ?? "";
  const data = JSON.parse(buffer); // 💥 SyntaxError on literally every chunk
  render(data);
}
```

A model emits JSON one token at a time. Until the **very last** token arrives, the buffer is syntactically broken — `{"city":"Par` isn't valid JSON — so `JSON.parse` throws on every intermediate chunk. You want to show the UI filling in as it streams; the parser wants a complete document.

Let's look at the usual workarounds, why they fall short, and a small library I built to do it properly.

## The usual fixes (and where they hurt)

**1. "Just parse at the end."** Accumulate everything, parse once when the stream finishes. Correct — but you've thrown away the entire point of streaming. The user stares at a spinner while a 2 KB object generates token by token.

**2. Split on `}`.** Tempting for a streamed array, but it breaks the instant an element contains a nested object or a `}` inside a string. You end up re-implementing a JSON tokenizer badly.

**3. Repair-then-parse** (`jsonrepair` and friends). Close the open braces/quotes, then `JSON.parse`. This mostly works, but:
   - It **re-parses the whole buffer on every chunk** — that's O(n²) over a stream. On a long response it gets genuinely slow.
   - Repair **guesses**. It can briefly surface values that aren't actually in the final object.

**4. The incumbent, `partial-json`.** It's the de-facto choice (~35M downloads/month) — but it hasn't shipped a release since May 2024 and is still on `0.1.x`. And the better ideas (progressive snapshots, path subscriptions, schema typing, provider adapters) are scattered across a handful of tiny single-purpose packages.

These aren't hypothetical rough edges. Two real bugs from the Vercel AI SDK tracker show exactly what goes wrong when a parseability check meets a half-streamed buffer:

- [#12052](https://github.com/vercel/ai/issues/12052) — a parseability check passes on a **truncated** tool-call argument, emitting a tool call whose input is still a half-string (`Unterminated string in JSON at position 3337`).
- [#6687](https://github.com/vercel/ai/issues/6687) — an empty arguments string `""` is treated as unparseable, so a zero-arg tool call never fires.

The common thread: deciding "is this done?" by asking "does it parse yet?" is fragile. You want a parser that always returns the best valid value so far and *never throws* — so you can call it on every chunk without a `try/catch`.

## trickle-json

[`trickle-json`](https://www.npmjs.com/package/trickle-json) is a zero-dependency, incremental partial-JSON parser built for LLM streams. The core idea:

```js
import { parsePartial } from "trickle-json";

parsePartial('{"user":{"name":"Ja')  // → { user: { name: "Ja" } }
parsePartial("[1,2,3")               // → [1, 2, 3]
parsePartial("")                     // → undefined  (never throws)
```

It returns the **most-complete valid value available right now**. A truncated string comes back as the partial string; a member whose value hasn't arrived yet is dropped rather than guessed; empty input is `undefined`, not an exception.

### Streaming, with progressive snapshots

```ts
import { StreamingJsonParser } from "trickle-json";

const parser = new StreamingJsonParser();
parser.on("snapshot", (value) => render(value)); // best-effort value after each chunk

for await (const part of stream) {
  const delta = part.choices[0]?.delta?.content ?? "";
  if (delta) parser.write(delta);
}
const final = parser.end();
```

### React to one field, or to a list filling in

```ts
// fires as a single field grows
parser.on("path", "choices[0].message.content", (text) => appendToken(text));

// wildcards + per-element "append" events for streaming lists
parser.on("path", "items[*].id", (id, segments) => console.log(segments, id));
parser.on("append", "items", (item, index) => addRow(index, item));
```

### Provider adapters (SSE + tool calls)

Parse a raw `text/event-stream` body directly, including tool/function-call arguments as they stream:

```ts
import { openAISSEToChunks, streamOpenAIToolCalls } from "trickle-json/openai";

for await (const calls of streamOpenAIToolCalls(openAISSEToChunks(res.body))) {
  // calls[0].name, calls[0].arguments — arguments fill in as they arrive
}
```

There's a matching `trickle-json/anthropic` (text + `input_json_delta` tool-use), and a `trickle-json/zod` entry point for typed partial snapshots.

## The part I'm proud of: it's O(n), not O(n²)

The naive approach re-parses the whole accumulated buffer on every chunk. `trickle-json` uses a **resumable, character-at-a-time parser** that keeps its state across chunks and mutates a live value tree in place — so feeding N characters total costs O(N), no matter how they're split.

Streaming a growing document in small chunks (reproduce with `npm run bench:stream`):

| records | trickle-json (incremental) | re-parse each chunk | jsonriver |
|---:|---:|---:|---:|
| 250 | **1.0 ms** | 182 ms | 2.3 ms |
| 1,000 | **2.9 ms** | 2,927 ms | 5.1 ms |
| 2,000 | **5.7 ms** | 12,347 ms | 9.0 ms |

At 2,000 records the incremental engine is **~2,150× faster** than re-parsing the buffer on every chunk — the quadratic cost simply disappears.

## Correct, and tested like it

Partial parsing is only useful if it's *right*. The streaming engine is verified equivalent to the one-shot parser on **every prefix** of a broad corpus plus 200 randomly generated documents, with a never-throw guarantee checked against an adversarial/garbage corpus. Against the incumbents on a prefix-by-prefix sweep (`npm run bench`):

| parser | throws on truncation | no invented data | empty input |
|---|:---:|:---:|:---:|
| **trickle-json** | **0%** | 99.3% | `undefined` |
| partial-json | 0.3% | 99.4% | throws |
| best-effort-json-parser | 0% | **69.2%** | `""` |

`trickle-json` is the only one that never throws on truncation *and* returns `undefined` (not an exception) on empty input — so it's safe to call on every chunk.

(One honest caveat shared by every snapshot parser: a number truncated mid-exponent, like `1.5e-1` as a prefix of `1.5e-10`, transiently reads as `0.15`. It resolves as soon as the next digit arrives.)

## Try it

```sh
npm install trickle-json
```

- **npm:** https://www.npmjs.com/package/trickle-json
- **GitHub:** https://github.com/H1manshu01/trickle-json
- Zero runtime dependencies, ~2.6 kB min+gzip, ESM + CJS, full types, published with provenance.

If you're building streaming AI UIs, give it a spin — and if it breaks on some input, open an issue with the string; the never-throw guarantee is the whole point, so I want to know. ⭐ appreciated if it saves you a `try/catch`.
