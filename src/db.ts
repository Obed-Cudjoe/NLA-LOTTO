/**
 * D1 persistence layer. Every query is parameterised; every write is
 * idempotent (INSERT OR IGNORE on the UNIQUE draw_date) so a repeated cron run
 * or a double-clicked refresh button can never duplicate a draw.
 */
import { rowToDraw, type Draw, type DrawRow } from './mathEngine';

export interface ListOptions {
  game?: string | null;
  limit?: number;
  offset?: number;
  ascending?: boolean;
  from?: string | null;
  to?: string | null;
}

const COLUMNS =
  'id, draw_date, game_name, num1, num2, num3, num4, num5, mac1, mac2, mac3, mac4, mac5, source, created_at';

/** Fetch draws (defaults to newest-first) already sorted chronologically. */
export async function listDrawRows(db: D1Database, opts: ListOptions = {}): Promise<DrawRow[]> {
  const clauses: string[] = [];
  const bindings: unknown[] = [];

  if (opts.game && opts.game !== 'all' && opts.game !== 'All games') {
    clauses.push('game_name = ?');
    bindings.push(opts.game);
  }
  if (opts.from) {
    clauses.push('draw_date >= ?');
    bindings.push(opts.from);
  }
  if (opts.to) {
    clauses.push('draw_date <= ?');
    bindings.push(opts.to);
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const order = opts.ascending ? 'ASC' : 'DESC';
  const limit = Math.max(1, Math.min(5000, Math.floor(opts.limit ?? 1000)));
  const offset = Math.max(0, Math.floor(opts.offset ?? 0));

  const stmt = db.prepare(
    `SELECT ${COLUMNS} FROM draws ${where} ORDER BY draw_date ${order} LIMIT ? OFFSET ?`
  );
  const { results } = await stmt
    .bind(...bindings, limit, offset)
    .all<DrawRow>();
  return results ?? [];
}

/** All draws in chronological order, ready for the engine. */
export async function listDraws(db: D1Database, opts: ListOptions = {}): Promise<Draw[]> {
  const rows = await listDrawRows(db, opts);
  return rows.map(rowToDraw).sort((a, b) => a.draw_date.localeCompare(b.draw_date));
}

export interface InsertResult {
  inserted: number;
  skipped: number;
  insertedDates: string[];
  skippedDates: string[];
}

/** Bulk insert. Returns which dates were new and which already existed. */
export async function insertDraws(
  db: D1Database,
  draws: readonly Draw[],
  source = 'api'
): Promise<InsertResult> {
  if (!draws.length) return { inserted: 0, skipped: 0, insertedDates: [], skippedDates: [] };

  const existing = await existingDates(db, draws.map((d) => d.draw_date));
  const fresh = draws.filter((d) => !existing.has(d.draw_date));
  const duplicates = draws.filter((d) => existing.has(d.draw_date));

  if (fresh.length) {
    const stmt = db.prepare(
      `INSERT OR IGNORE INTO draws
         (draw_date, game_name, num1, num2, num3, num4, num5, mac1, mac2, mac3, mac4, mac5, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const batch = fresh.map((d) =>
      stmt.bind(
        d.draw_date,
        d.game_name,
        d.winning[0],
        d.winning[1],
        d.winning[2],
        d.winning[3],
        d.winning[4],
        d.machine[0],
        d.machine[1],
        d.machine[2],
        d.machine[3],
        d.machine[4],
        source
      )
    );
    // D1 batch limit is generous; chunk defensively anyway.
    for (let i = 0; i < batch.length; i += 50) {
      await db.batch(batch.slice(i, i + 50));
    }
  }

  return {
    inserted: fresh.length,
    skipped: duplicates.length,
    insertedDates: fresh.map((d) => d.draw_date),
    skippedDates: duplicates.map((d) => d.draw_date),
  };
}

async function existingDates(db: D1Database, dates: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(dates)];
  if (!unique.length) return new Set();
  const placeholders = unique.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT draw_date FROM draws WHERE draw_date IN (${placeholders})`)
    .bind(...unique)
    .all<{ draw_date: string }>();
  void results;
  return new Set((results ?? []).map((r) => r.draw_date));
}

export async function countDraws(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM draws').first<{ n: number }>();
  return row?.n ?? 0;
}

export async function latestDraw(db: D1Database): Promise<DrawRow | null> {
  return db
    .prepare(`SELECT ${COLUMNS} FROM draws ORDER BY draw_date DESC LIMIT 1`)
    .first<DrawRow>();
}

export async function deleteDrawByDate(db: D1Database, date: string): Promise<number> {
  const res = await db.prepare('DELETE FROM draws WHERE draw_date = ?').bind(date).run();
  return res.meta?.changes ?? 0;
}

/** Ensure the schema exists — lets a brand-new D1 instance work on first hit. */
export async function ensureSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS draws (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         draw_date TEXT NOT NULL UNIQUE,
         game_name TEXT NOT NULL,
         num1 INTEGER NOT NULL, num2 INTEGER NOT NULL, num3 INTEGER NOT NULL,
         num4 INTEGER NOT NULL, num5 INTEGER NOT NULL,
         mac1 INTEGER NOT NULL, mac2 INTEGER NOT NULL, mac3 INTEGER NOT NULL,
         mac4 INTEGER NOT NULL, mac5 INTEGER NOT NULL,
         source TEXT NOT NULL DEFAULT 'seed',
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_draws_date ON draws (draw_date DESC)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_draws_game_date ON draws (game_name, draw_date DESC)'),
  ]);
}
