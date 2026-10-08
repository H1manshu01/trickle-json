# Benchmarks

Reproduce: `npm run bench` (source: [`bench/`](./bench)).

The harness feeds **every prefix of every document** in [`bench/corpus.ts`](./bench/corpus.ts)
to each parser — simulating a JSON value arriving one character at a time — and
measures correctness and throughput.

## Metrics

| Metric | Meaning |
|---|---|
| **throws%** | Share of truncated prefixes that throw. The core pain point: `JSON.parse` throws on *every* incomplete chunk. Lower is better. |
| **final✓** | Parses the *complete* document to a value deep-equal to `JSON.parse`. Must be 100%. |
| **consistent%** | Of non-throwing prefixes, the share whose output is *prefix-consistent* with the final value — contains no key/value that is not a genuine prefix of the truth (no invented/guessed data). Higher is better. |
| **empty("")** | What the parser returns for empty input. |
| **prefixes/sec** | Sync one-shot throughput over the full sweep. Higher is better. |

`consistent%` is not 100% for any parser because a number truncated mid-exponent
(e.g. `1.5e-1` as a prefix of `1.5e-10`) transiently parses to a different number
(`0.15`). This ambiguity is shared by every snapshot parser.

## Results snapshot

> Reproducible snapshot — **not** a standing guarantee. Re-run `npm run bench`
> on your own machine before citing these numbers anywhere public.
> Environment: Node v24, Apple M1 (8 cores), 2026-10-08.
> Competitor versions: `partial-json@0.1.7`, `best-effort-json-parser@1.5.1`,
> `untruncate-json@0.0.1`, `jsonriver@1.1.1`.

### Correctness

| parser | throws% | final✓ | consistent% | empty("") |
|---|:---:|:---:|:---:|:---:|
| **trickle-json** | **0.0%** | 13/13 | 99.3% | `undefined` |
| partial-json | 0.3% | 13/13 | 99.4% | throws |
| best-effort-json-parser | 0.0% | 13/13 | **69.2%** | `""` |
| untruncate-json | 0.0% | 13/13 | 99.0% | throws |
| jsonriver | 1.1% | 13/13 | 99.4% | throws |

### Throughput (sync parsers)

| parser | prefixes/sec | relative |
|---|---:|:---:|
| **trickle-json** | ~1,500,000 | 1.00× |
| untruncate-json | ~833,000 | 0.56× |
| partial-json | ~191,000 | 0.13× |
| best-effort-json-parser | ~139,000 | 0.09× |

`jsonriver` is a streaming/async API, so it is excluded from sync one-shot
throughput (its adapter is wrapped to be fair on the correctness sweep — see
[`bench/adapters.ts`](./bench/adapters.ts)).

### Streaming throughput — `npm run bench:stream`

A single document is streamed in 32-char chunks; after each chunk the consumer
reads the current value. This is the workload `StreamingJsonParser` is built for.
The incremental engine processes each character once (O(n) total); re-parsing the
accumulated buffer on every chunk is O(n²).

| records | chars | chunks | trickle (incr.) | re-parse (parsePartial) | re-parse (partial-json) | jsonriver |
|---:|---:|---:|---:|---:|---:|---:|
| 250 | 34,229 | 1,070 | **1.0 ms** | 182 ms | 297 ms | 2.3 ms |
| 500 | 68,855 | 2,152 | **1.4 ms** | 740 ms | 1,184 ms | 2.9 ms |
| 1,000 | 138,306 | 4,323 | **2.9 ms** | 2,927 ms | 4,753 ms | 5.1 ms |
| 2,000 | 280,806 | 8,776 | **5.7 ms** | 12,347 ms | 21,430 ms | 9.0 ms |

trickle-json and jsonriver scale ~linearly; both re-parse columns grow
~quadratically. At 2,000 records the incremental engine is **~2,150× faster**
than re-parsing with `parsePartial` on every chunk — which is exactly the
pre-M2 `StreamingJsonParser` strategy this rewrite replaced.

## How to read this

- **trickle-json is the only parser that never throws on truncation *and* returns
  `undefined` (not an exception) on empty input** — so it is safe to call on
  every streamed chunk without a `try/catch`.
- It is the **fastest sync partial parser** in this set by a wide margin.
- Its prefix-consistency sits with the best; `best-effort-json-parser` is notably
  lower because it aggressively completes partial tokens, which surfaces data the
  final value does not support.
