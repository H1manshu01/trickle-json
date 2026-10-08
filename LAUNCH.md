# Launch notes (draft)

Internal checklist + copy for announcing `trickle-json`. Not published to npm
(`files` ships only `dist`).

## Pre-flight
- [ ] Re-run `npm run bench` and `npm run bench:stream`; update BENCHMARKS.md numbers.
- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run size && npm run smoke` all green.
- [ ] Add `NPM_TOKEN` (Automation token) to GitHub repo → Settings → Secrets → Actions.
- [ ] Record a short demo GIF of a list streaming in; drop it near the top of the README.
- [ ] Tag the release: `git tag v0.1.0 && git push origin v0.1.0` (CI publishes with provenance).

## The hook
> `partial-json` has ~35M downloads/month and hasn't shipped a release since
> May 2024 (still on `0.1.x`). The better-designed approaches — true incremental
> parsing, path subscriptions, schema typing, provider adapters — are scattered
> across tiny single-purpose packages. `trickle-json` brings them together in one
> actively maintained, zero-dependency library.

## Show HN / dev.to opener (draft)
**Title:** trickle-json — parse streaming LLM JSON without `try/catch` on every token

When a model streams JSON, `JSON.parse` throws on every chunk until the last
token. `trickle-json` returns the best valid value available right now, on every
chunk, and never throws on truncation.

- One-shot: `parsePartial('{"user":{"name":"Ja')` → `{ user: { name: "Ja" } }`
- Streaming: progressive snapshots, `path` subscriptions with wildcards, and
  `append` events for lists filling in.
- True incremental engine: O(n) across chunks (≈2,150× faster than re-parsing
  the buffer each chunk at 2k records), ~2.6 kB, zero runtime deps.
- Adapters for OpenAI/Anthropic SSE, including tool-call argument streaming.

Benchmarks (reproducible) and the full comparison table: [BENCHMARKS.md].

## Places to post
- Hacker News (Show HN), r/javascript, r/LocalLLaMA, dev.to, X/Bluesky.
- Open friendly issues/PRs where people hit streaming-JSON pain, linking the repo.
- Submit to relevant awesome-lists (awesome-nodejs, awesome LLM tooling).

[BENCHMARKS.md]: ./BENCHMARKS.md
