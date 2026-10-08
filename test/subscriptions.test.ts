import { describe, expect, it } from "vitest";
import { StreamingJsonParser } from "../src/index.js";

function chunkify(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

describe("wildcard path subscriptions", () => {
  it("fires for every array element and reports concrete segments", () => {
    const full = '{"items":[{"id":1},{"id":2},{"id":3}]}';
    const p = new StreamingJsonParser();
    const hits: Array<{ segments: Array<string | number>; value: unknown }> = [];
    p.on("path", "items[*].id", (value, segments) => hits.push({ segments, value }));
    for (const ch of chunkify(full, 3)) p.write(ch);
    p.end();

    const final = hits.filter((h) => h.segments[1] !== undefined);
    // Last reported value for each index should be the final id.
    const byIndex = new Map<number, unknown>();
    for (const h of final) byIndex.set(h.segments[1] as number, h.value);
    expect(byIndex.get(0)).toBe(1);
    expect(byIndex.get(1)).toBe(2);
    expect(byIndex.get(2)).toBe(3);
    // Segments carry the full concrete path.
    expect(hits.some((h) => JSON.stringify(h.segments) === '["items",1,"id"]')).toBe(true);
  });

  it("supports a wildcard over object keys", () => {
    const full = '{"users":{"a":{"age":30},"b":{"age":40}}}';
    const p = feedWithListener(full, "users.*.age");
    expect(p.values.sort()).toEqual([30, 40]);
  });

  function feedWithListener(full: string, path: string) {
    const parser = new StreamingJsonParser();
    const values: unknown[] = [];
    const seen = new Set<string>();
    parser.on("path", path, (value, segments) => {
      const k = JSON.stringify(segments);
      // keep only the last value per concrete path
      seen.add(k);
      const i = [...seen].indexOf(k);
      values[i] = value;
    });
    for (const ch of chunkify(full, 4)) parser.write(ch);
    parser.end();
    return { values };
  }
});

describe("append events", () => {
  it("fires once per element as a list streams in, with the index", () => {
    const full = '{"items":[{"id":1,"t":"a"},{"id":2,"t":"b"},{"id":3,"t":"c"}]}';
    const p = new StreamingJsonParser();
    const appended: number[] = [];
    p.on("append", "items", (_item, index) => appended.push(index));
    for (const ch of chunkify(full, 2)) p.write(ch);
    p.end();
    // Each index appears exactly once, in order.
    expect(appended).toEqual([0, 1, 2]);
  });

  it("passes the item reference and concrete segments", () => {
    const full = '{"items":["x","y"]}';
    const p = new StreamingJsonParser();
    const events: Array<[unknown, number, Array<string | number>]> = [];
    p.on("append", "items", (item, index, segments) => events.push([item, index, segments]));
    for (const ch of chunkify(full, 1)) p.write(ch);
    p.end();
    expect(events.map((e) => e[1])).toEqual([0, 1]);
    expect(events[0]![2]).toEqual(["items", 0]);
    expect(events[1]![2]).toEqual(["items", 1]);
  });
});

describe("unsubscribe and once", () => {
  it("stops firing after unsubscribe", () => {
    const p = new StreamingJsonParser();
    const seen: unknown[] = [];
    const stop = p.on("snapshot", (v) => seen.push(v));
    p.write('{"a":');
    const countBefore = seen.length;
    stop();
    p.write("1}");
    p.end();
    expect(seen.length).toBe(countBefore); // no further snapshots delivered
  });

  it("once fires exactly once", () => {
    const p = new StreamingJsonParser();
    let calls = 0;
    p.on("path", "a", () => calls++, { once: true });
    p.write('{"a":1');
    p.write(",\"b\":2}");
    p.end();
    expect(calls).toBe(1);
  });

  it("returned unsubscribe is idempotent", () => {
    const p = new StreamingJsonParser();
    const stop = p.on("snapshot", () => {});
    expect(() => {
      stop();
      stop();
    }).not.toThrow();
  });
});

describe("backward-compatible path subscription", () => {
  it("fires with monotonic growth and the final value", () => {
    const full = '{"message":{"content":"Hello world"}}';
    const p = new StreamingJsonParser();
    const contents: string[] = [];
    p.on("path", "message.content", (v) => contents.push(v as string));
    for (const ch of chunkify(full, 3)) p.write(ch);
    p.end();
    expect(contents.at(-1)).toBe("Hello world");
    for (let i = 1; i < contents.length; i++) {
      expect(contents[i]!.startsWith(contents[i - 1]!)).toBe(true);
    }
  });
});
