import { describe, expect, it } from "vitest";
import { StreamingJsonParser, getPath } from "../src/index.js";

function chunkify(s: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

describe("StreamingJsonParser", () => {
  it("emits progressively more complete snapshots", () => {
    const full = '{"message":{"content":"Hello world"},"done":true}';
    const parser = new StreamingJsonParser();
    const snapshots: unknown[] = [];
    parser.on("snapshot", (v) => snapshots.push(v));

    for (const ch of chunkify(full, 4)) parser.write(ch);
    const final = parser.end();

    expect(final).toEqual(JSON.parse(full));
    expect(snapshots.length).toBeGreaterThan(1);
    // Snapshots only grow toward the final value.
    expect(snapshots.at(-1)).toEqual(JSON.parse(full));
  });

  it("fires path subscriptions as a field fills in", () => {
    const full = '{"message":{"content":"Hello world"},"done":true}';
    const parser = new StreamingJsonParser();
    const contents: string[] = [];
    parser.on("path", "message.content", (v) => contents.push(v as string));

    for (const ch of chunkify(full, 3)) parser.write(ch);
    parser.end();

    expect(contents.length).toBeGreaterThan(0);
    expect(contents.at(-1)).toBe("Hello world");
    // Monotonic growth of the streamed string.
    for (let i = 1; i < contents.length; i++) {
      expect(contents[i]!.startsWith(contents[i - 1]!)).toBe(true);
    }
  });

  it("marks only the final snapshot as done", () => {
    const parser = new StreamingJsonParser();
    const dones: boolean[] = [];
    parser.on("snapshot", (_v, meta) => dones.push(meta.done));
    parser.write('{"a":1');
    parser.write("}");
    parser.end();
    expect(dones.filter(Boolean)).toEqual([true]);
  });

  it("supports indexed paths", () => {
    expect(getPath({ choices: [{ text: "hi" }] }, "choices[0].text")).toBe("hi");
    expect(getPath({ a: { b: 2 } }, "a.b")).toBe(2);
    expect(getPath({ a: 1 }, "a.missing")).toBeUndefined();
  });
});
