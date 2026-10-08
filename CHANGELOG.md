# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-10-08

### Changed
- Stop shipping source maps in the published tarball — package size dropped from
  ~52 kB to ~22 kB (unpacked ~232 kB → ~84 kB). No API or behavior changes.

### Added
- README: animated demo and status badges (npm version, CI, bundle size,
  provenance, license).

## [0.1.0] - 2026-10-08

Initial public release.

### Added
- `parsePartial(input)` — one-shot best-effort parser for truncated JSON; never
  throws on truncation, returns `undefined` for empty input.
- `StreamingJsonParser` — true incremental streaming parser (O(n) total across
  chunks) with:
  - `snapshot` events and a `snapshot()` accessor,
  - `path` subscriptions with `*` wildcards and reported concrete `segments`,
  - `append` events (one per array element as it appears),
  - `{ once }` option and an `Unsubscribe` return from every `on(...)`.
- `IncrementalParser` — the low-level resumable engine (exported).
- `getPath(obj, path)` helper.
- `trickle-json/openai` — `openAISSEToChunks` (raw SSE), `fromOpenAIStream`,
  `streamOpenAIToolCalls` (tool-call argument streaming).
- `trickle-json/anthropic` — `anthropicSSEToEvents` (raw SSE),
  `fromAnthropicStream`, `streamAnthropicToolInput` (tool-use input streaming).
- `trickle-json/zod` — `parsePartialTyped<T>`, `TypedStreamingParser<T>`,
  `DeepPartial<T>`, and `parsePartialZod` validation.
- Benchmark harness (`npm run bench`, `npm run bench:stream`) comparing against
  `partial-json`, `best-effort-json-parser`, `untruncate-json`, and `jsonriver`.

### Verified
- Incremental parser is equivalent to `parsePartial` on every prefix of a broad
  corpus, hand-written partials, and 200 randomly generated documents.
- Never-throw guarantee holds on an adversarial/invalid-input corpus.
- ESM + CJS builds, type declarations, and a ~2.6 kB brotlied core.

[0.1.1]: https://github.com/H1manshu01/trickle-json/releases/tag/v0.1.1
[0.1.0]: https://github.com/H1manshu01/trickle-json/releases/tag/v0.1.0
