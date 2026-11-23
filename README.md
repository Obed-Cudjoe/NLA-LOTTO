# Ghana NLA 5/90 — Mathematical & Logical Deduction Engine

A self-contained personal web app for quantitative analysis of Ghana's National
Lottery Authority **5/90** games (Monday Special, Lucky Tuesday, Midweek, Fortune
Thursday, Friday Bonanza, National Weekly). It scores all 90 numbers across four
independent pillars, deduces the three strongest candidates for the next draw,
shows the plain-English reasoning behind each pick, and — most importantly —
**backtests itself honestly** against exact chance.

Works two ways from the same source tree:

| Mode | Hosting | Database | Cost | Needs a Cloudflare account? |
|---|---|---|---|---|
| **Static** (default, easiest) | GitHub Pages | `data/draws.json` in the repo + `localStorage` overlay | Free | **No** |
| **Worker** | Cloudflare Workers | D1 + daily cron at `0 21 * * *` | Free tier is enough | Yes |

You can host it on GitHub and do everything there. See
[Path A: GitHub only](#path-a--github-only-no-cloudflare-account) — that is the
recommended route, and the Cloudflare path remains available if you later want
a real database and a scheduled server-side scraper.

---

## Read this first (it is the point of the whole app)

NLA 5/90 is a **fixed-odds** draw. Five balls are drawn from 90 with no memory,
so:

- The probability that any specific number appears is **5/90 = 5.56%**, on every
  draw, forever, regardless of history.
- No combination of statistics — Bayesian, Poisson, Markov, machine learning —
  can change that probability. If the draw is fair, past results carry zero
  information about the next one.
- Because prizes are fixed odds, the **expected return per cedi is negative**,
  whatever numbers you choose. A "better" number selection does not improve it.

So what is all this for? Three things that are genuinely useful:

1. **A reproducible hypothesis engine.** Four well-defined statistical views,
   combined with weights you control, producing a daily answer you can audit.
2. **A truth machine.** The walk-forward backtester measures the engine against
   exact chance with confidence intervals, exact binomial p-values, and a
   Monte-Carlo random-player baseline. It is built to tell you "no edge" when
   there is no edge — including on the days the engine looks brilliant.
3. **Discipline.** A permanent ledger, a fixed model, and a written prediction
   record are the only things in lottery play that reliably improve outcomes,
   because they constrain spending.

If the backtester ever reports something above chance, the correct first
response is "look-ahead leakage or multiple-testing", not "I found an edge". The
app says that in the UI too.

---

## Features

**Deduction tab**
- The three deduced numbers as cards, each with a per-pillar score breakdown.
- Plain-English justification for every pick (Bayesian, Poisson, Markov, plus a
  combined verdict).
- Combinatorial audit with pass/fail on decade spread, parity balance and sum
  range, plus a spread-entropy meter.
- Alternative filtered trios and three full 5-number "coverage lines".
- Full ranking table for the top 24 of 90 numbers.

**Controls**
- Game filter (all six games pooled, or one game).
- Lookback window slider (10–120 draws).
- Bayesian / Poisson / Markov weight sliders (auto-normalised, so 45% always
  means 45% of the signal).
- Advanced: Beta prior strength, Markov shrinkage α, machine-number weight,
  expected gap λ, and toggles for each combinatorial filter.
- **Refresh Latest Results** (Worker mode) — prompts for your `ADMIN_KEY`, stores
  it in `localStorage`, and calls `POST /api/refresh`.
- **Refresh via GitHub** (static mode) — the same button, relabelled because a
  browser cannot read a results site (no CORS headers). With a fine-grained
  token in the Data tab it dispatches the `Refresh draw results` workflow and
  polls `data/draws.json` until the new commit lands; without a token it takes
  you straight to the Data tab, which has the working controls. In normal
  operation you never press it: the 21:00 GMT cron already did the work.

**Backtester tab**
- Strict walk-forward simulation: draw *t* is predicted using only draws
  1…*t*−1, with the lookback, Markov matrix and Beta posterior rebuilt at every
  step. No leakage.
- 1-Number, 2-Sure and 3-Direct hit rates with observed vs expected counts,
  95% Wilson intervals and exact one-sided binomial p-values.
- Monte-Carlo random-player baseline and the engine's percentile within it.
- Cumulative-hits chart and full step-by-step audit table.

**Ledger tab**
- Searchable history (date, game, or number), newest first.
- Manual draw entry form (5 winning + 5 machine, validated).
- Bulk import: CSV, JSON, or pasted HTML results — same parser as the API.
- Download JSON/CSV; in static mode, push local draws to GitHub with one click.

**Data tab** — connection status, admin key, source URL, optional GitHub token
for commit/refresh, and a "how this app is honest with you" panel.

---

## Path A — GitHub only (no Cloudflare account)

Everything lives in the repo: the dashboard is a static build, the dataset is
`data/draws.json`, and GitHub Actions refresh the data daily and redeploy.

### 1. Get the code onto GitHub

**Bash / macOS / Linux / WSL**

```bash
git clone https://github.com/Obed-Cudjoe/NLA-LOTTO.git
cd NLA-LOTTO
git checkout main
git add .
git commit -m "feat: NLA 5/90 deduction engine"
git push origin main
```

**Windows Command Prompt**

```bat
git clone https://github.com/Obed-Cudjoe/NLA-LOTTO.git
cd NLA-LOTTO
git checkout main
git add .
git commit -m "feat: NLA 5/90 deduction engine"
git push origin main
```

**Windows PowerShell**

```powershell
git clone https://github.com/Obed-Cudjoe/NLA-LOTTO.git
Set-Location NLA-LOTTO
git checkout main
git add .
git commit -m "feat: NLA 5/90 deduction engine"
git push origin main
```

> If you created the repo from scratch instead of cloning:
> `git init -b main`, then `git remote add origin https://github.com/<you>/<repo>.git`,
> then the same `add`/`commit`/`push -u origin main`.

### 2. Turn on GitHub Pages

Repo → **Settings → Pages → Build and deployment → Source: “GitHub Actions”**.

That is the only click required. The next push to `main` runs
`.github/workflows/pages.yml`, which typechecks, runs the test suite, builds the
dashboard and publishes it at:

```
https://<your-username>.github.io/NLA-LOTTO/
```

### 3. Run it locally (optional)

Requires **Node.js 20 or newer** (CI uses 22 LTS). `npm install` pulls `jsdom`
for the dashboard smoke test; it supports Node 18+.

```bash
npm install
npm run dev:static      # http://localhost:8788 — static mode, no Cloudflare
```

```bat
npm install
npm run dev:static
```

### 4. Refresh results on GitHub (no terminal needed)

- **Manually:** Actions → **Refresh draw results** → *Run workflow*.
- **Automatically:** it already runs daily at **21:00 UTC** (after every NLA
  evening draw). New rows are committed to `data/draws.json` and Pages
  redeploys automatically.
- **Set your source page:** Settings → Secrets and variables → Actions →
  **Variables** → New variable `RESULTS_SOURCE_URL`
  (comma-separate several URLs; they are tried in order).

### 5. Refresh from the browser

A static site has no server, and results sites send no `Access-Control-Allow-Origin`
header, so **no** in-page fetch of a results page can ever succeed — that is a browser
security rule, not a bug in the app. On GitHub Pages "refresh" means "ask GitHub to run
the workflow":

- **No token:** the button opens the Data tab with a link to
  `…/actions/workflows/refresh-draws.yml`; press *Run workflow* there.
- **With a token:** the button dispatches that workflow from the page and polls for the
  new commit, so the dashboard updates itself in a minute or two.

Either way, the daily cron does this on its own at 21:00 GMT.

In the Data tab, optionally paste a fine-grained GitHub token
(`contents: write` + `actions: write`, this repo only, short expiry). Then:

- **Push local draws to GitHub** commits your manual/imported rows to
  `data/draws.json` via the Contents API.
- **Trigger refresh workflow on GitHub** dispatches the scraper.

The token stays in `localStorage` and is only sent to `api.github.com`.

> Direct in-browser scraping of results sites is usually blocked by CORS — the
> app attempts it, and when it fails it tells you to use the Action or paste the
> page into the Ledger importer. That is expected, not a bug.

---

## Path B — Cloudflare Worker + D1

Static Pages hosting has no server, so it cannot scrape a third-party page for
you. If you want the nightly cron and a real database, deploy the Worker.

### Prerequisites

```bash
npm install
npx wrangler login
```

### 1. Create the D1 database

```bash
npx wrangler d1 create nla-lotto
```

Wrangler prints a TOML snippet containing `database_id`. Paste that value into
`wrangler.toml`, replacing `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

### 2. Apply the schema and seed 60 draws

```bash
# remote (the database your deployed Worker uses)
npx wrangler d1 execute nla-lotto --remote --file=./schema.sql

# local (for `wrangler dev`)
npx wrangler d1 execute nla-lotto --local --file=./schema.sql
```

**Windows Command Prompt** (identical, but `.\\` paths are also fine):

```bat
npx wrangler d1 execute nla-lotto --remote --file=./schema.sql
npx wrangler d1 execute nla-lotto --local  --file=./schema.sql
```

**Windows PowerShell:**

```powershell
npx wrangler d1 execute nla-lotto --remote --file=./schema.sql
npx wrangler d1 execute nla-lotto --local  --file=./schema.sql
```

Verify:

```bash
npx wrangler d1 execute nla-lotto --remote --command "SELECT COUNT(*) AS n, MAX(draw_date) AS last FROM draws"
```

`schema.sql` is idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`),
so re-running it is safe and will never duplicate a draw.

### 3. Set the admin key (secret, never in a file)

```bash
npx wrangler secret put ADMIN_KEY
```

Pick a long random string, e.g. `openssl rand -hex 24` on Bash or
`[guid]::NewGuid().ToString("N")` in PowerShell.

### 4. Deploy

```bash
npm run deploy        # = npm run build && npx wrangler deploy
```

or explicitly:

```bash
npm run build
npx wrangler deploy
```

Windows is identical (`npm run deploy` or `npm run build` + `npx wrangler deploy`).

You will get `https://ghana-nla-5-90-engine.<your-subdomain>.workers.dev`.
Open it — the Worker serves the same dashboard and reads from D1.

### 5. Deploy from GitHub instead of your laptop

Add two repository secrets (Settings → Secrets and variables → Actions):

- `CLOUDFLARE_API_TOKEN` — a token with *Edit Cloudflare Workers* + *D1 Edit*
- `CLOUDFLARE_ACCOUNT_ID` — from the Cloudflare dashboard URL

`.github/workflows/deploy-worker.yml` then runs typecheck + tests + `wrangler
deploy` on every push to `main`. Without those secrets the job skips with a
notice, and Pages keeps working.

---

## Triggering a refresh (Bash, Command Prompt, PowerShell)

The endpoint is `POST /api/refresh`, protected by an `x-api-key` header matched
against `env.ADMIN_KEY`. Optional body fields: `url`, `game`, `dryRun`.

### Bash / Git Bash / WSL

```bash
export ADMIN_KEY="paste-your-admin-key"
export WORKER_URL="https://ghana-nla-5-90-engine.<your-subdomain>.workers.dev"

# 1. Dry run: parse the configured source and show what would be inserted
curl -s -X POST "$WORKER_URL/api/refresh" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{"dryRun":true}' | jq .

# 2. Real refresh
curl -s -X POST "$WORKER_URL/api/refresh" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{}' | jq '.inserted, .skipped, .warnings'

# 3. Refresh from a different page (e.g. a mirror you trust)
curl -s -X POST "$WORKER_URL/api/refresh" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/ghana-results"}' | jq .

# 4. Read the current deduction from a terminal
curl -s "$WORKER_URL/api/analysis?game=Monday%20Special&lookback=40&wb=0.45&wp=0.25&wm=0.3" \
  | jq '.deduction.top[] | {number, score}'

# 5. Manual / bulk insert (JSON)
curl -s -X POST "$WORKER_URL/api/draws" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d '[{"draw_date":"2026-11-24","game_name":"Lucky Tuesday","winning":[12,30,44,67,89],"machine":[3,22,51,70,90]}]'

# 6. Bulk insert from a CSV file
curl -s -X POST "$WORKER_URL/api/draws" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: text/csv" \
  --data-binary @draws.csv
```

### Windows Command Prompt (`cmd.exe`)

Windows 10+ ships `curl.exe`. Quote JSON by escaping the inner quotes — or, much
easier, put the body in a file and use `@file`.

```bat
set ADMIN_KEY=paste-your-admin-key
set WORKER_URL=https://ghana-nla-5-90-engine.<your-subdomain>.workers.dev

REM 1. Dry run
curl.exe -s -X POST "%WORKER_URL%/api/refresh" ^
  -H "x-api-key: %ADMIN_KEY%" ^
  -H "content-type: application/json" ^
  -d "{\"dryRun\":true}"

REM 2. Real refresh (body from a file avoids all escaping pain)
echo {} > body.json
curl.exe -s -X POST "%WORKER_URL%/api/refresh" ^
  -H "x-api-key: %ADMIN_KEY%" ^
  -H "content-type: application/json" ^
  -d @body.json

REM 3. Analysis
curl.exe -s "%WORKER_URL%/api/analysis?lookback=40"

REM 4. Bulk CSV
curl.exe -s -X POST "%WORKER_URL%/api/draws" ^
  -H "x-api-key: %ADMIN_KEY%" ^
  -H "content-type: text/csv" ^
  --data-binary @draws.csv
```

### Windows PowerShell

`curl` is an alias for `Invoke-WebRequest` in PowerShell, so use
`Invoke-RestMethod` (cleaner) or `curl.exe` (the real curl).

```powershell
$env:ADMIN_KEY  = "paste-your-admin-key"
$env:WORKER_URL = "https://ghana-nla-5-90-engine.<your-subdomain>.workers.dev"
$headers = @{ "x-api-key" = $env:ADMIN_KEY }

# 1. Dry run
Invoke-RestMethod -Method Post -Uri "$env:WORKER_URL/api/refresh" `
  -Headers $headers -ContentType "application/json" -Body '{"dryRun":true}' | ConvertTo-Json -Depth 6

# 2. Real refresh
Invoke-RestMethod -Method Post -Uri "$env:WORKER_URL/api/refresh" `
  -Headers $headers -ContentType "application/json" -Body '{}' | ConvertTo-Json -Depth 6

# 3. Analysis, showing just the three picks
$r = Invoke-RestMethod -Uri "$env:WORKER_URL/api/analysis?lookback=40"
$r.deduction.top | Select-Object number, score

# 4. Manual insert
$body = @{
  draws = @(@{
    draw_date  = "2026-11-24"
    game_name  = "Lucky Tuesday"
    winning    = @(12,30,44,67,89)
    machine    = @(3,22,51,70,90)
  })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -Uri "$env:WORKER_URL/api/draws" `
  -Headers $headers -ContentType "application/json" -Body $body
```

### GitHub-only refresh from a terminal

```bash
gh workflow run refresh-draws.yml --repo <you>/NLA-LOTTO
gh run watch --repo <you>/NLA-LOTTO
```

```bat
gh workflow run refresh-draws.yml --repo <you>/NLA-LOTTO
gh run watch --repo <you>/NLA-LOTTO
```

Or locally, without any cloud account:

```bash
npm run refresh:data                     # fetch RESULTS_SOURCE_URL, merge into data/draws.json
npm run refresh:data -- --dry-run        # report only
npm run refresh:data -- --file=page.html # parse a saved copy of the results page
```

---

## API reference

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/health` | — | Liveness, inventory, next draw, config flags |
| GET | `/api/draws?game=&limit=&format=json\|csv` | — | Draw history |
| GET | `/api/analysis?game=&lookback=&wb=&wp=&wm=&pool=&prior=&alpha=&machine=&gap=&decade=&parity=&sumrange=&minsum=&maxsum=` | — | Full four-pillar deduction |
| GET | `/api/backtest?game=&minTrain=&simulations=` | — | Walk-forward simulation + edge audit |
| GET | `/api/export` | — | Full JSON backup |
| POST | `/api/refresh` | `x-api-key` | Scrape `RESULTS_SOURCE_URL` (or `?url=`) and insert |
| POST | `/api/draws` | `x-api-key` | Manual / bulk insert (JSON array, `{draws:[…]}`, or CSV body) |
| DELETE | `/api/draws?date=YYYY-MM-DD` | `x-api-key` | Remove one draw |
| POST | `/api/seed` | `x-api-key` | Re-insert the bundled 60-draw seed |

Auth accepts `x-api-key: <key>` or `Authorization: Bearer <key>`. The comparison
is constant-time-ish (length check + XOR accumulation). If `ADMIN_KEY` is unset,
every write endpoint returns `401` with instructions instead of failing open.

`POST /api/refresh` returns `{ ok, parsed, inserted, skipped, warnings, errors,
strategies, fetched }`. `inserted: 0` with `skipped: n` means "already up to
date", not an error.

---

## The mathematics

All four pillars are implemented in `src/mathEngine.ts` as pure functions — no
I/O, no dependencies — so the Worker, the browser and the tests run identical
code.

### Pillar 1 — Bayesian posterior (Beta-Binomial conjugate)

Start from a uniform prior centred on the base rate `p₀ = 5/90`:

```
prior  ~ Beta(α₀, β₀),  α₀ = k·p₀,  β₀ = k·(1−p₀)
posterior ~ Beta(α₀ + hits, β₀ + trials − hits)
mean = (α₀ + hits) / (k + trials)
```

`k` is the prior strength in pseudo-draws (default 24). It controls scepticism:
a huge `k` barely moves off 5.56% no matter what the recent window says.

Also reported: `P(p > p₀ | data) = 1 − I_{p₀}(α, β)`, computed with a
regularised incomplete beta (modified Lentz continued fraction). With a short
window this stays near 0.5 — which is the honest answer.

### Pillar 2 — Poisson inter-arrival and z-score deviation

Appearances of a specific number are Bernoulli(5/90) per draw, so the gap
between appearances is geometric with mean `λ = 1/p₀ = 18` draws:

```
sd(G) = sqrt((1−p)/p²) ≈ 17.49
z     = (gap − λ) / sd(G)
S(g)  = P(G ≥ g) = (1−p)^g        (survival / tail mass)
```

`z ≥ 1` flags the number as "overdue". Note this is a descriptive anomaly
detector: under independence, being overdue carries no predictive power. The
app labels it that way rather than pretending otherwise.

### Pillar 3 — First-order Markov chain (90 × 90)

For every consecutive pair of draws (t−1 → t), each number `a` in draw t−1
(winning numbers weight 1, machine numbers weight `machineWeight`, default 0.5)
contributes evidence that each winning number `b` of draw t follows it:

```
P(b | a) = (count[a][b] + α·p₀) / (rowTotal[a] + α)
score(b) = Σ_a  w(a) · P(b | a)
```

`rowTotal` counts transitions (not targets), so `Σ_b P(b|a) = 5` exactly — the
row is a proper distribution over "which of the five winning numbers follows".
Shrinkage `α` (default 12) pulls sparse rows toward the 5/90 baseline instead of
zero: an unobserved transition should look uninformative, not impossible.

### Pillar 4 — Combinatorial and entropy filtering

Candidate trios are drawn from the top `poolSize` (default 15) numbers, then
filtered:

- **Decade spread** — not all three in the same tens group (1–10, 11–20, …, 81–90).
- **Parity balance** — at least one odd and one even.
- **Sum range** — 75 ≤ sum ≤ 195 (the expected sum of three distinct 1–90 balls
  is 136.5, sd ≈ 44.5).

Surviving trios are ranked by:

```
trioScore = mean(blended z of members)
          + 0.35 · spreadEntropy          (0…1)
          + 0.15 · sumProximityBonus      (0…1, peaks at 136.5)
```

`spreadEntropy` is the average normalised Shannon entropy of the trio across
decade occupancy, parity split and quartile occupancy — a direct measure of how
clustered the pick is.

### Blending

Each pillar is standardised across all 90 numbers (mean 0, sd 1) before
weighting, so slider values are directly comparable:

```
score(n) = wB·z_bayes(n) + wP·z_poisson(n) + wM·z_markov(n)
```

Poisson z is clipped to ±3 and Markov uses `log(lift)` so no single pillar can
dominate on a small sample.

---

## Backtester methodology

```
for t = minTrain … N−1:
    train  = draws[0 … t−1]        # strictly historical
    target = draws[t]
    d      = deduce(train, config) # lookback, Markov, posterior all rebuilt
    top1   = d.evidence[0]         # strongest single number
    pair   = d.evidence[0..1]      # 2-Sure
    trio   = d.trio.numbers        # 3-Direct (filtered trio)
    score against target
```

Exact chance rates used throughout:

| Metric | Meaning | Chance per draw |
|---|---|---|
| 1-Number | top pick is among the 5 winning numbers | 5/90 = 5.556% |
| 2-Sure | both top picks are among the 5 | C(5,2)/C(90,2) = 0.250% |
| 3-Direct | all three are among the 5 | C(5,3)/C(90,3) = 0.00851% (1 in 11,748) |

Reported for each: observed rate, expected hits, lift, Wilson 95% interval, and
an exact one-sided binomial p-value `P(X ≥ observed | chance)`. A Monte-Carlo
random player is simulated over the identical schedule so you can see the
engine's percentile within pure luck.

**How to read it.** With 40 draws of history, 3-Direct has an expected count of
0.0034. You would need thousands of draws (decades of play) before a hit rate
could distinguish even a large true edge from noise. A p < 0.05 on one of many
metrics is multiple-testing noise, not evidence. The UI states this explicitly
next to the results.

---

## Data model

```sql
CREATE TABLE draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draw_date  TEXT NOT NULL UNIQUE,   -- ISO 'YYYY-MM-DD'
  game_name  TEXT NOT NULL,
  num1..num5 INTEGER NOT NULL CHECK (BETWEEN 1 AND 90),
  mac1..mac5 INTEGER NOT NULL CHECK (BETWEEN 1 AND 90),
  source     TEXT NOT NULL DEFAULT 'seed',  -- seed | scraper | manual | cron
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Invariants enforced on every path (scraper, API, form, CSV, JSON):

- exactly 5 winning + 5 machine numbers;
- all integers in 1…90;
- each set internally unique; all ten distinct (NLA draws all ten balls from the
  same drum without replacement).

`draw_date` is UNIQUE and every insert is `INSERT OR IGNORE`, so repeated cron
runs, double-clicked refresh buttons and overlapping scrapes are all idempotent.

The bundled `data/draws.json` / `schema.sql` seed contains **60 synthetic but
calendar-realistic draws** (Mon–Sat, one game per evening, newest on
2026-11-21). They exist so the dashboard is useful on first deploy. They are
**not official NLA results** — replace them by refreshing or importing. Seed rows
are only replaced on the dates your source actually publishes, so a fresh history
fills in from the newest date backwards; check the Ledger tab to see what is real.

### Game names come from the calendar, not the page

Aggregator pages are unreliable at labelling: they often stamp every row with
whichever game name appears first in their markup, and several list Sunday/ASEDA
draws next to the six 5/90 evening games. So the scraper pins each row to NLA's
weekday schedule — Monday Special, Lucky Tuesday, Midweek, Fortune Thursday,
Friday Bonanza, National Weekly — and **rejects Sunday rows**, reporting both
corrections in the refresh warnings. A genuinely rescheduled draw can still be
imported by hand, or parsed with `respectSchedule: false`.

### Scraper design (`src/scraper.ts`)

Workers have no `DOMParser`, so parsing is regex-based and modular. Strategies
run in order and never throw:

1. `json-blob` — embedded `<script type="application/ld+json">` / JSON payloads.
2. `table-row` — `<tr>` blocks with a date and ten numbers.
3. `heading-block` — `<h1>…<h4>`/`<section>` delimited result cards.
4. `labelled-text` — weekday-delimited plain text (also works on pasted terminal output).

Add your own by pushing into `htmlStrategies` / `jsonStrategies`. Number
extraction strips dates, times and years as whole units first, so `2026-11-16`
and `19:50` never leak `16`, `19` or `50` into a draw.

Rows lacking machine numbers are skipped with a warning (never stored half-empty);
conflicting rows for the same date keep the first and report a warning; identical
duplicates found by two strategies are collapsed silently.

---

## Project structure

```
wrangler.toml                 Worker config: D1 binding, cron 0 21 * * *, vars
schema.sql                    DDL + 60 seed rows (idempotent)
seed.sql                      Seed rows only
data/draws.json               Canonical dataset for static mode
src/index.ts                  Worker routes, auth, cron handler
src/db.ts                     D1 queries (parameterised, idempotent inserts)
src/scraper.ts                Fetch + modular parse + validation
src/mathEngine.ts             THE ENGINE — four pillars, deduction, backtester
src/types.ts                  Shared domain types and defaults
src/client/main.ts            Dashboard controller (state, events, data)
src/client/views.ts           Pure view templates
src/client/charts.ts          Chart.js wrappers (degrade gracefully)
src/client/format.ts          Formatting/escaping helpers
src/client/store.ts           localStorage + GitHub bridge
public/index.html             App shell (Tailwind + Chart.js CDN)
public/assets/app.js          Built bundle (generated by npm run build)
scripts/build.mjs             esbuild bundle + static asset staging
scripts/generate-seed.mjs     Deterministic seed generator
scripts/refresh-draws.ts      GitHub-only refresh CLI (same parser)
scripts/serve.mjs             Zero-dependency static preview server
tests/                        45 tests: engine, scraper, dashboard smoke test
```

### Commands

| Command | What it does |
|---|---|
| `npm run build` | Bundle `src/client/main.ts` → `public/assets/app.js`, stage data |
| `npm test` | Vitest: engine math, parser, dashboard smoke test |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run dev` | Build + `wrangler dev` (Worker + local D1) |
| `npm run dev:static` | Build + static preview on `:8788` (no Cloudflare) |
| `npm run deploy` | Build + `wrangler deploy` |
| `npm run db:init` / `db:init:local` | Apply `schema.sql` to remote/local D1 |
| `npm run seed` | Regenerate `data/draws.json` + `schema.sql` + `seed.sql` |
| `npm run refresh:data` | Fetch + validate + merge into `data/draws.json` |

---

## Security notes

- `ADMIN_KEY` is a Worker **secret** (`wrangler secret put`), never a var in
  `wrangler.toml`. Locally, use `.dev.vars` (git-ignored).
- In the browser the admin key and any GitHub token live in `localStorage`. That
  is convenient and not hardened: anyone with access to your unlocked browser
  profile can read them. Use a short-expiry, single-repo, minimum-scope token
  and rotate it.
- All write endpoints fail closed with `401` if `ADMIN_KEY` is unset.
- Scraped/game-name strings are HTML-escaped in the UI (covered by a test).
- The default `RESULTS_SOURCE_URL` points at a third-party aggregator. Verify
  every result against the official NLA publication before relying on it, and
  set the variable to whichever page you trust.

---

## "Can this help me win?" — the honest version

Short answer: **it cannot change the odds, and the odds are against you.** NLA
5/90 is fixed-odds, so each cedi staked has a negative expected return no matter
which numbers you mark. Any system claiming otherwise is selling something.

What can actually be improved, in order of real effect:

1. **Spend less.** Expected loss = stake × house edge. Halving your stake halves
   the expected loss. This is the only lever with a guaranteed, deterministic
   effect. Treat lottery money as an entertainment expense, not an investment.
2. **Play for the prize tier you can actually reach.** With 5 numbers marked, a
   3/5 or 4/5 payout is far more likely than 5/5. If your goal is "win
   something", decide the tier first and let that set your budget — do not chase
   5/5 with volume.
3. **Prefer draws with accumulated/rollover value** if and when NLA publishes
   one. A bigger pot for the same stake improves expected return slightly (still
   usually negative). This is the only structural inefficiency a player can
   legitimately exploit — and it is about *which draw*, not *which numbers*.
4. **Do not spread thin.** Five tickets of 5 numbers each cover 25 slots; one
   ticket covers 5. More coverage per cedi is not more edge, but it converts the
   same spend into more chances of a small tier. Decide deliberately instead of
   buying overlapping lines.
5. **Keep the record.** The ledger and backtester exist so you can check, after
   50–100 draws, whether your instinct ("my numbers are hot") was ever real. It
   never is — and having the data makes that undeniable, which protects your
   wallet.
6. **Set a hard stop before you play.** A fixed monthly amount, in cash or a
   separate wallet, that you will not exceed. If you find yourself increasing
   stakes after losses, stop playing and talk to someone — gambling harm is real
   and Ghana's NLA games are designed to produce exactly that pattern.

Where the engine *is* legitimately useful: as a disciplined hypothesis log with
a built-in lie detector. It gives you a defensible, reproducible answer each
day, and then measures that answer against chance with p-values. If you ever see
it clear the noise threshold over hundreds of draws, that is interesting — but
it is far more likely to be a data bug than a hole in the lottery.

There is no number-selection strategy that makes you win. The app's honest value
is that it will keep telling you so, with evidence, instead of selling you hope.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Page loads but says "No draws loaded" | Static mode needs `data/draws.json`; run `npm run build`, and check the file is committed |
| `no such table: draws` | Apply `schema.sql` to the right target (`--remote` vs `--local`) |
| Refresh returns `422` with "No draw rows recognised" | The source page changed layout; paste the page into the Ledger importer, or add a strategy in `src/scraper.ts` |
| Every draw shows the same game name, or a Sunday row appears | Fixed in v1.1: rows are pinned to the weekday schedule and Sundays are rejected. Warnings in the refresh response name every relabelled/dropped row |
| Refresh returns `401` | Missing/wrong `x-api-key`, or `ADMIN_KEY` was never set (`npx wrangler secret put ADMIN_KEY`) |
| Browser refresh fails with a fetch error | CORS — use the GitHub Action, the Data-tab workflow trigger, or paste the page |
| Pages shows a 404 after deploy | Settings → Pages → Source must be "GitHub Actions", and the workflow must have run on `main` |
| `wrangler deploy` fails on `database_id` | Replace the placeholder in `wrangler.toml` with the id from `npx wrangler d1 create nla-lotto` |
| Charts are blank | Chart.js CDN blocked (offline / strict network). The numbers and tables still work |

## Licence & disclaimer

Personal-use project, MIT-style: do what you like with it. Not affiliated with,
endorsed by, or connected to the National Lottery Authority of Ghana. All
statistics are descriptive; nothing here is a prediction, financial advice, or a
guarantee of any outcome. Verify results against official NLA publications.
Play within your means.
