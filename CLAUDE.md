# CLAUDE.md — Project Memory for `disaster`

This file is loaded automatically at the start of every session. Read it before exploring the
codebase. Its job is to save you from re-deriving the architecture from scratch every time —
if you learn something non-obvious about this repo, add it to the **Investigation Log** at the
bottom instead of letting it evaporate at the end of the session.

## What this is

A prototype for **SIH problem statement SIH260390** — "Real-Time Disaster Information
Aggregation Software" for the NDRF, built for Smart India Hackathon judging. Ingests
disaster-related reports from USGS, NASA EONET, GDACS, ReliefWeb, Mastodon, Bluesky, Reddit,
NewsAPI, GNews, and RSS feeds; classifies them (category, severity, location) via keyword rules
or Gemini AI; clusters related reports into incidents; renders them on a dashboard (cards or map)
for disaster response agencies.

**Design/product principles — preserve these, don't redesign them away:**
- Minimal white theme, navy accent (`#1E3A5F`), functional severity color coding (never
  decorative — always paired with a text label, never color-only), Inter for UI text, IBM Plex
  Mono for data/timestamps/numbers.
- **AI explains, rules decide**: Gemini classifies/extracts/summarizes; severity, credibility,
  and response-protocol decisions stay rule-based (`src/lib/severity.ts`,
  `src/lib/actionProtocol.ts`) so the system stays explainable and auditable.
- **Never synthesize headlines** — every headline shown is real text from a real source, never
  AI-rephrased. (`src/lib/gemini.ts`'s `generateAISummary`, despite the name, is a local
  deterministic template, not an AI call — see Known Gotchas.)
- **Zero layout shift** on live-updating elements (timestamps use fixed-width containers,
  `tabular-nums`).
- **Full traceability**: every severity change and AI summary is attributable to a triggering
  report/source and timestamp (`cluster.history`, `ClusterHistoryEntry`). Extended this session
  to data provenance itself — see "Demo-safety mode" below.

Stack: Vite + React 19 + TypeScript, Zustand for state, Tailwind v4, Leaflet for maps. Two
backend implementations of one shared `/api` contract: Express (local dev) and Vercel serverless
functions (production).

## Architecture

There is **one API contract** (`GET /api/reports`, `POST /api/situation-brief`), implemented
twice — once for local dev, once for Vercel production — because the two environments have
fundamentally different runtime models (long-lived process vs. stateless per-request function).
`src/data/mockApi.ts` picks the base URL at runtime via
`isVercel = !hostname.includes('localhost') && !hostname.includes('127.0.0.1')` and calls the
same paths against either one. Everything else (stats, clusters, incident-by-id, pulse timeline)
is derived **client-side** from the single `/api/reports` payload using
`performSmartClustering` (`src/lib/clustering.ts`).

### `/api/reports` response contract: `{ reports, mode, liveCount, generatedAt }`

Not a bare array. `mode` is `'live' | 'demo'` — see **Demo-safety mode** below. Both
`api/reports.ts` (Vercel) and `server/index.ts`'s `GET /api/reports` (Express) return this same
shape; `src/data/mockApi.ts`'s `parseBackendPayload()` defensively validates it before trusting
it (a bare-array or malformed response is treated as a failed fetch, not a crash).

### Demo-safety mode (required for live judging demos)

Live external APIs (Reddit, news APIs, Gemini, venue wifi) are a real liability mid-pitch. The
app never silently blends fake data into a healthy live feed, and never blanks out on failure:

- **`mode: 'live'`** — at least one genuinely live-ingested report exists this cycle. Only real
  reports are shown, no mock blending, however few there are (a thin real feed is still
  honestly live).
- **`mode: 'demo'`** — live ingestion failed, timed out, or returned zero results. Serves
  `getFreshMockReports()` (`src/data/mockReports.ts`, 60 curated realistic reports, freshly
  re-timestamped so they always read as "now") instead. Decided server-side per-request in both
  `api/reports.ts` and `server/index.ts` (Express decides by whether SQLite currently holds any
  non-`rep-*`-prefixed rows).
- **Client fallback chain** (`src/data/mockApi.ts`'s `getFreshLocalReports`): backend call →
  (if unreachable) `src/data/liveClientFetcher.ts` direct browser fetch (USGS/EONET/GNews only,
  India-filtered) → (if that's also empty) local demo snapshot. Every tier is honestly labeled.
- **Manual override**: `src/data/demoMode.ts` (`isDemoModeForced`/`setDemoModeForced`,
  localStorage-backed) + the "Demo Mode" toggle in `TopLiveHeader.tsx`. When armed, **zero
  network calls happen at all** for reports — deterministic, works with no connectivity. This is
  the presenter's pre-arm switch for known-risky venue wifi; the automatic fallback above is the
  safety net for *unexpected* failures. Toggling it must invalidate the client cache
  (`invalidateClientCache()`) and is included in `DashboardPage.tsx`'s fetch effect deps — easy
  to silently break by forgetting either (see Investigation Log 2026-08-16, this bit us once).
- **UI**: `TopLiveHeader.tsx` shows `LIVE (N)` / `DEMO SNAPSHOT` / `DEMO MODE (FORCED)`, never
  just "LIVE" unconditionally.
- **Tested by actually killing the backend process** (not just simulating) — see Investigation
  Log 2026-08-16. That test also caught a real bug: `liveClientFetcher.ts`'s EONET/USGS fetchers
  weren't India-filtered, so a real outage could've shown a Colorado wildfire labeled "LIVE."
  Fixed — both now apply the same India-relevance gate the server-side adapters use.

### 1. Local dev (`npm run server` + `npm run dev` — both required, two terminals)
- `server/index.ts`: Express app on port 3001. Runs `runPipeline()` once on boot, then every 3
  minutes via `setInterval`. Serves `/api/reports` and `/api/situation-brief` (the contract the
  frontend uses) plus legacy routes (`/api/reports/:id`, `/api/clusters`, `/api/clusters/:id`,
  `/api/clusters/:id/brief`, `/api/stats`, `/api/pipeline/run`) kept for manual testing — the
  frontend does not call these, don't add client dependencies on them without updating both.
- `server/pipeline.ts`: seeds/persists to SQLite, purges stale/invalid records, recomputes
  clusters, calls `server/aggregate.ts` for the actual fetch+classify work.
- `server/db.ts`: `better-sqlite3` writing to `server/disaster.db` (WAL mode, gitignored along
  with `-shm`/`-wal`). Dev-only convenience — **never assume this file exists or is shared in
  production**, it isn't (see path 2). If it ever needs resetting, delete all three
  (`disaster.db`, `-shm`, `-wal`) together, never just one or two.

### 2. Production (Vercel serverless functions)
- `vercel.json` declares `api/reports.ts` and `api/situation-brief.ts` as Vercel Functions. The
  SPA catch-all rewrite is `"/((?!api/).*)"` so it can never shadow the functions.
- `api/reports.ts`: runs `aggregateAndClassify()` with a module-scope in-memory cache (2 min TTL,
  `?refresh=true` to force) — this part is still per-warm-instance only, a cold instance just
  re-runs it. Separately, the set of *accumulated live reports* (see gotcha #7) is persisted in
  Redis via `@upstash/redis`'s REST client, provisioned via the Vercel Marketplace — see
  Investigation Log 2026-08-16, fifth/sixth entries — so it survives cold starts and is shared
  across concurrent instances, unlike the 2-min cache itself. Checks both
  `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` (Upstash's own naming) and
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` (the legacy "Vercel KV" naming the Marketplace
  integration actually injects when provisioned through the KV product wrapper — this project's
  case, confirmed via its Environment Variables screen). Falls back to an in-memory Map if
  neither pair is set, so the app still works (with the old per-instance-only caveat)
  before/without provisioning Redis. In-flight requests are coalesced into a single
  shared promise.
- `api/situation-brief.ts`: stateless — client POSTs the `IncidentCluster` it already computed;
  the function just runs `generateAISituationBrief(cluster)`.
- `server/aggregate.ts`: `aggregateAndClassify()` — fetches all 10 adapters concurrently via
  `Promise.allSettled`, each wrapped in an 8s timeout, filters to genuine India disasters,
  classifies (Gemini + keyword fallback), dedupes, sorts. **Shared by both `server/pipeline.ts`
  and `api/reports.ts`** — change ingestion logic here once, not in both places.
- `server/classifier.ts` is imported directly into the client bundle (via
  `liveClientFetcher.ts` and `src/lib/clustering.ts`) — zero Node built-ins, keep it that way.

## Directory map

```
api/
  reports.ts               Vercel function — GET, { reports, mode, liveCount, generatedAt }
  situation-brief.ts        Vercel function — POST { cluster }, stateless

server/
  index.ts                  Express app (dev only)
  pipeline.ts                dev-only: seed/persist/purge/cluster around aggregateAndClassify()
  aggregate.ts                aggregateAndClassify() — shared by pipeline.ts AND api/reports.ts
  hashId.ts                   SHA-1 short-ID helper — use for any new adapter's report IDs
  db.ts                      better-sqlite3 access (dev only)
  classifier.ts               keyword classification + FORBIDDEN_TERMS — BROWSER-SAFE, shared
                              with src/lib/clustering.ts and the client bundle
  adapters/*                  one file per external source
  services/
    aiClassifier.ts            Gemini classification w/ circuit breaker + cache + keyword fallback
    aiSituationBrief.ts        Gemini cluster situation brief w/ cache + local-template fallback

src/
  data/
    mockApi.ts               single client entry point: fetch /api/reports, derive everything
                              else client-side, demo-safety fallback chain (see above)
    demoMode.ts                localStorage-backed forced-demo-mode flag
    liveClientFetcher.ts       last-resort direct browser fetch (USGS/EONET/GNews, India-filtered)
    mockReports.ts             the demo-safety snapshot (60 curated realistic reports) — also
                              seeded once into dev SQLite if empty
  lib/
    clustering.ts             performSmartClustering — imports FORBIDDEN_TERMS from
                              server/classifier.ts rather than keeping its own copy (see gotcha)
    actionProtocol.ts          rule-based (category × severity) response-protocol lookup table —
                              NOT AI-generated, keeps "AI explains, rules decide"
    severity.ts, gemini.ts, pdfExport.ts, utils.ts
  store/useDashboardStore.ts   Zustand: filters, selection, ingestionMode/liveCount,
                              demoModeForced, viewMode ('cards' | 'map')
  pages/DashboardPage.tsx      owns data fetching, 3-min auto-refresh, view/panel composition
  components/
    layout/    TopLiveHeader (status badge, SITREP, Demo Mode toggle, view toggle),
               ErrorBoundary, HowThisWorks
    filters/   CategoryFilterBar (categories + severity + source-type + verified, one component —
               do not recreate a second filter bar, see Investigation Log 2026-08-16)
    dashboard/ DisasterCardGrid, DisasterCard, StatsBar
    map/       DisasterMap (lazy-loaded — see Coding Standards)
    incident/  IncidentDetailPanel (AI brief, response protocol, PDF export, audit log),
               MiniIncidentMap, SituationReportModal (SITREP CSV/print export)
  types/incident.ts           canonical types: DisasterReport, IncidentCluster, FilterState, etc.
```

**Deleted this session (confirmed unreachable from `App.tsx`'s route tree — see Investigation
Log 2026-08-16 for the full audit):** `src/pages/IncidentDetailPage.tsx`,
`src/components/layout/AppHeader.tsx`, `src/components/filters/FilterBar.tsx`,
`src/components/feed/{LiveFeedPanel,ReportCard}.tsx`. Don't recreate equivalents — their
functionality is fully covered by `DashboardPage`'s route-driven detail panel, `TopLiveHeader`,
and `CategoryFilterBar`/`DisasterCardGrid` respectively.

## Coding standards for this repo

- **TypeScript everywhere, no `any` in new code.**
- **Types live in `src/types/incident.ts`.** `server/`, `api/`, and `src/` all import from there.
- **Keep `server/classifier.ts` and `src/lib/clustering.ts` isomorphic** (no Node built-ins).
  Both are imported into the client bundle.
- **Ingestion/classification logic changes go in `server/aggregate.ts`**, not duplicated into
  `server/pipeline.ts` or `api/reports.ts` separately.
- **The India-relevance denylist (`FORBIDDEN_TERMS`) lives in `server/classifier.ts` only.**
  `src/lib/clustering.ts` imports it rather than keeping a copy — it drifted out of sync once
  already (two near-identical hardcoded arrays). If you add a new place that needs this list
  (a new adapter, a new client-side filter), import `FORBIDDEN_TERMS`, don't paste it.
- **Report IDs: use `hashId()` from `server/hashId.ts`**, never
  `Buffer.from(text).toString('hex').slice(0, N)` — see Known Gotchas #1.
- **Keyword matching (`classifier.ts`, `clustering.ts`) is bare `.includes()`, not
  word-boundary-aware.** Known, only-partially-fixed source of false positives (`'fire'` matches
  inside "fired"). If you see a miscategorized report, check for a substring collision before
  assuming ingestion itself is broken. A full fix needs a per-keyword audit for compound-word
  cases (`'fire'` should still match "wildfire" but not "fired" — not a simple `\b...\b` swap).
- **Pin AI model names, but expect them to rot.** Currently `gemini-flash-latest` (Google's
  rolling alias, chosen after `gemini-2.0-flash` and `gemini-2.5-flash` both 404'd within one
  session). If Gemini calls start 404ing, check
  `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY` for what's
  live before changing anything else.
- **External fetches**: timeout + `Promise.allSettled` over `Promise.all` for independent
  sources — one dead source should never blank the whole response.
- **No hardcoded secrets/keys**, even as a "fallback" default.
- **Don't add abstraction for a single call site.**
- **Wrap independent page sections in `<ErrorBoundary section="...">`** (see
  `src/components/layout/ErrorBoundary.tsx`) — a malformed report/cluster crashing one section
  (map, card grid, detail panel) must never blank the whole dashboard, especially mid-demo.
- **Code-split heavy, rarely-used features.** `DisasterMap` (Leaflet) and `pdfExport.ts` (jsPDF +
  html2canvas, ~600KB combined) are both dynamically imported (`React.lazy` / inline
  `await import()`) so they never load until the user actually opens the map or clicks download —
  keeps the initial bundle lean. Follow this pattern for any future heavy, optional feature.
- **Accessibility**: interactive elements need `aria-label`/`title` if icon-only; anything with
  `role="button"` needs a real `onKeyDown` (Enter/Space) handler, not just `tabIndex` — a
  `role="button"` `<article>` that only handles `onClick` is keyboard-focusable but NOT
  keyboard-operable, which is a real accessibility bug, not a nitpick (see
  `DisasterCard.tsx`'s `handleKeyDown`).
- **Rule-based, not AI-generated, response guidance.** `src/lib/actionProtocol.ts`'s
  `getSuggestedProtocol(category, severity)` is a fixed lookup table, deliberately not an LLM
  call — keeps "AI explains, rules decide." It's labeled "Suggested Response Protocol... not
  source-attributed dispatch instructions" in the UI; don't let it start looking like a real
  agency's actual order. A report's own `actionRequired` field (when a source states one) is
  shown separately, attributed to that source.
- Formatting/linting: `npm run lint` (oxlint). No test suite exists — manual/Playwright
  verification is required for UI changes, and expected to be reported as such.

## Known gotchas

1. **Report IDs**: see Coding Standards — `hashId()`, never raw hex-slicing.
2. **Gemini model names retire without notice** — both `aiClassifier.ts` and
   `aiSituationBrief.ts` hardcode the model string; keep them in sync if you change it.
3. **`src/lib/gemini.ts`'s `generateAISummary` is NOT an AI call** despite the name — it's a
   deterministic local template, used only as the last-resort fallback if
   `/api/situation-brief` itself is unreachable. Don't be misled by the filename.
4. **`api/reports.ts`'s 2-minute request cache is still per-warm-instance, not global** —
   different concurrent Vercel instances can briefly disagree on *when* they last refreshed.
   Fine for this app. The separate *accumulated live reports* set (gotcha #7) no longer has this
   limitation as of the Upstash Redis integration (Investigation Log 2026-08-16, fifth entry) —
   only the short-lived request cache is still instance-local.
5. **Forgetting to invalidate the client cache / add a store field to `DashboardPage`'s effect
   deps silently breaks a toggle** that should cause an immediate refetch — happened with the
   Demo Mode toggle (badge changed, data didn't) before being caught by actually testing it, not
   just checking the build succeeded. If you add a new toggle that should change what
   `/api/reports` (or the fallback chain) returns, make sure something actually re-triggers the
   fetch effect, and verify it visually, not just structurally.
6. **`server/disaster.db*` are gitignored** (`db`, `-shm`, `-wal` all three, since 2026-08-16 —
   previously only `-shm`/`-wal` were tracked while `.db` wasn't, which caused a real corruption
   incident, see Investigation Log 2026-08-15 second entry).
7. **`api/reports.ts` must accumulate live reports across cache cycles, not just cache the
   latest pass.** A single ingestion pass (8s-per-source timeout across 10 sources, sparse
   real-time India disaster news) very often finds zero *new* items — that's normal, not a
   failure. Before the fix in Investigation Log 2026-08-16 (second entry), `refreshReports()`
   fully replaced the cache with whatever that single pass found, so any quiet pass flipped
   production back to `mode: 'demo'` (the same 60 static headlines, just re-timestamped) even
   after real reports had been showing. Fixed via an accumulator (headline-keyed, capped at
   `MAX_ACCUMULATED_REPORTS`/`MAX_ACCUMULATED_AGE_MS`) that every pass merges into rather than
   replaces — the serverless analog of `server/pipeline.ts` inserting into SQLite on every run.
   `mode` only reverts to `'demo'` if the accumulated set has *never* held a single live report.
   As of Investigation Log 2026-08-16's fifth entry this accumulator is persisted in Upstash
   Redis (survives cold starts, shared across instances) rather than plain module-scope state —
   see `mergeLiveReports()` in `api/reports.ts`. If you touch `api/reports.ts` again, preserve
   this merge-not-replace behavior — reverting to a full-replace cache silently reintroduces the
   "production never updates" bug. **Also preserve `pruneAndCap()`'s re-validation of already-
   accumulated reports against `isStrictIndiaDisaster`** (added in the tenth entry) — without it,
   a report classified before a `FORBIDDEN_TERMS`/`CATEGORY_CHECK_ORDER` fix ships stays visible
   in production forever afterward, since merges only ever add new reports, never re-check old
   ones against updated rules.
8. **Every relative import in `api/**/*.ts` and `server/**/*.ts` (and any `src/` file they
   import, e.g. `src/types/incident.ts`, `src/data/mockReports.ts`) MUST use an explicit `.js`
   extension** (`import x from './foo.js'`, referencing a `.ts` file on disk — standard TS/Node
   ESM convention, not a typo). `package.json` has `"type": "module"`, so Vercel's function
   builder type-checks these files under `module`/`moduleResolution: nodenext`, which makes
   extensionless relative imports a hard build error (`TS2835`) — **the whole Vercel deployment
   silently fails to build**, with no visible symptom beyond "the site never picks up new code"
   (see Investigation Log 2026-08-16, third entry — this is what made gotcha #7's fix a no-op
   until this was also fixed). Invisible locally: `api/`/`server/` aren't covered by any
   tsconfig (`tsconfig.app.json` only covers `src/`, and uses `moduleResolution: bundler`, which
   doesn't require extensions), and `npm run server` runs via `tsx`, which doesn't type-check at
   all. Before pushing any change to `api/`/`server/` imports, verify Vercel-mode resolution with
   a throwaway tsconfig (`module`/`moduleResolution: "nodenext"`, `include` the touched files) —
   see the Investigation Log entry for the exact command. Frontend-only files (`src/pages`,
   `src/components`, `src/store`, etc.) are never touched by the Vercel function build, so leave
   their imports extensionless as before.

## Investigation log

Append a dated entry here whenever you complete non-trivial investigation, so the next session
can start from your conclusion instead of re-reading the whole codebase. Prune entries that get
superseded or invalidated by later code changes.

### 2026-08-15 — Vercel "stuck" diagnosis → real backend fix → data-quality fix
Three passes in one thread: (1) diagnosed why prod looked stuck — client already had a
`liveClientFetcher.ts` fallback, but a hardcoded public GNews key + fragile `allorigins.win` RSS
proxy were silently failing; (2) built real Vercel serverless functions (`api/reports.ts`,
`api/situation-brief.ts`, `server/aggregate.ts` shared with dev), fixed `vercel.json`'s rewrite
to not shadow `/api/*`, fixed a hardcoded-localhost bug that made the AI brief always broken in
prod, fixed retired `gemini-2.0-flash` → `gemini-flash-latest`; (3) after user reported "still
the same," found and fixed a self-inflicted SQLite corruption (see gotcha #6) plus the real data
bug: RSS/GNews/NewsAPI ID generation collided almost every item onto one row
(`Buffer.from(url).toString('hex').slice(0,16)` — fixed via `hashId()`), and the India-relevance
filter's bare `'up'`/`'met'` substring checks let global GDACS/Indonesia/heatwave content through
as "India disasters" (removed both terms). Full detail preserved in git history if needed;
summarized into Architecture/Coding Standards/Gotchas above rather than kept verbose here.

### 2026-08-16 — Full SIH-judging audit: cleanup + demo-safety + gap-closing
Two-part task: (1) dead-code/duplication audit before deleting anything, (2) gap analysis against
the actual PS text + required demo-safety fallback mode.

**Audit** (via a component-reachability trace from `main.tsx`/`App.tsx`): confirmed
`IncidentDetailPage.tsx` was never routed (both `/` and `/incident/:id` point at `DashboardPage`),
`AppHeader.tsx`/`FilterBar.tsx` were fully superseded duplicates of `TopLiveHeader`/
`CategoryFilterBar`, `LiveFeedPanel`/`ReportCard` were a redundant alternate view of the same
data `DisasterCardGrid` renders — all deleted. Found `StatsBar.tsx`, `DisasterMap.tsx`,
`SituationReportModal.tsx`, and `src/lib/pdfExport.ts` were also orphaned but well-built and
directly PS-relevant — revived and wired in rather than deleted (see Directory map). Also found
a third copy of the same filter-predicate logic in `server/index.ts` (`filterReports`, unused
since the client stopped sending server-side filter query params) — deleted; and confirmed
`src/lib/clustering.ts`'s `isDisasterTopic` duplicated `classifier.ts`'s forbidden-terms list —
fixed by exporting `FORBIDDEN_TERMS` and importing it (see Coding Standards).

**Demo-safety mode** (required deliverable): redesigned the mock/live data relationship from
"always permanently blend mock + live" to the two-state `live`/`demo` contract described in
Architecture above, with a presenter-controlled forced-demo toggle. Tested three ways: (a) forced
toggle on/off — caught a real bug where toggling didn't actually refetch (missing store dep in
`DashboardPage`'s effect + missing cache invalidation), fixed; (b) **actually killed the Express
process** (not simulated) and reloaded — caught a second real, more serious bug:
`liveClientFetcher.ts`'s client-side EONET/USGS fallback wasn't India-filtered, so the automatic
fallback briefly showed a Colorado wildfire and an Indonesian earthquake labeled "LIVE" — fixed
by applying the same `isStrictIndiaDisaster` gate server-side adapters already use, and dropping
USGS's magnitude-based bypass of the South-Asia bounding box. Re-tested after the fix: dead
backend → correctly and immediately falls to `DEMO SNAPSHOT`, zero irrelevant content, zero
crash.

**Other gaps closed**: `actionRequired` existed in the type/DB schema and mock data but was never
populated for live reports and never rendered anywhere in the live UI — added
`src/lib/actionProtocol.ts` (rule-based, not AI-generated, category×severity lookup) plus display
of both that and any source-stated `actionRequired`, in `IncidentDetailPanel`. Added a top-level
`ErrorBoundary` (there were zero anywhere in the app before this). Fixed a real accessibility bug
in `DisasterCard.tsx`: `role="button"` + `tabIndex={0}` with no `onKeyDown` — keyboard-focusable
but not operable; verified the fix with an actual Tab+Enter Playwright test, not just code
inspection. Code-split `DisasterMap` and `pdfExport.ts` (jsPDF+html2canvas, ~600KB) behind
`React.lazy`/dynamic `import()` so first load isn't paying for either. Verified mobile layout at
375px width (no horizontal scroll, detail panel becomes a proper full-screen overlay). Added a
small "How this works" popover for judges unfamiliar with the system. Deliberately did NOT add a
fabricated "time saved vs. manual monitoring" counter — no real baseline exists to compute it
against, and inventing one would conflict with the project's own honesty/traceability principles;
the existing "Reports Ingested (1hr)" / "Active Channels" stats already convey monitoring scale
without fabricating a number.

### 2026-08-16 (second entry) — "Localhost is live, production never updates" root cause
User reported the deployed Vercel site always showed the same static-looking headlines
(re-timestamped as "Updated 1 minute ago" etc. but never actually changing), while `npm run
server` locally looked genuinely live. Both environments run the *identical* ingestion code
(`server/aggregate.ts`'s `aggregateAndClassify()`, shared per Architecture above) — the bug
wasn't in ingestion logic, it was in how each environment's caching layer treated a single
ingestion pass finding nothing new. `server/pipeline.ts` (dev) inserts every found report into
SQLite on every 3-minute run and never clears it (except purging non-India items) — so real
reports accumulate over the life of the long-running dev process, and a quiet pass just adds
nothing rather than erasing prior finds. `api/reports.ts` (Vercel) had no equivalent: each 2-min
cache refresh called `aggregateAndClassify()` fresh and fully *replaced* the cache with whatever
that one pass returned — and a single pass (8s-per-source timeout across 10 sources including
several rss-parser feeds) very often nets zero *new* India-disaster items simply because
real-time India disaster news is sparse, not because anything is broken. Zero live items on that
pass meant an immediate, total fallback to `getFreshMockReports()` (the same 60 curated demo
reports, just re-timestamped) — so production looked permanently stuck on demo content almost
all the time, exactly matching the screenshot (KSDMA/Army/Brahmaputra headlines = the demo
snapshot's `rep-001..003` etc., not live ingestion). Fixed by adding an accumulating
`accumulatedLive` map in `api/reports.ts` (headline-keyed, capped by count and age) that every
pass merges new finds into rather than replacing — see Known Gotchas #7 for the mechanism and
why it must not be reverted to a full-replace cache. This is the serverless-appropriate analog
of dev's SQLite accumulation; it resets on cold start (acceptable, same category of limitation
as gotcha #4) but persists across the far more common case of a warm instance serving many
requests. Not yet verified against an actual Vercel deployment (no `vercel` CLI / linked project
in this environment) — verify post-deploy that `mode` reads `'live'` and headlines actually
rotate over a 10+ minute observation window, not just that the build succeeds.

### 2026-08-16 (third entry) — Why gotcha #7's fix didn't change anything: the build was never deploying
User reported the fix from the second entry made no visible difference — same static headlines,
same order, same relative timestamps, pixel-identical to the pre-fix screenshot. Asked the user
to check the Vercel deployment; they pasted the actual build log, which explained everything:
every relative import under `api/`/`server/` (and the `src/` files they import) was failing
TypeScript's `TS2835` ("relative import paths need explicit file extensions") under
`moduleResolution: nodenext` — which is what Vercel's function builder uses because
`package.json` declares `"type": "module"`. **The build has been failing on every deployment**
since the Vercel functions were introduced (2026-08-15), so the site was serving whatever the
last *successful* build was — none of the fixes from either of today's earlier entries, nor
likely anything from the 2026-08-15 session, had ever actually gone live. `npx tsc -b` locally
reported zero errors the whole time because `api/`/`server/` are outside every local tsconfig's
`include` (see gotcha #8). Fixed by adding explicit `.js` extensions to every relative import in
`api/reports.ts`, `api/situation-brief.ts`, `server/aggregate.ts`, `server/classifier.ts`,
`server/hashId.ts`'s importers, `server/services/{aiClassifier,aiSituationBrief}.ts`, all 10
`server/adapters/*.ts`, and `src/data/mockReports.ts` (the only `src/` file in the import chain
besides the type-only `src/types/incident.ts`, which has no imports of its own). Verified two
ways: (1) a throwaway tsconfig reproducing Vercel's exact settings —
`{"compilerOptions":{"module":"nodenext","moduleResolution":"nodenext","target":"es2022","skipLibCheck":true,"esModuleInterop":true,"resolveJsonModule":true,"noEmit":true,"types":["node"]},"include":["api/reports.ts","api/situation-brief.ts"]}`
— run via `npx tsc --noEmit -p <that file>`, zero errors after the fix, reproduced the exact
Vercel errors before it; (2) `npm run build` (the real frontend build) still succeeds, confirming
Vite/esbuild correctly resolves the now-`.js`-suffixed specifiers back to their `.ts` source
files for the files shared with the client bundle. Not yet confirmed against a live Vercel
deployment (no `vercel` CLI / linked project in this environment) — the next session should
verify the Vercel dashboard shows a successful build for this commit and that `mode` reads
`'live'` with rotating headlines, not just that these local checks pass.

### 2026-08-16 (fourth entry) — Confirmed live in production; one FORBIDDEN_TERMS false positive fixed
Verified the gotcha #7/#8 fixes actually worked by curling `https://ndrfdisaster.vercel.app/api/reports?refresh=true` directly: `mode: "live"`, `liveCount: 2`, real RSS-ingested reports from The
Hindu and NDTV. User confirmed the dashboard itself also showed `LIVE (2)` with those same two
cards after a hard refresh — the production "stuck on demo" issue from entries two and three is
resolved. Thin feed (2 reports) is expected/correct behavior, not a bug — most of the 10 sources
just had no India-disaster content on that particular pass; per the demo-safety design this is
still honestly shown as `live`, never padded. One of the two live reports was a real miscategorization: "Air India Express Flyer's Gun Goes Off At Varanasi Airport, 2 Security
Staffers Injured" (an accidental-discharge security incident, not a disaster) passed
`isStrictIndiaDisaster` and got tagged `medical` off the word "injured" — the same class of bug
as the "attacker... kirpan" case from 2026-08-16's first entry. Fixed the same way: added
targeted phrases to `FORBIDDEN_TERMS` in `server/classifier.ts` (`'gun went off'`, `'gun goes
off'`, `'accidental discharge'`, `'accidentally discharged'`, `'weapon discharge'`, `'firearm
discharge'`) rather than touching the broad `medical` keyword list itself. Verified via a
throwaway `tsx -e` script: the exact headline/description now returns `false` from
`isStrictIndiaDisaster`, while real flood/fire headlines still return `true`. This is a
whack-a-mole pattern, not a permanent fix — see Coding Standards' note on `.includes()`-style
keyword matching being only partially fixed; expect more of these one-off `FORBIDDEN_TERMS`
additions as new false-positive story types surface.

### 2026-08-16 (fifth entry) — Localhost (27 live reports) vs. production (1) volume gap: added Upstash Redis persistence
User compared localhost and production side by side after entry four's fix and found both
correctly showed `mode: 'live'`, but production had only 1 accumulated report vs. localhost's
27, and production reports all showed `classificationMethod: 'keyword-fallback'` with no
`AI-ASSISTED` badge. Two independent causes, not one: (1) `GEMINI_API_KEY` is very likely not
set in the Vercel project's environment variables — this is a dashboard action for the user, not
fixable from code (confirmed via the raw `/api/reports` response showing `keyword-fallback` for
every report); (2) the accumulator from gotcha #7 was still plain module-scope state, so it
reset on every Vercel cold start and was never shared across concurrent instances — unlike
`server/pipeline.ts`'s SQLite, which has been accumulating continuously on a single long-running
dev process for hours. Considered a Vercel Cron Job (`vercel.json` `crons`, hitting
`/api/reports?refresh=true` on a schedule to keep ingestion running without relying on visitor
traffic) as a same-architecture fix, but checked the current docs
(`vercel.com/docs/cron-jobs/usage-and-pricing`) first: **Hobby-plan cron jobs are capped at once
per day** (`0 * * * *`-style frequent schedules fail at deploy time) — only viable on Pro, and
the user's plan tier wasn't confirmed, so this wouldn't reliably help. User chose real
persistence instead: provisioned Upstash Redis via the Vercel Marketplace. Implemented in
`api/reports.ts`'s `mergeLiveReports()` — reads/writes the accumulated set to a single Redis key
(`disaster:accumulated-live-reports`) via `@upstash/redis`'s `Redis.fromEnv()` (reads
`UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`, both auto-injected by the Marketplace
integration), falling back to the old in-memory Map if those env vars are absent so the app
still works before/without provisioning it. Verified: throwaway-tsconfig Vercel-mode
`tsc --noEmit` still passes (bare package import, no extension needed), `npm run build` still
succeeds and bundle size is unaffected (the package is never imported into any `src/` file, so
it doesn't reach the client bundle). Not yet verified against the live Vercel deployment.

### 2026-08-16 (sixth entry) — Redis wasn't actually being used: wrong env var names
Fifth entry's Redis fix deployed but had no effect — `curl`ing `/api/reports?refresh=true`
directly still showed the accumulated set apparently *losing* reports between calls instead of
growing (a report present in one response was gone in the next, with a new one in its place).
Since this can't be diagnosed from outside without dashboard/log access, added a temporary
diagnostic field to the response, `accumulatorBackend: 'redis' | 'memory'` (see gotcha — it
reflects whether `redis` resolved non-null in `api/reports.ts`). It read `"memory"` even after
the user confirmed they'd connected Upstash. User then screenshotted the project's Environment
Variables screen: the integration had provisioned `KV_REST_API_URL`, `KV_URL`, `REDIS_URL`,
`KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN` — the legacy **Vercel KV** naming convention,
not `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` that `Redis.fromEnv()` looks for. This
happens when the Marketplace integration is provisioned through the "Vercel KV" product wrapper
rather than connecting an Upstash account directly — same underlying Upstash-backed Redis,
different env var names. Fixed by reading both naming conventions explicitly and constructing
the client manually (`new Redis({ url, token })` instead of `Redis.fromEnv()`) so it works
regardless of which path was used to provision it — see `api/reports.ts`'s `redisRestUrl`/
`redisRestToken` resolution. **If you ever re-provision storage for this project, check the
actual env var names in the dashboard rather than assuming `Redis.fromEnv()`'s defaults will
match** — this is the second time in this session an assumption about Vercel's environment
turned out to need on-the-ground verification (see gotcha #8 for the first). Also noted:
`VITE_GEMINI_API_KEY` has been set in Vercel since 2026-08-10 (visible in the same screenshot),
and `server/services/aiClassifier.ts` already checks `process.env.VITE_GEMINI_API_KEY` as a
fallback — so Gemini classification *should* work, but every response checked so far still
showed `classificationMethod: 'keyword-fallback'`. Not yet root-caused — next session should
check Vercel Function Logs for `[AI Classifier]` warnings (circuit breaker trips, Gemini API
errors) once the Redis fix is confirmed live, rather than assume the key itself is the problem.

### 2026-08-16 (seventh entry) — Gemini quota exhausted (not a bug); NewsAPI/GNews had the same VITE_-prefix env var mismatch as Gemini
Root-caused the "AI classification never runs" mystery from the sixth entry by adding a
diagnostic (`getAIClassifierDiagnostic()` in `server/services/aiClassifier.ts`, surfaced via
`api/reports.ts`'s response as `aiClassifier`) rather than guessing further: `keyPresent: true`,
`keyLength: 53` (key is fine) but `circuitBreakerOpen: true`, `lastGeminiError` a 429 —
**`gemini-flash-latest` currently resolves to `gemini-3.7-flash`, whose free tier caps at 20
requests/day**, already exhausted by testing during this session. Not a code bug — the
keyword-fallback path is the documented, correct degradation, and severity/credibility were
always rule-based regardless (see "AI explains, rules decide" in the top-level principles).
Self-resolves on the daily quota reset; sustained AI classification for an actual demo day needs
billing enabled on that Gemini key. User then asked to add real volume via NewsAPI/GNews and
pasted a second Environment Variables screenshot: same mismatch pattern as Gemini/Redis — the
keys exist as `VITE_NEWS_API_KEY` and `VITE_GNEWS_API_KEY`, but unlike
`server/services/aiClassifier.ts` (which already had a `VITE_GEMINI_API_KEY` fallback),
`server/adapters/newsApiAdapter.ts` and `gnewsAdapter.ts` only checked the un-prefixed
`NEWSAPI_KEY`/`GNEWS_KEY` — a real, fixable code bug this time, not a dashboard action. Fixed by
adding the same `|| process.env.VITE_*` fallback pattern to both adapters. **Takeaway for this
project**: this user's Vercel env vars are consistently `VITE_`-prefixed even for
server-only/non-Vite-bundled secrets — check for that prefix first before assuming a key is
missing, in any new adapter or service that reads `process.env` directly.

### 2026-08-16 (eighth entry) — Verified NewsAPI live + fixed a "complete collapse" political false positive
Added a third diagnostic (`getLastSourceDiagnostics()` in `server/aggregate.ts`, surfaced as
`sources` in `api/reports.ts`'s response) exposing per-adapter `fetchedCount`/`status`/`error` —
same rationale as the Redis/Gemini diagnostics: distinguishes "adapter's key/config is broken"
from "adapter works but found zero matching real disasters right now" without needing dashboard
log access. Confirmed via direct curl after the seventh entry's fix deployed: `NewsAPI` now
returns `fetchedCount: 30` (fix worked), `GNews` still returns `0` (not yet root-caused — could
be a still-invalid key, could be zero genuine matches; the diagnostic doesn't currently
distinguish an HTTP-error early-return from a genuinely empty result, unlike the richer Gemini
diagnostic — a reasonable next improvement if GNews stays at 0 after more checks). Also found and
fixed a new classifier false positive from the live feed: "'Complete collapse': Tejashwi
announces Raj Bhavan march over Bihar..." (Bihar opposition-politics story, Tejashwi Yadav is an
RJD leader) was tagged `building_collapse` off the political idiom "complete collapse." Initial
fix attempt added the bare phrase `'complete collapse'` to `FORBIDDEN_TERMS` — caught before
shipping via the same tsx sanity-check pattern used throughout this session: it also blocked a
genuine test headline ("Complete collapse of 3-story building in Mumbai kills 2"), a real false
negative, since that's completely natural real-disaster phrasing. Corrected to guard via
`'tejashwi'`/`'raj bhavan march'` instead — specific enough that a real structural-collapse
report would never contain either. **Reinforces the standing rule for every `FORBIDDEN_TERMS`
addition**: always test both directions (the false positive you're fixing AND a plausible real
disaster headline using similar wording) before committing, not just the case you're fixing.

### 2026-08-16 (ninth entry) — Pre-presentation push: more RSS sources, a systemic classification-order bug, and a wave of false positives
User needed real live volume working reliably for a presentation the next day. Investigated the
three sources stuck at 0 (`ReliefWeb`, `Bluesky`, `Reddit`) by curling their endpoints directly:
**ReliefWeb v1 is decommissioned** (`410 Gone`, "use v2 instead") and v2 requires a
pre-approved `appname` this project doesn't have (external approval process, deprioritized —
not fixable before a deadline); **Bluesky** returns a bunny.net/Cloudflare-style `403` bot-check
page, an IP/TLS-fingerprint-level block, not a header issue (not fixable without full OAuth);
**Reddit**'s unauthenticated public JSON endpoint now returns an HTML interstitial instead of
JSON (Reddit has tightened anti-bot enforcement on `www.reddit.com/*.json` since 2023) — would
need the already-supported-but-unused `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` OAuth path to
fix, deprioritized for the same reason. Chose the highest-value lever with zero new credentials
instead: **expanded `RSS_FEEDS`** in `server/adapters/rssAdapter.ts` from 7 to 11 (added
Hindustan Times, News18, India Today, Free Press Journal). Verification method matters here —
Zee News and DNA India both returned `200` to a plain `curl`, but **failed with `403` through
`rss-parser`'s actual Node HTTP client** (TLS-fingerprint bot detection, invisible to a
browser-UA curl test) — caught by testing end-to-end with `fetchRSSReports()` itself via a
throwaway `tsx` script, not just curling the URL, and left both out.

That same end-to-end test surfaced a **systemic classification-order bug**, not just isolated
false positives: `classifyCategory` checked `medical` before `landslide`/other specific
categories, and real disaster reports routinely mention "injured"/"hospital" alongside their
actual hazard — so genuine landslide/flood reports kept losing their real category to `medical`.
Concretely: "Wayanad landslide: Death toll rises to 3... injured several people" classified as
`medical` instead of `landslide`. Fixed by introducing an explicit `CATEGORY_CHECK_ORDER` array
in `server/classifier.ts` (`medical` checked last) instead of relying on `CATEGORY_KEYWORDS`
object key order — this is a systemic fix, not a `FORBIDDEN_TERMS` patch, and only changes
behavior when both a specific-hazard keyword and a medical-adjacent word are present (the common
case for real disaster news); a pure medical-only story still correctly falls through to
`medical`. The broader RSS coverage also surfaced five more real `FORBIDDEN_TERMS` cases in one
pass: three different phrasings of the same recurring Varanasi-airport-accidental-firearm-
discharge story ("gun going off," "accidental firing," "airport firing" — none matched the
fourth entry's original 'gun went off'/'gun goes off' guards), a Sukhbir Singh Badal
hospital-discharge follow-up to an assassination attempt ("Nanded Attack"), a crime/extortion
story ("Car Set on Fire" tripping the fire category), an AQI/clean-air story tripping flood via
'monsoon rain', a viral "man cooks omelette in heatwave" human-interest post, and — from
Mastodon, not RSS — a bicycle marketplace listing ("#Cyclone single-speed... on Sprocket")
tripping the cyclone category off a bike model literally named "Cyclone." All fixed via targeted
`FORBIDDEN_TERMS` additions, each verified both directions per the eighth entry's rule. Full
pipeline (`aggregateAndClassify()`) verified end-to-end afterward via the same tsx-script
pattern: one run returned 12 genuine reports, mostly a real cluster of Kerala/Karnataka/Mumbai
landslide and flood news from a legitimate outlet's (`@Mathrubhumi_English`) Mastodon account.

### 2026-08-16 (tenth entry) — Accumulator had no purge step: a fixed false positive stayed stuck in production for hours
User reported "not ingested" after the ninth entry's fixes deployed — the dashboard still showed
the exact "'Complete collapse': Tejashwi announces Raj Bhavan march..." card that had been fixed
hours earlier (commit `9003847`). Diagnosed via the `sources`/full-payload diagnostics: GNews
confirmed quota-exhausted (`403`, "reached your request limit for today" — expected, not a bug,
same class as Gemini's quota exhaustion in the seventh entry), and every other source was
fetching normally — so the classifier fix itself was fine, but gotcha #7's `mergeLiveReports()`
only ever validates *newly fetched* reports against `isStrictIndiaDisaster`; it never re-checks
what's already sitting in the Redis-persisted accumulated set. A report accumulated *before* a
`FORBIDDEN_TERMS` fix ships stays in Redis forever afterward — merges only ever add, never purge
against updated rules. This is exactly the gap `server/pipeline.ts`'s
`purgeNonIndiaReports()`/`purgeInvalidClusters()` closes for dev's SQLite, which `api/reports.ts`
never had an equivalent for. Fixed by re-validating every accumulated report (not just fresh
fetches) against `isStrictIndiaDisaster` inside `pruneAndCap()` on every merge — see the comment
there for the mechanism. **This means any future classifier fix (new `FORBIDDEN_TERMS` entry,
`CATEGORY_CHECK_ORDER` change, etc.) will now automatically flush already-accumulated reports
that no longer pass, on the very next `?refresh=true` or cache-expiry cycle — no manual
Redis-clearing needed.** If you ever touch `pruneAndCap()` again, preserve this re-validation
step; removing it silently reintroduces "a fixed false positive stays visible forever" bugs.

**Known risk for a live demo, not fully closed**: `classifyCategory`'s bare-substring keyword
matching still occasionally miscategorizes borderline real news (crime/political/viral/
marketplace content that happens to contain a category keyword as a substring). Nine concrete
instances found and patched via `FORBIDDEN_TERMS` so far across the session — see Investigation
Log for the full list. This is a whack-a-mole pattern by nature; expect more to surface with
broader source coverage, and always verify a fix both directions (see eighth entry) before
shipping. Low-severity/low-frequency in testing, but a judge who reads a card closely could notice
another one; treat any newly reported miscategorization the same way — a targeted
`FORBIDDEN_TERMS` addition, not a rewrite of the category keyword lists.
