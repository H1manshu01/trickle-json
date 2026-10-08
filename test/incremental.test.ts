import { describe, expect, it } from "vitest";
import { IncrementalParser, parsePartial } from "../src/index.js";

/**
 * The incremental parser's contract: after feeding any prefix P, `snapshot()`
 * deep-equals `parsePartial(P)`. If this holds for every prefix of every input,
 * the two engines are equivalent — the streaming path is proven correct against
 * the one-shot reference.
 */

const VALID_DOCS: unknown[] = [
  42,
  -3.14,
  true,
  false,
  null,
  "a streamed string",
  [1, 2, 3, 4, 5],
  ["a", "b", "c"],
  { status: "ok", code: 200, cached: false, note: null },
  { name: "search", arguments: { query: "x y z", maxPrice: 199.99, inStock: true } },
  {
    choices: [{ index: 0, message: { role: "assistant", content: "Hello there, world." } }],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  },
  { items: [{ id: 1, tags: ["x", "y"] }, { id: 2, tags: [] }, { id: 3, tags: ["z"] }], total: 3 },
  { text: "line\nbreak\ttab \"q\" \\s", emoji: "café ❤ 😀", nested: { a: { b: { c: 1 } } } },
  { zero: 0, neg: -0.001, exp: 1.5e-10, big: 9007199254740991, arr: [-1, 2.5, 3e2] },
  {},
  [],
  [[], [[]], [1, [2, [3]]]],
];

// Hand-written strings (including awkward partials) parsed as raw JSON text.
const RAW_INPUTS: string[] = [
  "",
  "   ",
  '{"a":1,"b":',
  '{"a":1,"b"',
  '{"a":1,"b":"partial',
  '{"a":1,"b":tru',
  "[1,2,",
  '["x","y',
  '{"items":[{"id":1},{"id":',
  '{"a":1 "b":2}', // missing comma before next key
  "[1 2 3]", // arrays tolerate missing commas
  '{"a":1,}', // trailing comma
  "[1,2,]", // trailing comma
  '{"a":}', // value dropped
  '{"n":-',
  '{"n":1.5e-',
  '{"deep":{"a":{"b":',
  '  {"ws":  [ 1 ,  2  ] }  ',
];

describe("incremental parser equals parsePartial for every prefix", () => {
  const inputs = [...VALID_DOCS.map((d) => JSON.stringify(d)), ...RAW_INPUTS];
  for (const full of inputs) {
    it(`matches on every prefix of ${JSON.stringify(full).slice(0, 44)}`, () => {
      for (let i = 0; i <= full.length; i++) {
        const prefix = full.slice(0, i);
        const p = new IncrementalParser();
        p.writeChunk(prefix);
        expect(p.snapshot()).toEqual(parsePartial(prefix));
      }
    });
  }
});

describe("incremental parser is chunk-invariant", () => {
  const inputs = VALID_DOCS.map((d) => JSON.stringify(d));
  for (const full of inputs) {
    it(`is independent of split point for ${full.slice(0, 40)}`, () => {
      const whole = new IncrementalParser();
      whole.writeChunk(full);
      const expected = whole.snapshot();

      for (let split = 1; split < full.length; split++) {
        const p = new IncrementalParser();
        p.writeChunk(full.slice(0, split));
        p.writeChunk(full.slice(split));
        expect(p.snapshot()).toEqual(expected);
      }

      // Char-by-char must also reach the same final value.
      const perChar = new IncrementalParser();
      for (const ch of full) perChar.writeChunk(ch);
      expect(perChar.snapshot()).toEqual(expected);
      expect(perChar.snapshot()).toEqual(JSON.parse(full));
    });
  }
});
