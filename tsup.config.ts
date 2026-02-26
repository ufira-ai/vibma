import { defineConfig } from 'tsup';
import { copyFileSync } from 'fs';

export default defineConfig([
  // MCP Server → dist/server.{cjs,js}
  {
    entry: ['src/vibma_mcp/server.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    outDir: 'dist',
    target: 'node18',
    sourcemap: true,
    minify: false,
    splitting: false,
    bundle: true,
  },
  // Figma Plugin → plugin/code.js (IIFE for Figma sandbox)
  {
    entry: ['src/figma-plugin/code.ts'],
    format: ['iife'],
    outDir: 'plugin',
    outExtension: () => ({ js: '.js' }),
    target: 'es2015',
    sourcemap: false,
    minify: false,
    splitting: false,
    bundle: true,
    // Figma plugin sandbox provides `figma` and `__html__` globals
    globalName: undefined,
    noExternal: [/.*/],
    async onSuccess() {
      copyFileSync('src/figma-plugin/manifest.json', 'plugin/manifest.json');
      copyFileSync('src/figma-plugin/ui.html', 'plugin/ui.html');
    },
  },
]);
