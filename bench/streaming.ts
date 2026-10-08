/**
 * Streaming throughput: incremental parsing vs. re-parsing the buffer per chunk.
 *
 * Run: `npm run bench:stream`
 *
 * A single JSON document is streamed in small fixed-size chunks. After each
 * chunk, a streaming consumer wants the current best-effort value. We compare:
 *
 *   trickle-json (incremental)   — StreamingJsonParser.write per chunk  [O(n)]
 *   re-parse (parsePartial)      — accumulate buffer, parsePartial each chunk [O(n²)]
 *   re-parse (partial-json)      — accumulate buffer, partial-json each chunk [O(n²)]
 *   jsonriver (incremental)      — native streaming parser               [O(n)]
 *
 * As the document grows, the re-parse approaches blow up quadratically while the
 * incremental parsers scale linearly. That quadratic cost is exactly what the
 * M2 rewrite removed from StreamingJsonParser.
 */
import { createRequire } from "node:module";
import { StreamingJsonParser, parsePartial } from "../src/index.js";

const require = createRequire(import.meta.url);
const partialJson = require("partial-json");

const CHUNK = 32;
const SIZES = [250, 500, 1000, 2000]; // records per document

function makeDoc(records: number): string {
  const items: unknown[] = [];
  for (let i = 0; i < records; i++) {
    items.push({
      id: i,
      name: `item ${i}`,
      price: i * 1.25,
      tags: ["alpha", "beta", "gamma"],
      active: i % 2 === 0,
      note: `a short description for item number ${i}`,
    });
  }
  return JSON.stringify({ items, total: records });
}

function chunkify(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

function streamTrickle(chunks: string[]): unknown {
  const p = new StreamingJsonParser();
  for (const c of chunks) p.write(c);
  return p.end();
}

function streamReparsePartialFn(chunks: string[]): unknown {
  let buf = "";
  let last: unknown;
  for (const c of chunks) {
    buf += c;
    last = parsePartial(buf);
  }
  return last;
}

function streamReparsePartialJson(chunks: string[]): unknown {
  let buf = "";
  let last: unknown;
  for (const c of chunks) {
    buf += c;
    try {
      last = partialJson.parse(buf);
    } catch {
      /* incomplete chunk */
    }
  }
  return last;
}

async function streamJsonriver(chunks: string[]): Promise<unknown> {
  const jsonriver = (await import("jsonriver")) as {
    parse: (s: AsyncIterable<string>) => AsyncIterable<unknown>;
  };
  async function* gen(): AsyncGenerator<string> {
    for (const c of chunks) yield c;
  }
  let last: unknown;
  for await (const v of jsonriver.parse(gen())) last = v;
  return last;
}

async function time(fn: () => unknown | Promise<unknown>, runs = 2): Promise<number> {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : " ".repeat(w - s.length) + s;
}

async function main(): Promise<void> {
  console.log(`\nStreaming a growing document in ${CHUNK}-char chunks (best of 2 runs, ms).\n`);
  console.log(
    `${pad("records", 8)} | ${pad("chars", 8)} | ${pad("chunks", 7)} | ${pad("trickle", 9)} | ${pad("reparse(pp)", 12)} | ${pad("reparse(pj)", 12)} | ${pad("jsonriver", 10)}`,
  );
  console.log("-".repeat(85));

  for (const records of SIZES) {
    const doc = makeDoc(records);
    const chunks = chunkify(doc, CHUNK);

    // Correctness sanity check on the first size.
    if (records === SIZES[0]) {
      const got = streamTrickle(chunks);
      if (JSON.stringify(got) !== doc) throw new Error("trickle-json streaming result mismatch");
    }

    const tTrickle = await time(() => streamTrickle(chunks));
    const tReparsePP = await time(() => streamReparsePartialFn(chunks));
    const tReparsePJ = await time(() => streamReparsePartialJson(chunks));
    const tJsonriver = await time(() => streamJsonriver(chunks));

    console.log(
      `${pad(String(records), 8)} | ${pad(String(doc.length), 8)} | ${pad(String(chunks.length), 7)} | ${pad(tTrickle.toFixed(1), 9)} | ${pad(tReparsePP.toFixed(1), 12)} | ${pad(tReparsePJ.toFixed(1), 12)} | ${pad(tJsonriver.toFixed(1), 10)}`,
    );
  }

  console.log(
    "\ntrickle & jsonriver scale ~linearly with size; the re-parse columns grow ~quadratically.\n" +
      "reparse(pp) = parsePartial re-parse (the pre-M2 StreamingJsonParser strategy); reparse(pj) = partial-json.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
