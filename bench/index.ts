/**
 * Benchmark harness: trickle-json vs. the incumbents.
 *
 * Run: `npm run bench`
 *
 * Measures two things on the shared corpus (bench/corpus.ts):
 *
 *   CORRECTNESS (per parser, aggregated over every prefix of every doc)
 *     - throws%      : share of prefixes that throw. The core pain point —
 *                      JSON.parse throws on every truncated chunk; a streaming
 *                      parser should throw on ~none.
 *     - final✓       : parses the COMPLETE document to a value deep-equal to
 *                      JSON.parse (must be 100%).
 *     - consistent%  : of non-throwing prefixes, the share whose output is
 *                      "prefix-consistent" with the final value — i.e. contains
 *                      no key/value that is not a genuine prefix of the truth
 *                      (no hallucinated/guessed data). Methodology below.
 *     - empty("")    : what the parser returns for empty input.
 *
 *   THROUGHPUT (sync parsers only; jsonriver is async/streaming → n/a)
 *     - prefixes parsed per second over the full sweep.
 *
 * NOTE: competitor APIs are used at their documented defaults. Re-verify these
 * numbers yourself before publishing any comparison — do not ship claims you
 * have not independently reproduced.
 */
import { type Adapter, loadAdapters } from "./adapters.js";
import { DOCS } from "./corpus.js";

interface RunResult {
  value: unknown;
  threw: boolean;
}

async function runAdapter(a: Adapter, s: string): Promise<RunResult> {
  try {
    const value = a.parse ? a.parse(s) : await a.parseAsync?.(s);
    return { value, threw: false };
  } catch {
    return { value: undefined, threw: true };
  }
}

/**
 * Is `partial` a prefix-consistent view of `truth`? I.e. everything present in
 * `partial` is a genuine (possibly-truncated) part of `truth`, with nothing
 * invented. `undefined` makes no claim and is always consistent.
 */
function consistent(partial: unknown, truth: unknown): boolean {
  if (partial === undefined) return true;
  if (partial === null) return truth === null;
  const t = typeof partial;
  if (t === "boolean") return partial === truth;
  if (t === "number") {
    if (partial === truth) return true;
    // A truncated number is a decimal-string prefix of the real one (12 → 123).
    return typeof truth === "number" && String(truth).startsWith(String(partial));
  }
  if (t === "string") {
    return typeof truth === "string" && truth.startsWith(partial as string);
  }
  if (Array.isArray(partial)) {
    if (!Array.isArray(truth) || partial.length > truth.length) return false;
    return partial.every((el, i) => consistent(el, truth[i]));
  }
  if (t === "object") {
    if (truth === null || typeof truth !== "object" || Array.isArray(truth)) return false;
    const tObj = truth as Record<string, unknown>;
    for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
      if (!(k in tObj)) return false; // hallucinated key
      if (!consistent(v, tObj[k])) return false;
    }
    return true;
  }
  return false;
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "undefined";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

interface Correctness {
  name: string;
  prefixes: number;
  threw: number;
  inconsistent: number;
  nonThrowing: number;
  finalOk: number;
  emptyBehavior: string;
}

async function measureCorrectness(adapters: Adapter[]): Promise<Correctness[]> {
  const docs = DOCS.map((d) => ({ full: JSON.stringify(d), truthCanon: canonical(d) }));
  const out: Correctness[] = [];

  for (const a of adapters) {
    const c: Correctness = {
      name: a.name,
      prefixes: 0,
      threw: 0,
      inconsistent: 0,
      nonThrowing: 0,
      finalOk: 0,
      emptyBehavior: "",
    };

    // Empty-input behavior.
    const empty = await runAdapter(a, "");
    c.emptyBehavior = empty.threw ? "throws" : (JSON.stringify(empty.value) ?? "undefined");

    for (const { full, truthCanon } of docs) {
      const truth = JSON.parse(full);
      for (let i = 1; i <= full.length; i++) {
        const res = await runAdapter(a, full.slice(0, i));
        c.prefixes++;
        if (res.threw) {
          c.threw++;
        } else {
          c.nonThrowing++;
          if (!consistent(res.value, truth)) c.inconsistent++;
        }
      }
      // Final (complete) correctness.
      const finalRes = await runAdapter(a, full);
      if (!finalRes.threw && canonical(finalRes.value) === truthCanon) c.finalOk++;
    }

    out.push(c);
  }
  return out;
}

function measureThroughput(adapters: Adapter[], iters: number): Map<string, number> {
  const workload: string[] = [];
  for (const d of DOCS) {
    const full = JSON.stringify(d);
    for (let i = 1; i <= full.length; i++) workload.push(full.slice(0, i));
  }

  const result = new Map<string, number>();
  for (const a of adapters) {
    if (!a.parse) continue; // sync-only measurement
    // Warmup.
    for (const s of workload) {
      try {
        a.parse(s);
      } catch {}
    }
    const start = performance.now();
    let ops = 0;
    for (let it = 0; it < iters; it++) {
      for (const s of workload) {
        try {
          a.parse(s);
        } catch {}
        ops++;
      }
    }
    const ms = performance.now() - start;
    result.set(a.name, ops / (ms / 1000));
  }
  return result;
}

function pct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function pad(s: string, w: number): string {
  return s.length >= w ? s : s + " ".repeat(w - s.length);
}

async function main(): Promise<void> {
  const adapters = await loadAdapters();
  const totalDocs = DOCS.length;

  console.log("\n=== CORRECTNESS (every prefix of every doc) ===\n");
  const correctness = await measureCorrectness(adapters);

  const headers = ["parser", "throws%", "final✓", "consistent%", 'empty("")'];
  const widths = [24, 9, 8, 13, 12];
  console.log(headers.map((h, i) => pad(h, widths[i]!)).join("| "));
  console.log(widths.map((w) => "-".repeat(w)).join("+-"));
  for (const c of correctness) {
    const row = [
      c.name,
      pct(c.threw, c.prefixes),
      `${c.finalOk}/${totalDocs}`,
      pct(c.nonThrowing - c.inconsistent, c.nonThrowing),
      c.emptyBehavior.slice(0, 11),
    ];
    console.log(row.map((v, i) => pad(v, widths[i]!)).join("| "));
  }

  console.log("\n=== THROUGHPUT (sync parsers; higher is better) ===\n");
  const iters = 300;
  const tp = measureThroughput(adapters, iters);
  const sorted = [...tp.entries()].sort((a, b) => b[1] - a[1]);
  const fastest = sorted[0]?.[1] ?? 1;
  console.log(`${pad("parser", 24)}| ${pad("prefixes/sec", 16)}| relative`);
  console.log(`${"-".repeat(24)}+-${"-".repeat(16)}+---------`);
  for (const [name, ops] of sorted) {
    const rel = `${(ops / fastest).toFixed(2)}x`;
    console.log(`${pad(name, 24)}| ${pad(Math.round(ops).toLocaleString(), 16)}| ${rel}`);
  }
  console.log(
    "\njsonriver: n/a (streaming/async API — not comparable on sync one-shot throughput)\n",
  );
  console.log(
    "Methodology: see the header comment in bench/index.ts. Re-verify before publishing.\n",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
