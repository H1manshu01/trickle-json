import { describe, expect, it } from "vitest";
import {
  type AnthropicStreamEvent,
  anthropicSSEToEvents,
  fromAnthropicStream,
  streamAnthropicToolInput,
} from "../src/anthropic.js";
import {
  type OpenAIStreamChunk,
  fromOpenAIStream,
  openAISSEToChunks,
  streamOpenAIToolCalls,
} from "../src/openai.js";
import { parsePartialZod } from "../src/zod.js";

/** Yield a string as fixed-size chunks (as strings). */
async function* chunks(s: string, size: number): AsyncGenerator<string> {
  for (let i = 0; i < s.length; i += size) yield s.slice(i, i + size);
}

/** Yield a string as UTF-8 byte chunks, to exercise the TextDecoder path. */
async function* byteChunks(s: string, size: number): AsyncGenerator<Uint8Array> {
  const bytes = new TextEncoder().encode(s);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}

async function last<T>(gen: AsyncIterable<T>): Promise<T | undefined> {
  let v: T | undefined;
  for await (const x of gen) v = x;
  return v;
}

const OPENAI_CONTENT_SSE = [
  'data: {"choices":[{"delta":{"content":"{\\"ci"}}]}',
  "",
  'data: {"choices":[{"delta":{"content":"ty\\":\\"Paris\\",\\"ok\\":true}"}}]}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

const OPENAI_TOOL_SSE = [
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"lo"}}]}}]}',
  "",
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"cation\\":\\"NYC\\"}"}}]}}]}',
  "",
  "data: [DONE]",
  "",
  "",
].join("\n");

const ANTHROPIC_TOOL_SSE = [
  "event: content_block_start",
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{}}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"location\\":"}}',
  "",
  "event: content_block_delta",
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"NYC\\"}"}}',
  "",
  "event: content_block_stop",
  'data: {"type":"content_block_stop","index":0}',
  "",
  "",
].join("\n");

describe("SSE parsing is robust to chunk boundaries", () => {
  it("parses OpenAI content SSE split at every size", async () => {
    for (const size of [1, 3, 7, 50, 10000]) {
      const final = await last(fromOpenAIStream(openAISSEToChunks(chunks(OPENAI_CONTENT_SSE, size))));
      expect(final).toEqual({ city: "Paris", ok: true });
    }
  });

  it("handles UTF-8 split across byte-chunk boundaries", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"{\\"msg\\":\\"café ❤ 😀\\"}"}}]}\n\ndata: [DONE]\n\n';
    const final = await last(fromOpenAIStream(openAISSEToChunks(byteChunks(sse, 2))));
    expect(final).toEqual({ msg: "café ❤ 😀" });
  });
});

describe("OpenAI tool-call argument streaming", () => {
  it("accumulates arguments per tool call and parses them", async () => {
    const final = await last(streamOpenAIToolCalls(openAISSEToChunks(chunks(OPENAI_TOOL_SSE, 5))));
    expect(final).toEqual([
      { index: 0, id: "call_1", name: "get_weather", arguments: { location: "NYC" } },
    ]);
  });

  it("exposes partial arguments mid-stream", async () => {
    const snapshots: unknown[] = [];
    for await (const calls of streamOpenAIToolCalls(openAISSEToChunks(chunks(OPENAI_TOOL_SSE, 5)))) {
      snapshots.push(JSON.parse(JSON.stringify(calls)));
    }
    // First update has only the partial "{" worth of arguments.
    expect((snapshots[0] as Array<{ arguments: unknown }>)[0]!.arguments).toEqual({});
    expect((snapshots.at(-1) as Array<{ arguments: unknown }>)[0]!.arguments).toEqual({
      location: "NYC",
    });
  });
});

describe("Anthropic adapters", () => {
  it("streams text deltas into a JSON value", async () => {
    const events: AnthropicStreamEvent[] = [
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"a":' } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "[1,2," } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "3]}" } },
    ];
    async function* gen() {
      for (const e of events) yield e;
    }
    expect(await last(fromAnthropicStream(gen()))).toEqual({ a: [1, 2, 3] });
  });

  it("streams tool-use input via input_json_delta", async () => {
    const final = await last(
      streamAnthropicToolInput(anthropicSSEToEvents(chunks(ANTHROPIC_TOOL_SSE, 4))),
    );
    expect(final).toEqual([
      { index: 0, id: "toolu_1", name: "get_weather", input: { location: "NYC" } },
    ]);
  });
});

describe("zod validation", () => {
  it("returns raw always and data once it validates", () => {
    const schema = {
      safeParse(data: unknown) {
        const d = data as { a?: unknown };
        return typeof d?.a === "number"
          ? { success: true as const, data: d as { a: number } }
          : { success: false as const };
      },
    };
    expect(parsePartialZod('{"a":', schema)).toEqual({ raw: {}, data: undefined, valid: false });
    expect(parsePartialZod('{"a":42}', schema)).toEqual({
      raw: { a: 42 },
      data: { a: 42 },
      valid: true,
    });
  });
});

// Ensure exported chunk types are usable (compile-time check).
const _typecheck: OpenAIStreamChunk = { choices: [{ delta: { content: "x" } }] };
void _typecheck;
