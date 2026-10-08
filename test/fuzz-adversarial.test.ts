import { describe, expect, it } from "vitest";
import { IncrementalParser, StreamingJsonParser, parsePartial } from "../src/index.js";

/**
 * Hardening: the never-throw guarantee must hold for *any* input, not just
 * truncated-but-valid JSON. And on randomly generated valid JSON, the streaming
 * engine must stay exactly equivalent to the one-shot reference.
 */

const ADVERSARIAL: string[] = [
  "",
  " \n\t\r ",
  "{",
  "}",
  "[",
  "]",
  "[[[[[[[[[[[[[[[[[[[[",
  "{{{{{{{{{{",
  "]]]]]]]]]]",
  "}}}}}}}}}}",
  '{"a":}',
  '{"a"}',
  '{:"a"}',
  "{,}",
  "[,,,,]",
  '{"a":1}}}}}}',
  "[1,2,3]]]]]",
  '{"a":"b""c":"d"}',
  '{"unterminated string',
  '"lone backslash \\',
  '"bad escape \\x41"',
  '"incomplete unicode \\u00"',
  '"half surrogate \\ud83d"',
  "-",
  "-.",
  "1.",
  "1e",
  "1e-",
  "1.2.3.4",
  "- 5",
  "NaN",
  "Infinity",
  "undefined",
  "truefalse",
  "nul",
  "tru",
  "\u0000\u0001\u0002 control chars",
  '﻿{"bom":1}',
  "😀🎉 emoji only",
  '{"deeply":{"nested":{"but":{"never":{"closed":',
  '[{"a":[{"b":[{"c":',
  "}{][}{][",
  '{"a":1,,,,"b":2}',
  "[1 2 3 4 5]",
  '{"num":123456789012345678901234567890}',
  '{"x":1e999}',
  "null null null",
  "42 is the answer",
  JSON.stringify({ a: "x".repeat(500), b: [1, 2, 3] }).slice(0, 137),
];

describe("never throws on adversarial input", () => {
  for (const input of ADVERSARIAL) {
    const label = JSON.stringify(input).slice(0, 40);
    it(`parsePartial + incremental survive ${label}`, () => {
      // one-shot
      expect(() => parsePartial(input)).not.toThrow();
      // every prefix, one-shot
      for (let i = 0; i <= input.length; i++) {
        expect(() => parsePartial(input.slice(0, i))).not.toThrow();
      }
      // char-by-char incremental
      expect(() => {
        const p = new IncrementalParser();
        for (const ch of input) p.writeChunk(ch);
        p.snapshot();
      }).not.toThrow();
      // whole-chunk streaming
      expect(() => {
        const s = new StreamingJsonParser();
        s.write(input);
        s.end();
      }).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Property test: random valid JSON → streaming equals one-shot on every prefix.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYS = ["id", "name", "tags", "price", "active", "meta", "items", "note", "x", "y"];
const STRINGS = ["hi", "a b c", 'q"q', "line\nbreak", "café ❤", "😀", "", "slash/\\"];

function randomJson(rng: () => number, depth: number): unknown {
  const r = rng();
  if (depth <= 0) {
    // leaf
    if (r < 0.3) return STRINGS[Math.floor(rng() * STRINGS.length)];
    if (r < 0.5) return Math.floor(rng() * 2000) - 1000;
    if (r < 0.65) return (rng() * 2000 - 1000) / 7; // decimals
    if (r < 0.75) return rng() * 1e6 * (rng() < 0.5 ? 1 : -1); // big/exp-ish
    if (r < 0.85) return rng() < 0.5;
    return null;
  }
  if (r < 0.45) {
    const n = Math.floor(rng() * 5);
    const arr: unknown[] = [];
    for (let i = 0; i < n; i++) arr.push(randomJson(rng, depth - 1));
    return arr;
  }
  if (r < 0.9) {
    const n = Math.floor(rng() * 5);
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < n; i++) {
      const k = KEYS[Math.floor(rng() * KEYS.length)]!;
      obj[k] = randomJson(rng, depth - 1);
    }
    return obj;
  }
  return randomJson(rng, 0);
}

describe("property: incremental equals parsePartial on random valid JSON", () => {
  it("holds for every prefix of 200 random documents", () => {
    const rng = mulberry32(0xc0ffee);
    for (let d = 0; d < 200; d++) {
      const doc = randomJson(rng, 4);
      const full = JSON.stringify(doc);
      for (let i = 0; i <= full.length; i++) {
        const prefix = full.slice(0, i);
        const p = new IncrementalParser();
        p.writeChunk(prefix);
        expect(p.snapshot()).toEqual(parsePartial(prefix));
      }
      // Complete document round-trips exactly.
      const whole = new IncrementalParser();
      whole.writeChunk(full);
      expect(whole.snapshot()).toEqual(JSON.parse(full));
    }
  });

  it("is invariant to random chunk splits", () => {
    const rng = mulberry32(0x1234abcd);
    for (let d = 0; d < 200; d++) {
      const full = JSON.stringify(randomJson(rng, 4));
      if (full.length < 2) continue;
      const nSplits = 1 + Math.floor(rng() * 4);
      const points = new Set<number>();
      for (let s = 0; s < nSplits; s++) points.add(1 + Math.floor(rng() * (full.length - 1)));
      const sorted = [...points].sort((a, b) => a - b);
      const parser = new IncrementalParser();
      let prev = 0;
      for (const pt of sorted) {
        parser.writeChunk(full.slice(prev, pt));
        prev = pt;
      }
      parser.writeChunk(full.slice(prev));
      expect(parser.snapshot()).toEqual(JSON.parse(full));
    }
  });
});
