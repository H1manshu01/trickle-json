# Roadmap

Ship `M1 + M2` as **v0.1** early — it is already competitive.

## M1 — Core one-shot parser ✅ (scaffolded)
- [x] `parsePartial(string)` incremental tokenizer + pushdown parser
- [x] Correct on every truncation point (prefix-fuzz suite)
- [x] Never throws on truncated input

## M2 — Streaming ✅
- [x] `StreamingJsonParser` with chunk accumulation + `snapshot` events
- [x] True incremental parsing (`IncrementalParser`): each character processed
      once across all chunks — O(n) total instead of O(n²). Verified equivalent
      to `parsePartial` on every prefix (see `test/incremental.test.ts`) and
      ~2,150× faster than the old re-parse strategy at 2k records (BENCHMARKS.md).

## M3 — Subscriptions ✅
- [x] Path matching (`a.b[0].c`)
- [x] Wildcards (`items[*].id`, `data.*`) with concrete `segments` reported
- [x] Array-append events (`on("append", "items", (item, i) => …)`)
- [x] `once` option and unsubscribe handles (every `on` returns an `Unsubscribe`)

## M4 — Typed + adapters ✅
- [x] Zero-dep SSE parser (`src/sse.ts`), robust to chunk/UTF-8 boundaries
- [x] `trickle-json/zod`: typed partial snapshots (`parsePartialTyped<T>`,
      `TypedStreamingParser<T>`, `DeepPartial<T>`) plus `parsePartialZod` validation
- [x] `trickle-json/openai`: raw SSE parsing (`openAISSEToChunks`) + tool-call
      argument streams (`streamOpenAIToolCalls`)
- [x] `trickle-json/anthropic`: raw SSE parsing (`anthropicSSEToEvents`) +
      tool-use `input_json_delta` streaming (`streamAnthropicToolInput`)

## M5 — Harden & launch
- [x] Expand fuzz corpus; adversarial/invalid-input tests + a seeded property
      test over 200 random docs (`test/fuzz-adversarial.test.ts`)
- [x] Comparison benchmark vs. incumbents in-repo (`BENCHMARKS.md`), reproducible
      and re-verified
- [x] CI matrix (Node 18/20/22) + Bun smoke job + `size-limit` + lint gates
- [x] Lint/format gate (Biome), cross-runtime smoke test (`scripts/smoke.mjs`)
- [ ] npm publish with `--provenance` — CI job is ready; needs `NPM_TOKEN` secret
      and a `v0.1.0` tag (owner action). See LAUNCH.md.
- [ ] README demo gif + launch post — draft in LAUNCH.md; GIF still to record

## Known ambiguities (document, don't hide)
- A bare trailing integer may still grow in a later chunk (`12` → `123`).
- Trailing whitespace after a complete value does not change the result.
