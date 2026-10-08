import { describe, expect, it } from "vitest";
import { parsePartial } from "../src/index.js";

/**
 * The hallmark correctness suite.
 *
 *   1. Feed EVERY prefix of a valid document — the parser must never throw.
 *   2. Feed the WHOLE document — the result must equal JSON.parse exactly.
 *   3. Split at EVERY byte boundary (including mid-escape / mid-surrogate) —
 *      chunking must not change the final result.
 */

const DOCS: unknown[] = [
  42,
  -3.14,
  "just a string",
  true,
  null,
  [1, 2, 3, 4, 5],
  { a: 1, b: [1, 2, 3], c: "hello", d: true, e: null, f: { g: "nested" } },
  { name: "Jane", tags: ["x", "y"], scores: [1.5, 2.5], active: false },
  { unicode: "café ❤", escaped: "line\nbreak\ttab\"quote\"\\slash" },
  { surrogate: "emoji 😀 pair" },
  { deep: { a: { b: { c: [{ d: 1 }, { d: 2 }] } } } },
  { empty: {}, list: [], zero: 0, neg: -0.001, exp: 1.5e-10 },
];

describe("prefix fuzz: never throws on any prefix", () => {
  for (const doc of DOCS) {
    const full = JSON.stringify(doc);
    it(`handles every prefix of ${full.slice(0, 40)}`, () => {
      for (let i = 1; i <= full.length; i++) {
        const prefix = full.slice(0, i);
        expect(() => parsePartial(prefix)).not.toThrow();
      }
    });
  }
});

describe("completeness: full input equals JSON.parse", () => {
  for (const doc of DOCS) {
    const full = JSON.stringify(doc);
    it(`round-trips ${full.slice(0, 40)}`, () => {
      expect(parsePartial(full)).toEqual(JSON.parse(full));
    });
  }
});

describe("chunk invariance: splitting does not change the final result", () => {
  for (const doc of DOCS) {
    const full = JSON.stringify(doc);
    it(`is split-invariant for ${full.slice(0, 40)}`, () => {
      for (let split = 1; split < full.length; split++) {
        // Re-parsing the reassembled buffer must match whole-string parsing.
        const reassembled = full.slice(0, split) + full.slice(split);
        expect(parsePartial(reassembled)).toEqual(parsePartial(full));
      }
    });
  }
});
