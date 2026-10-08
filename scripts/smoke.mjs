// Cross-runtime smoke test against the BUILT output (dist/).
// Runs under both Node and Bun to confirm the published package loads and works.
import assert from "node:assert/strict";
import { anthropicSSEToEvents, streamAnthropicToolInput } from "../dist/anthropic.js";
import { StreamingJsonParser, parsePartial } from "../dist/index.js";
import { openAISSEToChunks, streamOpenAIToolCalls } from "../dist/openai.js";
import { parsePartialTyped } from "../dist/zod.js";

// Core one-shot
assert.deepEqual(parsePartial('{"a":1,"b":[1,2'), { a: 1, b: [1, 2] });
assert.equal(parsePartial(""), undefined);

// Streaming + snapshot
const p = new StreamingJsonParser();
p.write('{"x":"he');
assert.deepEqual(p.snapshot(), { x: "he" });
assert.deepEqual(p.write('llo"}'), { x: "hello" });
assert.deepEqual(p.end(), { x: "hello" });

// Typed partial
assert.deepEqual(parsePartialTyped('{"n":4'), { n: 4 });

// Adapters are exported and callable
for (const fn of [
  openAISSEToChunks,
  streamOpenAIToolCalls,
  anthropicSSEToEvents,
  streamAnthropicToolInput,
]) {
  assert.equal(typeof fn, "function");
}

console.log(`smoke ok (${typeof Bun !== "undefined" ? "bun" : "node"})`);
