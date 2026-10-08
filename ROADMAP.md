# Roadmap

Ship `M1 + M2` as **v0.1** early — it is already competitive.

## M1 — Core one-shot parser ✅ (scaffolded)
- [x] `parsePartial(string)` incremental tokenizer + pushdown parser
- [x] Correct on every truncation point (prefix-fuzz suite)
- [x] Never throws on truncated input

## M2 — Streaming ✅ (scaffolded, v0.1 strategy)
- [x] `StreamingJsonParser` with chunk accumulation + `snapshot` events
- [ ] True incremental parsing (reuse work across chunks instead of re-parsing
      the whole buffer — O(n) total instead of O(n²)). Current approach is
      correct but re-parses on each `write`.

## M3 — Subscriptions
- [x] Path matching (`a.b[0].c`)
- [ ] Wildcards (`items[*].id`) and array-append events
- [ ] `once` / unsubscribe handles

## M4 — Typed + adapters
- [ ] `trickle-json/zod`: emit typed *partial* snapshots (schema-aware), not just
      post-hoc validation
- [ ] `trickle-json/openai`: raw `text/event-stream` SSE parsing + tool-call
      argument streams (`arguments` deltas)
- [ ] `trickle-json/anthropic`: tool-use `input_json_delta` streaming

## M5 — Harden & launch
- [ ] Expand fuzz corpus; add adversarial/invalid-input tests (must stay
      best-effort, never throw)
- [ ] Published comparison benchmark vs. incumbents (re-verify every table claim)
- [ ] CI matrix (Node 18/20/22, Bun) + `size-limit` gate
- [ ] npm publish with `--provenance`
- [ ] README demo gif + launch post ("partial-json has 35M downloads/mo and
      hasn't shipped since 2024")

## Known ambiguities (document, don't hide)
- A bare trailing integer may still grow in a later chunk (`12` → `123`).
- Trailing whitespace after a complete value does not change the result.
