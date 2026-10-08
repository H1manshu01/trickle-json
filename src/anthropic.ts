/**
 * trickle-json/anthropic — adapters for Anthropic (Claude) streaming responses.
 *
 * Zero runtime dependencies: these accept the event shapes the Anthropic SDK
 * yields, or a raw `text/event-stream` body, without importing the SDK.
 */
import { StreamingJsonParser } from "./index.js";
import { parseSSE } from "./sse.js";

export interface AnthropicStreamEvent {
  type?: string;
  index?: number;
  delta?: { type?: string; text?: string; partial_json?: string };
  content_block?: { type?: string; id?: string; name?: string };
}

/** Extract incremental text from an Anthropic `content_block_delta` (text) event. */
export function textDelta(event: AnthropicStreamEvent): string {
  if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
    return event.delta.text ?? "";
  }
  return "";
}

/** Parse a raw Anthropic SSE body into event objects, skipping unparseable lines. */
export async function* anthropicSSEToEvents(
  source: AsyncIterable<string | Uint8Array>,
): AsyncGenerator<AnthropicStreamEvent> {
  for await (const ev of parseSSE(source)) {
    const data = ev.data.trim();
    if (!data) continue;
    try {
      yield JSON.parse(data) as AnthropicStreamEvent;
    } catch {
      /* ignore malformed event */
    }
  }
}

/**
 * Consume an Anthropic message stream whose concatenated text deltas form a
 * JSON document, yielding the best-effort value after each event.
 */
export async function* fromAnthropicStream(
  stream: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<unknown> {
  const parser = new StreamingJsonParser();
  for await (const event of stream) {
    const delta = textDelta(event);
    if (delta) yield parser.write(delta);
  }
  yield parser.end();
}

export interface StreamedToolInput {
  index: number;
  id?: string;
  name?: string;
  /** Best-effort parsed tool input so far (partial until the block completes). */
  input: unknown;
}

/**
 * Stream Anthropic tool-use input. A `tool_use` content block opens with
 * `content_block_start`, then its JSON input arrives as `input_json_delta`
 * fragments (`delta.partial_json`) that together form the input object. This
 * yields the current set of tool-use blocks with inputs parsed best-effort.
 *
 * ```ts
 * for await (const tools of streamAnthropicToolInput(anthropicSSEToEvents(res.body!))) {
 *   // tools[0].name, tools[0].input (fills in as it streams)
 * }
 * ```
 */
export async function* streamAnthropicToolInput(
  stream: AsyncIterable<AnthropicStreamEvent>,
): AsyncGenerator<StreamedToolInput[]> {
  const blocks = new Map<number, { id?: string; name?: string; parser: StreamingJsonParser }>();

  for await (const ev of stream) {
    if (ev.index === undefined) continue;
    if (ev.type === "content_block_start" && ev.content_block?.type === "tool_use") {
      blocks.set(ev.index, {
        id: ev.content_block.id,
        name: ev.content_block.name,
        parser: new StreamingJsonParser(),
      });
    } else if (ev.type === "content_block_delta" && ev.delta?.type === "input_json_delta") {
      const b = blocks.get(ev.index);
      if (b && ev.delta.partial_json) b.parser.write(ev.delta.partial_json);
    } else {
      continue;
    }
    yield snapshotBlocks(blocks);
  }
}

function snapshotBlocks(
  blocks: Map<number, { id?: string; name?: string; parser: StreamingJsonParser }>,
): StreamedToolInput[] {
  return [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([index, b]) => ({ index, id: b.id, name: b.name, input: b.parser.snapshot() }));
}
