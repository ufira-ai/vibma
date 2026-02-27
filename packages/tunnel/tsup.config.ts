import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  bundle: true,
  minify: false,
  sourcemap: false,
  splitting: false,
  banner: { js: "#!/usr/bin/env node" },
});
