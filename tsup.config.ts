import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/zod.ts", "src/openai.ts", "src/anthropic.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: true,
  minify: false,
  outExtension({ format }) {
    return { js: format === "cjs" ? ".cjs" : ".js" };
  },
});
