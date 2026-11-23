#!/usr/bin/env node
/**
 * Builds the browser bundle and stages static assets.
 *
 *   src/client/main.ts  ──esbuild──▶  public/assets/app.js   (engine + UI in one file)
 *   data/draws.json     ──copy────▶   public/data/draws.json (static-mode dataset)
 *
 * The Worker serves the same ./public directory via Workers Static Assets, and
 * GitHub Pages serves it verbatim — one build, two hosting targets.
 *
 * Usage: node scripts/build.mjs [--watch]
 */
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'public/assets');
const DATA_OUT = resolve(ROOT, 'public/data');
const watch = process.argv.includes('--watch');

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(DATA_OUT, { recursive: true });

const options = {
  entryPoints: [resolve(ROOT, 'src/client/main.ts')],
  outfile: resolve(OUT_DIR, 'app.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020', 'chrome100', 'safari15', 'firefox100'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
};

function stageData() {
  const src = resolve(ROOT, 'data/draws.json');
  if (!existsSync(src)) {
    console.warn('build: data/draws.json missing — run `npm run seed` first.');
    return 0;
  }
  copyFileSync(src, resolve(DATA_OUT, 'draws.json'));
  const draws = JSON.parse(readFileSync(src, 'utf8'));
  return Array.isArray(draws) ? draws.length : 0;
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  const draws = stageData();
  console.log(`build: watching · staged ${draws} draws → public/data/draws.json`);
} else {
  const result = await build(options);
  const size = statSync(resolve(OUT_DIR, 'app.js')).size;
  const draws = stageData();
  const html = statSync(resolve(ROOT, 'public/index.html')).size;
  console.log(
    `build: public/assets/app.js ${kib(size)} · public/data/draws.json ${draws} draws · index.html ${kib(html)}`
  );
  void result;
}
