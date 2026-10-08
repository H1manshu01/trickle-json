/**
 * Wraps each library behind one interface so the harness can treat them
 * identically. Sync libraries expose `parse`; jsonriver (streaming/async)
 * exposes `parseAsync`.
 */
import { createRequire } from "node:module";
import { parsePartial } from "../src/index.js";

const require = createRequire(import.meta.url);

// CJS incumbents — load via createRequire for robust interop.
const partialJson = require("partial-json");
const bestEffort = require("best-effort-json-parser");
const untruncate = require("untruncate-json"); // { default: fn }

// Silence best-effort-json-parser's console error logging during the sweep.
if (typeof bestEffort.disableErrorLogging === "function") bestEffort.disableErrorLogging();

export interface Adapter {
  name: string;
  /** Sync one-shot parse (may throw). */
  parse?: (input: string) => unknown;
  /** Async parse for streaming-only libraries (may throw). */
  parseAsync?: (input: string) => Promise<unknown>;
}

async function* singleChunk(s: string): AsyncGenerator<string> {
  yield s;
}

export async function loadAdapters(): Promise<Adapter[]> {
  // jsonriver is ESM-only — must be imported dynamically.
  const jsonriver = (await import("jsonriver")) as {
    parse: (stream: AsyncIterable<string>) => AsyncIterable<unknown>;
  };

  return [
    { name: "trickle-json", parse: (s) => parsePartial(s) },
    { name: "partial-json", parse: (s) => partialJson.parse(s) },
    { name: "best-effort-json-parser", parse: (s) => bestEffort.parse(s) },
    { name: "untruncate-json", parse: (s) => JSON.parse(untruncate.default(s)) },
    {
      name: "jsonriver",
      parseAsync: async (s) => {
        // jsonriver tolerates incompleteness BETWEEN chunks but throws when the
        // stream ENDS mid-value (like JSON.parse). To compare it fairly on a
        // truncated prefix, keep the last partial value it emitted before that
        // end-of-stream throw; only a throw with no value emitted counts as a
        // real failure.
        const it = jsonriver.parse(singleChunk(s))[Symbol.asyncIterator]();
        let last: unknown;
        let emitted = false;
        for (;;) {
          let step: IteratorResult<unknown>;
          try {
            step = await it.next();
          } catch (err) {
            if (emitted) return last; // truncation after a partial → fair result
            throw err; // genuine parse error before any value
          }
          if (step.done) return last;
          last = step.value;
          emitted = true;
        }
      },
    },
  ];
}
