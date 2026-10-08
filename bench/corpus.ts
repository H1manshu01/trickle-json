/**
 * Shared benchmark corpus: valid JSON documents of the shapes LLMs actually
 * stream. Each is serialized with JSON.stringify, then every prefix is fed to
 * each parser.
 */
export const DOCS: unknown[] = [
  // Primitives
  42,
  -3.14,
  true,
  null,
  "a plain streamed string of some length",

  // Flat object (typical structured-output envelope)
  { status: "ok", code: 200, cached: false, note: null },

  // Arrays
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  ["alpha", "beta", "gamma", "delta"],

  // LLM-style tool-call arguments
  {
    name: "search_products",
    arguments: { query: "wireless headphones", maxPrice: 199.99, inStock: true },
  },

  // Chat-completion-shaped
  {
    id: "chatcmpl-123",
    choices: [
      { index: 0, message: { role: "assistant", content: "Here is a fairly long answer." } },
    ],
    usage: { prompt_tokens: 12, completion_tokens: 34 },
  },

  // Array of records (a list streaming in)
  {
    items: [
      { id: 1, title: "First", tags: ["x", "y"] },
      { id: 2, title: "Second", tags: ["z"] },
      { id: 3, title: "Third", tags: [] },
    ],
    total: 3,
  },

  // Escapes, unicode, surrogate pairs, nesting
  { text: 'line\nbreak\ttab "quoted" \\slash', emoji: "café ❤ 😀", nested: { a: { b: { c: 1 } } } },

  // Numeric edge cases
  { zero: 0, neg: -0.001, exp: 1.5e-10, big: 9007199254740991 },
];
