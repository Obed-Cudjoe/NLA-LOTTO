#!/usr/bin/env node
/**
 * GitHub-only refresh: fetch results, validate, merge into data/draws.json.
 *
 * Runs in the "Refresh draw results" GitHub Action (daily) and locally via
 * `npm run refresh:data`. Uses the exact same parser and validator as the
 * Cloudflare Worker, so both hosting paths agree on what a valid draw is.
 *
 * Usage:
 *   npm run refresh:data                        # fetch RESULTS_SOURCE_URL (or defaults)
 *   npm run refresh:data -- --dry-run           # parse + report, write nothing
 *   npm run refresh:data -- --file=page.html    # parse a saved page instead of fetching
 *
 * Environment:
 *   RESULTS_SOURCE_URL   comma-separated list of pages to try, in order
 *   DATA_FILE            defaults to data/draws.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fetchAndParse, parsePayload } from '../src/scraper';
import { normalizeHistory, type Draw } from '../src/mathEngine';

const DATA_FILE = process.env.DATA_FILE ?? 'data/draws.json';
const FALLBACK_SOURCES = [
  'https://www.24lottos.com/lottery/ghana-lotto/results',
  'https://lotteryngo.com/results/ghana/',
];
const DEFAULT_GAME = process.env.DEFAULT_GAME ?? 'Monday Special';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find((a) => a.startsWith('--file='))?.split('=')[1];

function sources(): string[] {
  const configured = (process.env.RESULTS_SOURCE_URL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return configured.length ? configured : FALLBACK_SOURCES;
}

function loadExisting(): Draw[] {
  if (!existsSync(DATA_FILE)) return [];
  try {
    const raw = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Array<Record<string, unknown>>;
    const list = Array.isArray(raw) ? raw : ((raw as { draws?: unknown[] }).draws as unknown[]) ?? [];
    return normalizeHistory(
      list
        .map((item) => {
          const rec = item as { winning?: number[]; machine?: number[]; draw_date?: string; game_name?: string };
          if (!Array.isArray(rec.winning) || !Array.isArray(rec.machine)) return null;
          return {
            draw_date: String(rec.draw_date),
            game_name: String(rec.game_name),
            winning: rec.winning.map(Number),
            machine: rec.machine.map(Number),
          } satisfies Draw;
        })
        .filter((d): d is Draw => Boolean(d))
    );
  } catch (err) {
    console.error(`refresh: could not read ${DATA_FILE}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

function summarise(label: string, draws: Draw[]): void {
  console.log(`refresh: ${label} → ${draws.length} valid draw(s)`);
  for (const d of draws.slice(0, 3)) {
    console.log(`  ${d.draw_date} ${d.game_name}: ${d.winning.join(' ')} | ${d.machine.join(' ')}`);
  }
}

async function main(): Promise<number> {
  const existing = loadExisting();
  const before = existing.length;
  const collected: Draw[] = [];
  const errors: string[] = [];

  if (fileArg) {
    if (!existsSync(fileArg)) {
      console.error(`refresh: file not found: ${fileArg}`);
      return 1;
    }
    const body = readFileSync(fileArg, 'utf8');
    const contentType = /\.json$/i.test(fileArg) ? 'application/json' : 'text/html';
    const parsed = parsePayload(body, contentType, { defaultGame: DEFAULT_GAME });
    collected.push(...parsed.draws);
    errors.push(...parsed.errors);
    summarise(`local file ${fileArg}`, parsed.draws);
  } else {
    for (const url of sources()) {
      console.log(`refresh: fetching ${url}`);
      const parsed = await fetchAndParse(url, { defaultGame: DEFAULT_GAME });
      if (parsed.draws.length) summarise(url, parsed.draws);
      else console.log(`refresh: ${url} → nothing parsed (${parsed.errors[0] ?? 'unknown layout'})`);
      collected.push(...parsed.draws);
      errors.push(...parsed.errors);
    }
  }

  if (!collected.length) {
    console.error('refresh: no draw rows could be parsed from any source.');
    if (errors.length) console.error(`refresh: first error → ${errors[0]}`);
    return 1;
  }

  const merged = normalizeHistory([...existing, ...collected]);
  const added = merged.length - before;
  const newest = merged.at(-1);

  console.log(
    `refresh: ${before} existing + ${collected.length} parsed → ${merged.length} total (${added} new) · newest ${newest?.draw_date ?? '—'}`
  );

  if (!dryRun && added > 0) {
    const body = JSON.stringify(
      merged.map((d) => ({
        draw_date: d.draw_date,
        game_name: d.game_name,
        winning: d.winning,
        machine: d.machine,
      })),
      null,
      2
    );
    writeFileSync(DATA_FILE, `${body}\n`);
    console.log(`refresh: wrote ${DATA_FILE}`);
  } else if (dryRun) {
    console.log('refresh: dry run — no file written');
  } else {
    console.log('refresh: nothing new — file untouched');
  }

  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(process.env.GITHUB_OUTPUT, `added=${added}\ntotal=${merged.length}\n`, { flag: 'a' });
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const table = merged
      .slice(-6)
      .reverse()
      .map((d) => `| ${d.draw_date} | ${d.game_name} | ${d.winning.join(' ')} | ${d.machine.join(' ')} |`)
      .join('\n');
    writeFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### NLA 5/90 refresh\n\n${added} new draw(s) · ${merged.length} total\n\n| Date | Game | Winning | Machine |\n|---|---|---|---|\n${table}\n`,
      { flag: 'a' }
    );
  }

  return 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error('refresh: fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
