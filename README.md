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

**The site (v1.3.0)** — a public front page with sections, and the maths behind a door

| Address | What it is for |
|---|---|
| `#/` | Home: tonight's five numbers, the last three results, and what the site does — no formulas |
| `#/tonight` | The picks for the next draw, with a plain-English reason for each and the result check |
| `#/results` | The whole archive, per game, with machine numbers |
| `#/games` | The six games, their weekdays, how a draw runs, and what each ticket pays |
| `#/smart` | Ticket arithmetic in money terms: expected return, house edge, what coverage buys |
| `#/method` | The three signals, first-ball test, drum physics, backtest, and what would change our mind |
| `#/tools/*` | The working bench: sliders, 90-number ranking, backtester, drum lab, ledger, data |

Every section is a real address — shareable, bookmarkable, and the back button works.
The front page never shows a z-score, a weight or a table header; those live only in
`#/tools`, which is one click away and clearly labelled as the working bench.

**Deduction tab**
- The three deduced numbers as cards, each with a per-pillar score breakdown.
- Plain-English justification for every pick (Bayesian, Poisson, Markov, plus a
  combined verdict).
- Combinatorial audit with pass/fail on decade spread, parity balance and sum
  range, plus a spread-entropy meter.
- Alternative filtered trios and three full 5-number "coverage lines".
- Full ranking table for the top 24 of 90 numbers.

The tool opens in **simple mode**: three picks, one plain-English reason each,
the five-number line, and the result check. The z-scores, pillar contributions,
model state and the full 90-number ranking live behind **Show the maths** — the
arithmetic happens behind the scenes until you ask for it.

**Controls**
- **Game filter — defaults to tonight's game.** Monday's picks are computed from
  Monday Special's own history and target the next Monday draw; Midweek's from
  Midweek's history and target Wednesday. Each game keeps its own weekday
  schedule, so a filtered view never advertises another game's date. Switch to
  *All games (pooled)* for a six-game blend with more data — the per-game view
  is the right model, the pooled view is the better-statistics one, and the
  header tells you how many draws each is using.
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

**Which day the numbers "belong" to**

Every game has one draw per week, so the honest rule is: generate Monday's
numbers on Monday, from Monday's history, for Monday's draw. That is what the
default filter does. Two consequences worth knowing:

- The target is the next date *that game* is drawn. Filter Midweek on a Monday
  and the header says **Wed 25 Nov**, not Monday. After Monday's result is
  stored, Monday Special's target becomes the following Monday.
- Ten draws per game is a thin window. The engine still produces a trio, but the
  header says so, and the Backtester will show you, on your own data, that the
  per-game picks have no measurable edge over chance either.

**Draw lab tab — what each ticket really returns, and whether the machine can be read**

NLA publishes fixed multipliers, so every bet's expected value is a one-line
calculation rather than an opinion:

| Ticket | Pays | Chance | Returns per 1.00 staked |
|---|---|---|---|
| Direct 2 (2 of your numbers drawn) | 240× | 1 in 401 | **0.60** |
| Direct 1 (your number drawn **first**) | 40× | 1 in 90 | 0.44 |
| Direct 3 | 2,100× | 1 in 11,748 | 0.18 |
| Direct 4 | 6,000× | 1 in 511,038 | 0.012 |
| Direct 5 (all five) | 44,000× | 1 in 43,949,268 | 0.001 |

Two consequences the app states plainly:

- **The cheapest-looking ticket is not the best one.** Direct 2 loses 40% of
  stake on average; Direct 5 loses 99.9%. If you play at all, the top row of
  that table is the least-bad choice.
- **Five-number coverage buys lines, not edge.** Reaching a 50% chance on
  Direct 5 takes about 30.5 million lines — roughly 30.5 million units staked
  for an expected return of about 30,500. It can win, and somebody does; the
  arithmetic of what "likely" costs is on the card.

### The target is a draw you can still stake on

A draw ends in two ways, and the calendar only knows about one of them:

1. the clock passes **20:30 GMT** on the day, and
2. **the result is in the archive**.

`nextOpenDraw(history, now, game?)` checks both. The moment a result is stored it skips that
date and the target rolls to the following game — Tuesday's result landing does not leave the
page advertising "tonight's draw" on Wednesday. `deduce()` takes the same clock as an optional
argument, so the daily review can replay the model *as it stood on the morning of the draw*
(`reviewLastDraw` passes 12:00 UTC on that date).

The client also polls `data/draws.json` every two minutes and on tab focus; when a new draw
appears the target moves, the picks recompute and the page repaints itself — no reload, no
pressing refresh.

**The analysis stays scoped to one game.** Midweek's five numbers come from Midweek's own
draws, not a pool of six games: on 25 Nov 2026 that is 80 · 32 · 47 · 12 · 71, unchanged by the
Tuesday result because a Tuesday draw is not Midweek history.

### Where do you actually stake a Direct 1 or Direct 2?

Not here. This project sells nothing — no tickets, no accounts, no payments — and takes no
referral money from anyone. Tickets are bought from **NLA-licensed retailers** (the kiosk with a
point-of-sale terminal), through the 5/90 USSD short code (published as `*959#`; codes change, so
confirm on the handset), or from an NLA-licensed online operator.

At the counter the local names are worth knowing:

| App label | What to say | What it needs |
|---|---|---|
| Direct 1 | “Direct 1 — number 80” (*1 sure*) | that number is the **first** ball out; 40×, 1 in 90 |
| Direct 2 | “Direct 2 — 80 and 32” (*2 sure*) | both numbers anywhere in the five; 240×, 1 in 401 |

Before leaving the counter, check the printed ticket: game, draw date, numbers, stake, multiplier.
A ticket for the wrong game or day is the most common avoidable loss in this game.

### "What can we do to increase our chance of winning?"

Three levers exist. Two work, and the third — the one people reach for — does nothing.

| Ticket | Stake 10 | Stake 50 | Stake 100 | Returns on 100 staked |
|---|---|---|---|---|
| Direct 1 (40×) | 10.6% | 42.8% | **67.3%** | 44 |
| Direct 2 (240×) | 2.5% | 11.8% | 22.1% | 60 |
| Direct 3 (2,100×) | 0.1% | 0.4% | 0.9% | 18 |

1. **More lines** — raises the chance of *some* win, and raises the stake in the same step.
2. **The ticket you pick** — Direct 1 maximises how often you win something (1 in 90 a line);
   Direct 2 maximises expected return (0.60 per 1.00). Different goals, different tickets.
3. **Which numbers** — nothing. Every five-number combination is equally likely.

The table's last column is the answer to the whole question: 100 staked on Direct 1 buys a 67%
chance of winning something and an expected **44** back. A high chance of winning is purchasable;
a high chance of coming out ahead is not, because every price on the board is below the odds.

### "Can our chance be high, or 50/50?"

A 50% chance is purchasable; it is not an edge. Buying enough lines gives you any probability
you want, at the same negative expected value per line:

| Ticket | Chance you hold the winning line | Lines | Stake | Expected back | Net |
|---|---|---|---|---|---|
| Direct 2 | 50% | 278 | 278 | 167 | **−111** |
| Direct 2 | 90% | 922 | 922 | 553 | −369 |
| Direct 3 | 50% | 8,143 | 8,143 | 1,456 | −6,687 |
| Direct 5 | 50% | 30,463,311 | 30,463,311 | 30,498 | −30,432,813 |

These numbers are computed live on the Play smart page from the published multipliers and the
exact hypergeometric chances — no assumptions. They are the arithmetic answer to "high chance":
certainty is for sale, and it is paid for in guaranteed average loss. Per draw, the committed
line's chances are 0.25% (2-Sure), 0.0085% (3-Direct) and 0.0000023% (five numbers).

### The committed line (`src/pickBook.ts`)

From 1.5.0 the Tonight page states, for every draw, three things and one timestamp:

| Line | What it needs | Pays | Chance |
|---|---|---|---|
| **Perm 5 / Direct 5** | all five of the listed numbers among the five drawn, any order | 44,000× | 1 in 43,949,268 |
| **2-Sure** | both numbers drawn | 240× | 1 in 401 |
| **3-Direct** | all three numbers drawn | 2,100× | 1 in 11,748 |

**Lock this line before the draw** stores the numbers with a timestamp in `localStorage`.
Once the result is stored, every locked line is scored automatically against it — hits,
draws, and the counts a fair drum predicts (0.28 numbers per line, one 2-Sure hit per 401
lines, one 3-Direct hit per 11,748). The verdict is fixed in advance: under 20 resolved
draws it says nothing; at 20+ it compares observed hits with those expectations and says
where the book stands, including when it is below chance. CSV export carries the scoring
columns so the arithmetic can be checked outside the app.

A line can only be locked **before** its draw. Once the evening window has closed (20:30 GMT),
the button is disabled and the app says why: a line locked after the result is hindsight, not a
prediction, and the record would be worthless. If the archive is behind — the result exists but
the refresh has not fetched it — the page says that too, instead of calling a finished draw
"tonight's".

The point is not that the line is lucky. It is that the line is **checkable**. A reader
can see what was said, when, and what happened — which is the only claim this project
makes about its own output.

### How long does the guest take to walk to the button?

Two questions, and only one of them has a published answer.

**Who presses the button:** NLA calls invited spectators out of the audience during the
draw, reportedly one per ball — so a single draw contains five separate walks to the
release button. The broadcasts have been televised since March 2021: GTV (18:45–19:00),
then UTV from December 2021 (19:15–19:30), then GTV again from December 2025 at 20:00,
with the Sunday game at 18:00.

**How long the walk lasts:** no broadcaster, regulator or results site publishes it. The
honest answer is an estimate, not a statistic — the studio floor is a few metres wide, so
it is **seconds, not minutes** (≈10–20 s, modelled at 12 s), and the shake is of the same
order (≈5–10 s, modelled at 5 s).

Rather than assert that, the app lets you measure it: the **stopwatch** in the Draw lab
has two taps per phase — *guest called → button pressed*, and *shake starts → first ball
out* — and carries the result straight into the timing journal, which is what the
statistics need.

**Why the walk cannot help you pick numbers** is not a matter of the estimate's accuracy.
While the drum runs, a 12-second walk strikes every ball ~120 times against the ~7
collisions needed to erase its starting position: the walk is *more* mixing, never a hint
about identity. And if the drum is stopped, identical weight-controlled balls settle
symmetrically, behind sealed glass, in an arrangement nobody can observe.

### Can the drum's timing be read?

This is treated as a real, testable question rather than a debating point.

*What the procedure actually is.* NLA runs a certified mechanical draw: a
gravity-pick drum with rotating paddles, or an air-mix chamber where pressurised
air suspends the balls. Pre-draw checks cover ball sets, weight tolerances,
chamber seals and machine test cycles; the mixing phase has a minimum duration;
each release is a separate button press by the host, so the pause between balls
adds more mixing, not less. Draws run daily Monday–Saturday (evening; NLA-linked
sources state 8:30pm GMT, Sunday Aseda 7:30pm — one aggregator quotes 7:15pm, so
the app stores whatever the source publishes and never guesses).

*The physics.* An air-mix drum is a chaotic mixer: displacement grows
exponentially, so after a second or two each ball's position is effectively
independent of where it started. Bias survives only while the drum is
**under-mixed**, and exploiting it needs a second, separate condition — knowing
which ball sits in the exit slot. Neither condition is available to a player:
the ball set is loaded behind a sealed door, and the loading order is not
published. Without it, a positional bias says nothing about which *number* is
where.

*The numbers.* The Draw lab simulates this with sliders for shake time, pause
between presses, and mixing constant τ. At a generous τ = 0.7 s and 5 s of
shaking, Direct 1 still returns only 0.48 per 1.00. The drum would have to be
shaken for **less than about 3 seconds** for the first-ball market to become
beatable — and even then only with a known loading order. Set the toggle to
"sealed drum" and the edge vanishes identically: every ball is 1 in 90 whatever
the timing.

*What about the invited guest who presses the button?* This is the same physics
with a human in the loop. While the guest walks to the button the drum keeps
running, so the walk is free extra mixing: at ~10 ball-ball collisions per
second, a 12-second walk strikes every ball about 120 times — roughly 17× the
mixing the drum needs to reach uniformity. More walking therefore makes the
draw *more* uniform, never more readable. If the drum is stopped instead,
identical, weight-controlled balls settle symmetrically: the arrangement is
whatever it already was, nothing new becomes observable, and it is behind sealed
glass either way.

The app models both cases with a walk-time slider and a "drum during the walk"
toggle, and counts collisions rather than asking you to take it on trust.

*And if you still want to test it?* Use the **timing journal** in the Draw lab:
log each draw's walk seconds, shake seconds and first ball (record the timings
**before** the numbers appear), then the app runs a chi-square test of
independence between walk-time tercile and first-ball decile, with a
deterministic Monte-Carlo p-value and Cramér's V as the effect size. It refuses
to flatter small samples: below 60 entries it reports "inconclusive by design",
and it recommends 300+ before a negative result means anything. Entries live in
`localStorage` and export to CSV.

*The empirical check.* Because Direct 1 depends on the first ball, the archive
is tested directly: a chi-square on the first-ball distribution against
uniform(90), with a deterministic Monte-Carlo p-value. On the current 60 draws,
p = 0.58 — indistinguishable from a fair drum. The tab also reports the honest
limit of that evidence: 60 draws can only detect a first ball appearing about
5.8× more often than chance, and a 2× effect would need roughly 880 draws. So
the answer is "no evidence, and not enough data to prove a small effect either
way" — which is exactly why the app does not sell a timing model.

**Last draw vs the engine** (top of the Deduction tab)
- The newest stored result next to the trio the engine produced *before* that
  draw — re-run deterministically, so it works even for draws that happened
  before this feature existed.
- Hits, machine-set hits, expected hits per draw (0.17) and the exact
  probability of at least one hit (15.9% for three picks).
- A "why" table: each winning number with the rank and blended z-score the
  model gave it *before* the draw, so you can see whether the draw was
  surprising or unremarkable.
- A plain verdict per outcome, including the blunt ones: a blank line is the
  most likely result (84% of draws). Nothing here explains *why* the drum chose
  those balls — only how the model rated them beforehand.

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

### A draw is only a result *after* it has been drawn

Aggregators print the **upcoming** draw next to the last numbers
(`NEXT DRAW Mon, Nov 23, 2026`). A naive parse treats that as a result date and
invents a draw that has not happened — which silently moves the dashboard's
target to the following day. The scraper therefore:

- scrubs `NEXT DRAW <date>` labels out of a block before reading its date;
- rejects any row dated **after today** (UTC) — a scheduled draw, not a result;
- rejects a row dated **today before 20:00 GMT**, when the last NLA evening draw
  (19:15 for the six games, 19:50 for ASEDA) is long finished.

Every skip appears in the refresh warnings, so the Actions run summary says
exactly what was ignored and why. The dashboard labels its picks for the
**next undrawn game** — "Tonight's draw — Monday Special" when today's game is
still to come, "Next draw — Lucky Tuesday" when tonight's result is already
stored — and shows a warning if stored history has fallen behind today.

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
src/client/main.ts            Controller: state, hash routing, events, data
src/client/site.ts            The public site: nav, home, games, payouts, method
src/client/views.ts           Tool views: deduction, lab, backtester, ledger, data
src/client/charts.ts          Chart.js wrappers (degrade gracefully)
src/client/format.ts          Formatting/escaping helpers
src/client/store.ts           localStorage + GitHub bridge
public/index.html             App shell + site CSS (Tailwind + Chart.js CDN)
public/assets/app.js          Built bundle (generated by npm run build)
scripts/build.mjs             esbuild bundle + static asset staging
scripts/generate-seed.mjs     Deterministic seed generator
scripts/refresh-draws.ts      GitHub-only refresh CLI (same parser)
scripts/serve.mjs             Zero-dependency static preview server
tests/                        117 tests: engine, scraper, journal, dashboard + site
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
