/**
 * trickle-json/openai — adapters for OpenAI-style streaming responses.
 *
 * Zero runtime dependencies: these accept the shapes the OpenAI SDK yields, or a
 * raw `text/event-stream` body, without importing the SDK.
 */
import { StreamingJsonParser } from "./index.js";
import { parseSSE } from "./sse.js";

export interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: OpenAIToolCallDelta[] };
  }>;
}

/** Extract the incremental `delta.content` text from an OpenAI chunk. */
export function contentDelta(chunk: OpenAIStreamChunk): string {
  return chunk.choices?.[0]?.delta?.content ?? "";
}

/**
 * Parse a raw OpenAI SSE body (e.g. `response.body`) into chunk objects,
 * skipping the `[DONE]` sentinel and any unparseable lines.
 *
 * ```ts
 * const res = await fetch(url, { ... }); // stream: true
 * for await (const value of fromOpenAIStream(openAISSEToChunks(res.body!))) { ... }
 * ```
 */
export async function* openAISSEToChunks(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<OpenAIStreamChunk> {
  for await (const ev of parseSSE(source)) {
    const data = ev.data.trim();
    if (!data || data === "[DONE]") continue;
    try {
      yield JSON.parse(data) as OpenAIStreamChunk;
    } catch {
      /* ignore malformed event */
    }
  }
}

/**
 * Consume an OpenAI chat-completion stream whose concatenated `delta.content`
 * forms a JSON document, yielding the best-effort value after each chunk.
 */
export async function* fromOpenAIStream(
  stream: AsyncIterable<OpenAIStreamChunk>,
): AsyncGenerator<unknown> {
  const parser = new StreamingJsonParser();
  for await (const chunk of stream) {
    const delta = contentDelta(chunk);
    if (delta) yield parser.write(delta);
  }
  yield parser.end();
}

export interface StreamedToolCall {
  index: number;
  id?: string;
  name?: string;
  /** Best-effort parsed arguments so far (partial until the call completes). */
  arguments: unknown;
}

/**
 * Stream OpenAI tool/function calls. Tool-call arguments arrive as a sequence of
 * `function.arguments` string fragments (per tool-call `index`) that together
 * form a JSON object; this yields the current set of tool calls with their
 * arguments parsed best-effort after every update.
 *
 * ```ts
 * for await (const calls of streamOpenAIToolCalls(openAISSEToChunks(res.body!))) {
 *   // calls[0].name, calls[0].arguments (fills in as it streams)
 * }
 * ```
 */
export async function* streamOpenAIToolCalls(
  stream: AsyncIterable<OpenAIStreamChunk>,
): AsyncGenerator<StreamedToolCall[]> {
  const calls = new Map<number, { id?: string; name?: string; parser: StreamingJsonParser }>();

  for await (const chunk of stream) {
    const deltas = chunk.choices?.[0]?.delta?.tool_calls;
    if (!deltas) continue;
    for (const d of deltas) {
      let entry = calls.get(d.index);
      if (!entry) {
        entry = { parser: new StreamingJsonParser() };
        calls.set(d.index, entry);
      }
      if (d.id) entry.id = d.id;
      if (d.function?.name) entry.name = d.function.name;
      if (d.function?.arguments) entry.parser.write(d.function.arguments);
    }
    yield snapshotCalls(calls);
  }
}

function snapshotCalls(
  calls: Map<number, { id?: string; name?: string; parser: StreamingJsonParser }>,
): StreamedToolCall[] {
  return [...calls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, e]) => ({ index, id: e.id, name: e.name, arguments: e.parser.snapshot() }));
}
