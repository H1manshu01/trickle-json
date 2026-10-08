import { describe, expect, it } from "vitest";
import { parsePartial } from "../src/index.js";

describe("parsePartial — complete input", () => {
  it("parses primitives", () => {
    expect(parsePartial("42")).toBe(42);
    expect(parsePartial("-3.14")).toBe(-3.14);
    expect(parsePartial("1e3")).toBe(1000);
    expect(parsePartial("true")).toBe(true);
    expect(parsePartial("false")).toBe(false);
    expect(parsePartial("null")).toBe(null);
    expect(parsePartial('"hello"')).toBe("hello");
  });

  it("parses objects and arrays", () => {
    expect(parsePartial('{"a":1,"b":[2,3],"c":{"d":"x"}}')).toEqual({
      a: 1,
      b: [2, 3],
      c: { d: "x" },
    });
  });

  it("decodes escapes and unicode", () => {
    expect(parsePartial('"line\\nbreak\\ttab"')).toBe("line\nbreak\ttab");
    expect(parsePartial('"caf\\u00e9"')).toBe("café");
  });
});

describe("parsePartial — empty / whitespace", () => {
  it("returns undefined", () => {
    expect(parsePartial("")).toBeUndefined();
    expect(parsePartial("   \n\t")).toBeUndefined();
    expect(parsePartial(null)).toBeUndefined();
    expect(parsePartial(undefined)).toBeUndefined();
  });
});

describe("parsePartial — truncation", () => {
  it("returns a partial string", () => {
    expect(parsePartial('"hel')).toBe("hel");
  });

  it("drops a lone trailing backslash", () => {
    expect(parsePartial('"hel\\')).toBe("hel");
  });

  it("drops an incomplete unicode escape", () => {
    expect(parsePartial('"caf\\u00')).toBe("caf");
  });

  it("keeps only fully-arrived object members", () => {
    expect(parsePartial('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartial('{"a":1,"b"')).toEqual({ a: 1 });
    expect(parsePartial('{"a":1,"b":"partial')).toEqual({ a: 1, b: "partial" });
  });

  it("keeps only fully-arrived array elements", () => {
    expect(parsePartial("[1,2,")).toEqual([1, 2]);
    expect(parsePartial('["a","b')).toEqual(["a", "b"]);
  });

  it("handles nested truncation", () => {
    // A fully-arrived element plus a trailing element that has *started* but
    // whose members have not arrived yet. Policy: a started container surfaces
    // as an empty container (so a streaming list shows the new item appearing),
    // while its not-yet-arrived key (`"id":`) is dropped.
    expect(parsePartial('{"items":[{"id":1},{"id":')).toEqual({ items: [{ id: 1 }, {}] });
    // Before the inner object opens, there is no second element yet.
    expect(parsePartial('{"items":[{"id":1},')).toEqual({ items: [{ id: 1 }] });
  });

  it("never throws on a partial literal", () => {
    expect(parsePartial("tr")).toBeUndefined();
    expect(parsePartial("nul")).toBeUndefined();
    expect(parsePartial('{"ok":tru')).toEqual({});
  });
});
