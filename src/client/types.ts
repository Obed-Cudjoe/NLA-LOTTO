import type {
  LastDrawReview, BacktestResult, Deduction, Draw, EngineConfig } from '../mathEngine';
import type { OrderReport } from '../drawOrder';
import type { MixingInput } from '../mixing';

export type Mode = 'worker' | 'static';
export type View = 'deduce' | 'lab' | 'backtest' | 'ledger' | 'settings';
export type Tone = 'ok' | 'bad' | 'info' | 'warn';

export interface Health {
  ok: boolean;
  mode?: string;
  version?: string;
  draws?: number;
  latest?: { date: string; game: string | null; label: string } | null;
  next?: { date: string; game: string; label: string } | null;
  hasAdminKey?: boolean;
  hasSourceUrl?: boolean;
  dbError?: string;
  time?: string;
}

export interface Settings {
  /** Only kept if the user chooses to store it; sent as x-api-key. */
  adminKey: string;
  /** Source URL used by the in-browser refresh/import helpers. */
  sourceUrl: string;
  /** Optional fine-grained PAT with contents:write, for GitHub-only mode. */
  ghToken: string;
  /** owner/repo, e.g. "Obed-Cudjoe/NLA-LOTTO". */
  ghRepo: string;
}

export interface AppState {
  mode: Mode;
  health: Health | null;
  /** Every draw the app knows about, all games, chronological. */
  draws: Draw[];
  /** Local-only additions (static mode) persisted in localStorage. */
  overlay: Draw[];
  game: string;
  config: EngineConfig;
  view: View;
  deduction: Deduction | null;
  /** What the engine said before the newest stored draw, vs what came out. */
  review: LastDrawReview | null;
  /** First-ball (order) analysis of the archive — the machine-bias test. */
  order: OrderReport | null;
  /** Drum-timing simulator inputs. */
  lab: MixingInput;
  backtest: BacktestResult | null;
  backtestOpts: { minTrain: number; simulations: number };
  settings: Settings;
  busy: string | null;
  toast: { text: string; tone: Tone } | null;
  search: string;
  ledgerLimit: number;
  advanced: boolean;
  lastSync: string | null;
  error: string | null;
}
