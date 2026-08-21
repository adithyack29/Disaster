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
- **AI explains, rules decide**: Gemini classifies/extracts/summarizes; severity and credibility
  decisions stay rule-based (`src/lib/severity.ts`) so the system stays explainable and
  auditable. (The rule-based response-protocol lookup table that used to live in
  `src/lib/actionProtocol.ts` was removed at the user's request — a report's own
  `actionRequired` field, when a source states one, is still shown, attributed to that source.)
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
- **No manual override**: there used to be a presenter-controlled "Demo Mode" toggle
  (`src/data/demoMode.ts`, localStorage-backed, + a button in `TopLiveHeader.tsx`) that could
  force the demo snapshot on regardless of live ingestion status. Removed at the user's request
  (2026-08-17) — don't re-add it without being asked. The automatic fallback below (server-side
  `mode: 'live'`/`'demo'` decision + the client fallback chain) is the only demo-safety mechanism
  now; there is no way to force demo mode from the UI.
- **UI**: `TopLiveHeader.tsx` shows `LIVE (N)` / `DEMO SNAPSHOT`, never just "LIVE"
  unconditionally.
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
    liveClientFetcher.ts       last-resort direct browser fetch (USGS/EONET/GNews, India-filtered)
    mockReports.ts             the demo-safety snapshot (60 curated realistic reports) — also
                              seeded once into dev SQLite if empty
  lib/
    clustering.ts             performSmartClustering — imports FORBIDDEN_TERMS from
                              server/classifier.ts rather than keeping its own copy (see gotcha)
    severity.ts, gemini.ts, utils.ts
  store/useDashboardStore.ts   Zustand: filters, selection, ingestionMode/liveCount,
                              viewMode ('cards' | 'map')
  pages/DashboardPage.tsx      owns data fetching, 3-min auto-refresh, view/panel composition
  components/
    layout/    TopLiveHeader (status badge, view toggle, manual reload), ErrorBoundary
    filters/   CategoryFilterBar (categories + severity + source-type + verified, one component —
               do not recreate a second filter bar, see Investigation Log 2026-08-16)
    dashboard/ DisasterCardGrid, DisasterCard
    map/       DisasterMap (lazy-loaded — see Coding Standards)
    incident/  IncidentDetailPanel (AI brief, response protocol, audit log), MiniIncidentMap
  types/incident.ts           canonical types: DisasterReport, IncidentCluster, FilterState, etc.
```

**Deleted 2026-08-16** (confirmed unreachable from `App.tsx`'s route tree — see Investigation
Log 2026-08-16 for the full audit): `src/pages/IncidentDetailPage.tsx`,
`src/components/layout/AppHeader.tsx`, `src/components/filters/FilterBar.tsx`,
`src/components/feed/{LiveFeedPanel,ReportCard}.tsx`. Don't recreate equivalents — their
functionality is fully covered by `DashboardPage`'s route-driven detail panel, `TopLiveHeader`,
and `CategoryFilterBar`/`DisasterCardGrid` respectively.

**Deleted 2026-08-21** (UI removal at user's request, then a full dead-code sweep — see
Investigation Log 2026-08-21): `src/data/demoMode.ts` (already gone as of 2026-08-17, entry
stale until now), `src/components/layout/HowThisWorks.tsx` (judge-facing popover, no longer
linked from `TopLiveHeader`), `src/components/incident/SituationReportModal.tsx` +
`src/lib/pdfExport.ts` (SITREP/CSV export and per-incident PDF download, both removed from the
UI — no other caller), `src/components/dashboard/StatsBar.tsx` (the "Active Incidents / Critical
Now / Reports Ingested" summary row, removed from `DashboardPage`), `src/components/dashboard/
PulseTimeline.tsx` + `mockApi.ts`'s `getPulseTimeline()` (built but never wired into any page).
Don't recreate any of these without being asked.

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
- **Code-split heavy, rarely-used features.** `DisasterMap` (Leaflet, ~600KB) is dynamically
  imported (`React.lazy`) so it never loads until the user actually opens the map view — keeps
  the initial bundle lean. Follow this pattern for any future heavy, optional feature.
- **Accessibility**: interactive elements need `aria-label`/`title` if icon-only; anything with
  `role="button"` needs a real `onKeyDown` (Enter/Space) handler, not just `tabIndex` — a
  `role="button"` `<article>` that only handles `onClick` is keyboard-focusable but NOT
  keyboard-operable, which is a real accessibility bug, not a nitpick (see
  `DisasterCard.tsx`'s `handleKeyDown`).
- **No rule-based "suggested response protocol" lookup table.** There used to be one
  (`src/lib/actionProtocol.ts`, a fixed category×severity table, deliberately not an LLM call) —
  removed at the user's request. Don't re-add it without being asked. A report's own
  `actionRequired` field (when a source states one) is still shown, attributed to that source —
  that's the only response-guidance UI now.
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

### 2026-08-16 (eleventh entry) — "Localhost has real reports, production doesn't" root cause: outdated 8s/30s serverless timeouts
User reported production ( `ndrfdisaster.vercel.app`) showing only 2 thin cards while localhost
showed a rich, current feed including real Wayanad landslide/Uttarakhand tunnel collapse/
Arunachal flash flood stories. Diagnosed by curling `/api/reports?refresh=true` directly and
comparing against localhost's `/api/reports` side by side: both correctly read `mode: 'live'`
and the Redis accumulator was confirmed *not* resetting (three repeated `?refresh=true` calls a
few seconds apart all returned the same 4 reports, ruling out a cache/persistence bug) — so this
wasn't a repeat of gotchas #4/#7/#10. The `sources` diagnostic (added in the eighth entry) showed
the real cause: production's `RSS` adapter returned `fetchedCount: 4` on a pass run at the same
time localhost's continuously-running dev process had 15+ RSS items alone, including the exact
real disaster stories missing from production. Root cause: `server/aggregate.ts`'s
`SOURCE_TIMEOUT_MS` was `8000` and `vercel.json`'s `api/reports.ts` `maxDuration` was `30` —
both conservative defaults chosen before Vercel's Fluid Compute update, which now gives every
plan (including Hobby) a 300s function execution budget by default (confirmed via the
`vercel-functions` skill, not assumed). 8 seconds was too tight for `rssAdapter.ts`'s 11
concurrently-fetched feeds under real serverless network latency, even though the same fetch
comfortably completes within 8s on a local unconstrained connection — so production was
silently dropping most of a pass's real results as timeouts, not finding fewer to begin with.
Fixed by raising `SOURCE_TIMEOUT_MS` to `20000` and `maxDuration` to `60` (both still far under
the 300s platform ceiling, all 10 adapters still run concurrently via `Promise.allSettled` so
this doesn't serialize anything, just raises the ceiling for slow sources). Also found and fixed
two secondary bugs while investigating: (1) the Redis/in-memory accumulator's dedup key was raw
headline text (`report.headline.toLowerCase().trim()`) — a source that lightly edits its own
headline between two fetches of the same article ("IMD predicts heavy rain in 5 districts" →
"IMD predicts heavy rainfall in 5 districts", same URL) produced two near-duplicate accumulated
entries instead of one; changed the dedup key to `report.id` (a stable hash of the source URL
via `hashId()`) in both `dedupeByHeadlineMap`/now `dedupeByIdMap`'s call sites in
`api/reports.ts`; (2) a new `FORBIDDEN_TERMS` false positive — "'She May Smoke Weed, Have
Relationships With Other Men...': Bhopal Man Seeks Wife's Return" (a personal-life human-interest
story) tripped the `fire` category via the `'smoke'` keyword — fixed by adding the specific
phrase `'smoke weed'` rather than touching `'smoke'` itself, verified both directions (blocks the
false positive, still lets a real "toxic fumes"/"smoke visible for kilometers" fire headline
through) per the eighth entry's rule. Verified via the same tsx-script and throwaway
Vercel-mode-tsconfig pattern used throughout this session; `npm run build` and `npm run lint`
both still clean (only pre-existing warnings). Not yet confirmed against the live Vercel
deployment post-push — next session should re-curl `/api/reports?refresh=true` a few minutes
apart and check the `sources.RSS.fetchedCount` diagnostic rose closer to localhost's volume, and
that the duplicate Yanam-headline pair is gone from the accumulated set.

### 2026-08-16 (twelfth entry) — Migrated localhost's accumulated reports to production; found dev's SQLite has no age cap (unlike prod's 24h one)
User asked for localhost's full report set (29 accumulated) to appear on production, which only
had 2-4 at the time. Confirmed both environments were correctly showing `mode: 'live'` with valid
data — the gap was purely volume, from localhost's dev process accumulating continuously for
hours/days in SQLite vs. production's Redis accumulator only growing from its own thinner,
request-triggered ingestion passes (compounded by the eleventh entry's now-fixed timeout issue).
Did a one-time direct migration rather than waiting for organic re-accumulation: added a
temporary secret-protected endpoint (`api/admin-seed.ts`, protected by a `SEED_ADMIN_SECRET` env
var) that merges a POSTed batch of reports into the same Redis key `api/reports.ts` uses, with
identical dedupe-by-id/`pruneAndCap` logic; POSTed localhost's 29 accumulated reports to it (after
filtering through `isStrictIndiaDisaster` locally first, which itself dropped 7 more false
positives including a **third** distinct headline variant of the recurring Varanasi
accidental-discharge story — `"...passenger 'accidentally' fires during security check..."` —
none of the four existing guard phrases matched this wording; fixed by adding `'fires during
security check'` to `FORBIDDEN_TERMS`, verified both directions as usual); then deleted the
endpoint and removed the env var immediately after confirming the migration worked. Net result on
production: `liveCount` 2 → 6, not the full 29 — because `pruneAndCap()`'s `MAX_ACCUMULATED_AGE_MS`
(24h) correctly rejected the other 16 as stale, several by days (`mastodon-117007435413210688` was
418h/~17 days old, `rss-435b942fd1d2aa4d` over 9000h/~1 year old). **This surfaced a real,
previously-unnoticed gap**: `server/pipeline.ts` (dev) has no equivalent age-based purge —
`purgeNonIndiaReports()`/`purgeInvalidClusters()` only ever remove non-India/invalid rows, never
stale-but-still-valid ones — so a `npm run server` process left running for days will keep
showing week-old news as if current, which is inconsistent with the app's own "real-time"
demo-safety design that production correctly enforces. Not fixed this session (dev-only,
non-demo-facing, and out of scope for what was asked) but worth adding
`purgeStaleReports()`-equivalent to `server/pipeline.ts` if dev's feed volume is ever compared
against production's again, to avoid re-deriving this same "why is localhost bigger" confusion.

**Platform behavior worth remembering**: `KV_REST_API_URL`/`KV_REST_API_TOKEN`/etc. are marked
**Sensitive** in this project's Vercel dashboard (visible via `vercel env ls`) — `vercel env pull`
writes the literal string `"[SENSITIVE]"` for these instead of the real value, by design (Vercel
security feature, not a bug or a stale/misconfigured token). This blocks the "pull the value
locally and use it directly" approach for any sensitive var, even with a fully authenticated,
correctly-linked CLI session — the only ways to use a Sensitive var's real value are from inside a
deployed Function (which can always read its own `process.env` at runtime) or by having it typed
directly into a value you already know. If a future task needs to *use* a sensitive credential
from outside a Vercel Function again, the admin-endpoint pattern from this entry (temporary,
secret-protected, deleted after use) is the way to do it — don't waste time re-attempting
`vercel env pull` first.

### 2026-08-17 — Real report-volume bottleneck: a location dictionary missing a third of India's states
User reported localhost stuck around 29-31 reports and specific real news (Bihar temple
stampede, a West Bengal hotel fire) missing entirely despite being visibly fetched and correctly
classified by the pipeline. Root cause, found by manually replaying `runPipeline()`'s exact
insert/purge sequence step-by-step: `INDIAN_LOCATIONS` in `server/classifier.ts` had **no entry
for Bihar, West Bengal, Karnataka, Punjab, Rajasthan, Telangana, Jharkhand, Chhattisgarh, Goa,
Manipur, Mizoram, Nagaland, Tripura, Sikkim, Jammu & Kashmir, or Ladakh** — roughly a third of
India's states/UTs. Any report about one of them (with no separately-matched city) fell through
`extractLocation()`'s generic fallback (`placeName: 'Central Command Zone'`), which
`server/db.ts`'s `purgeInvalidClusters()` then hard-deletes every pipeline cycle as junk data
(that placeholder is also the signature of genuinely malformed/non-India records). So real,
correctly-classified reports about these states were being fetched, inserted, and then silently
deleted 3 minutes later, forever. Fixed by adding all missing states/UTs with real coordinates
(see `INDIAN_LOCATIONS`), plus a `'northeast india'`/`'north east india'` catch-all for
national-level stories that name the region collectively rather than a specific state. Also
fixed in the same pass: `CATEGORY_CHECK_ORDER` had `fire` checked before `building_collapse`, so
a genuine tunnel-collapse story mentioning an explosion as the cause ("tunnel collapsed following
an explosion suspected to be from methane gas") got miscategorized as `fire` — reordered
`building_collapse` before `fire` (same rationale as the existing medical-last ordering). Also:
`classifyCategory`'s whole-word keyword lists only had singular forms for several categories
(`flood`, `earthquake`, `landslide`, `cyclone`, `fire`), so real headlines using plurals ("Assam
floods:", "Earthquakes rattle...") classified as `null` and were dropped, not merely
misclassified — added the missing plurals. `mastodonAdapter.ts` was also only fetching one of
its 5 tag timelines per run (a leftover `Math.random()` selection) instead of all 5 concurrently
— fixed. Pushed to `main` (commit `763e080`); the `api/reports.ts` 24h→7-day accumulator-window
widening explored earlier in the same session was explicitly rejected by the user and reverted —
don't re-add it without being asked.

### 2026-08-17 (second entry) — Demo Mode manual toggle removed at user's request
The presenter-controlled "Demo Mode" toggle (`src/data/demoMode.ts` + the button in
`TopLiveHeader.tsx`, localStorage-backed `isDemoModeForced`/`setDemoModeForced`) was removed —
user asked to "remove the demo mode option," confirmed via clarifying question that this meant
only the manual toggle, not the automatic server/client fallback that shows the curated demo
snapshot when live ingestion genuinely fails. `demoMode.ts` deleted entirely;
`useDashboardStore.ts`'s `demoModeForced` state/`setDemoModeForced` action,
`DashboardPage.tsx`'s effect dependency on it, and `mockApi.ts`'s `isDemoModeForced()` checks (in
`getFreshLocalReports`/`triggerPipelineAndRefresh`) all removed. The automatic `mode: 'live'`/
`'demo'` fallback chain (server-side decision + `liveClientFetcher.ts` client fallback) is
untouched and is now the *only* demo-safety mechanism — there is no way to force demo mode from
the UI anymore. If this is ever needed again (e.g. for a future live judging demo on risky wifi),
it will need to be rebuilt from scratch, not just re-enabled.

### 2026-08-17 (third entry) — Full categorization audit: the DB-staleness bug that undermined every prior fix
User asked for a thorough audit of anything affecting report categorization. Found a chain of
issues, most significantly one that retroactively explains why several earlier classifier fixes
this session didn't visibly change already-stored reports:

1. **`db.ts`'s `insertReport` ON CONFLICT DO UPDATE SET excluded `category`, `placeName`,
   `district`, `state`, `lat`, `lng`.** A report's category and location were frozen at whatever
   they were on first insert, forever — every later pipeline run re-classifies and re-locates
   every report in memory, but writing it back to an existing row silently discarded the
   corrected values. Compounded by `pipeline.ts`'s loop never re-deriving `report.category` for
   rows read from `currentDB` in the first place (only `location` was refreshed). Fixed both
   halves: `insertReport`'s UPDATE SET now includes all six columns, and `pipeline.ts` now
   re-runs `classifyCategory()` for DB-sourced reports specifically (never for
   freshly-fetched ones, which already carry a fresh — possibly AI-derived — classification from
   `aggregateAndClassify()` this same run; re-deriving those too would downgrade a correct AI
   result to a lesser keyword-only one). Verified end-to-end: seeded a report with a
   deliberately-stale category, confirmed a pipeline run corrected it. The equivalent bug existed
   in production's Redis accumulator (`api/reports.ts`'s `pruneAndCap`/`mergeLiveReports` only
   ever re-validated *whether* an accumulated report is still a valid disaster, never
   re-classified *what category* it is) — added `refreshStaleCategories()`, applied to both the
   Redis and in-memory-Map accumulator paths, same "skip re-deriving anything a fresh fetch this
   pass already re-classified" rule.
2. **Systemic over-broad `FORBIDDEN_TERMS`**: the original un-commented opening block —
   `teacher`/`assignment`/`cricket`/`ipl`/`bollywood`/`actor`/`election`/`political party`/
   `speech`/`modi vs`/`rahul gandhi`/`bjp`/`congress`/`hindutva`/`controversy`/`stock market`/
   `sensex`/`gadget`/`smartphone`/`protest`/`lathi-charge`/`land dispute` etc. — was silently
   dropping genuine disaster reports wholesale, not filtering unrelated content. Confirmed via
   many realistic test headlines: "Assam floods: CM ... of BJP visits relief camp", "Bollywood
   actor donates Rs 1 crore to Kerala flood relief fund", "Flood victims protest against
   inadequate relief distribution in Bihar", "Stock market falls as Mumbai floods disrupt
   banking operations" — all genuine, `classifyCategory`-confirmed disaster headlines, all
   dropped. A politician responding to a disaster, a celebrity donating to relief, or disaster
   survivors protesting inadequate relief are common REAL disaster-news patterns in India, not
   irrelevance signals. Testing also confirmed these terms added no unique value against the
   pure non-disaster stories they were presumably meant to catch — those already return a null
   category on their own (no real `CATEGORY_KEYWORDS` term present). Removed the whole block;
   replaced its one real function — guarding English idioms that borrow a disaster word
   ("landslide victory", "political storm", "flood of votes", "political earthquake") — with
   specific idiom-phrase guards that only fire on the idiom itself.
3. **Cross-category keyword collisions**: bare `'depression'` (mental-health articles → wrongly
   tagged `cyclone`), bare `'surge'` (stock-market/power-surge stories → wrongly tagged `flood`),
   `'outbreak'`/`'epidemic'` used idiomatically ("outbreak of violence" → wrongly tagged
   `medical`), `'collapsed'` used as a financial idiom ("income... collapsed" — a Tata Steel
   Jamshedpur FC finance story → wrongly tagged `building_collapse`, found live on the actual
   dashboard), and `'monsoon rain'` matching a botany/nature feature about ferns (found live on
   the dashboard, tagged `flood`). Narrowed the meteorological keywords to specific phrases
   (`'deep depression'`, `'storm surge'`/`'tidal surge'`/etc.) and added targeted idiom/topic
   guards, verified both directions each time (blocks the false positive, a real disaster
   headline using similar wording still passes).
4. **`extractLocation()` picked the first *array-order* match, not the first *text-position*
   match** — "Kerala geologist died in Sikkim tunnel collapse" extracted Kerala (the victim's
   home state, incidentally listed earlier in `INDIAN_LOCATIONS`) instead of Sikkim (the actual
   incident location). Rewrote to find whichever candidate keyword's regex match has the lowest
   index in the actual text. Not a complete fix — a headline naming the secondary state literally
   before the incident location in word order (as in the Kerala/Sikkim example itself) still
   picks the earlier-mentioned state — but it now handles the far more common case (Jharkhand
   workers example) correctly, and no longer depends on file-declaration order at all.
5. **`CATEGORY_CHECK_ORDER`'s severity counterpart**: `inferSeverity`'s bare `'high'` term
   inflated a routine "Delhi High Court dismisses flood compensation case" legal story to HIGH
   severity via "High Court". Narrowed to `'high alert'`/`'high risk'`/`'highly affected'`.
6. **Adapter-level category fallbacks**: `gdacsAdapter.ts`/`blueskyAdapter.ts`/
   `reliefwebAdapter.ts`/`newsApiAdapter.ts`/`gnewsAdapter.ts` all defaulted to `|| 'flood'` (
   `gdacsAdapter.ts` to `|| 'cyclone'`) when `classifyCategory` returned null, instead of
   skipping the report — `mastodonAdapter.ts` was worst, using `(tag as any) || 'flood'`, where
   the tag `'disaster'` isn't even a valid `CategoryType`. `eonetAdapter.ts` defaulted unmatched
   EONET event types (Volcanoes, Drought, Snow, Sea and Lake Ice) to `'cyclone'`. In practice
   `aggregate.ts`'s downstream `isStrictIndiaDisaster` re-check (which re-derives category from
   the same text independently) already caught and excluded all of these before they reached a
   user — so this had no visible effect on production, but the report objects were incorrect in
   the meantime, relied entirely on that downstream safety net, and `mastodonAdapter.ts`'s
   `as any` violated the project's own no-`any` standard. Fixed all six to skip (`continue`)
   instead of guessing, matching `rssAdapter.ts`'s existing correct pattern. Also fixed
   `gdacsAdapter.ts`/`blueskyAdapter.ts` using `Math.random()` as a report-ID fallback when
   `guid`/`cid` was missing — non-deterministic, so the same article re-fetched twice would get
   two different random IDs and defeat dedup entirely; switched both to `hashId()` of a stable
   fallback string.
7. **`aiClassifier.ts`'s AI-result merge matched reports back to Gemini's response by re-`
   findIndex`-ing for a matching headline string**, not by array index — two reports sharing a
   byte-identical headline (common with wire-service syndication across outlets) meant
   `findIndex` always resolved to the *first* such report, silently assigning every later
   duplicate-headline report the wrong report's AI classification result. Fixed to match by the
   loop index directly (which is exactly what the prompt's per-item `id` field was set to when
   built), removing the fragile headline re-lookup entirely.

Left deliberately unfixed (documented, not silently ignored): a handful of generic `medical`
keywords (`'ambulance'`, `'trauma'`, `'dengue'`, `'hospital'`) still false-positive on unrelated
health-adjacent human-interest stories ("Ambulance stuck in Bengaluru traffic", "Dengue
awareness camp held in Kolkata") — narrowing these further risks reintroducing false negatives
on real medical-emergency disaster reports, and unlike the fixed cases these are at least
topically health/safety-adjacent, not wrong-domain. Also left the Sikkim tunnel-collapse story's
one sibling headline that only says "methane gas explosion" (no "collapse" word at all) tagged
`fire` instead of `building_collapse` — a genuine content ambiguity in that specific article's
own wording, not a classifier bug, though it does fragment that incident's cluster into two
cards. All fixes verified via the same tsx-script-both-directions pattern used throughout this
project, plus a full re-run of every regression test accumulated across this session (all still
pass), `npm run build`/`npm run lint` clean, and a live end-to-end pipeline run confirming both
the DB-staleness fix and the two live false positives (Jamshedpur FC, the fern feature) actually
resolved on the running dashboard.

### 2026-08-21 — UI removal (HowThisWorks/SITREP/StatsBar) + full-codebase dead-code sweep
Two-part session. **Part 1** — user asked to remove specific UI pieces one at a time: the "How
this works" popover (deleted `HowThisWorks.tsx`, its only import site in `TopLiveHeader.tsx`);
the SITREP button/modal including its CSV export (deleted `SituationReportModal.tsx`) and,
separately, the per-incident PDF download button in `IncidentDetailPanel` (deleted
`pdfExport.ts` — no other caller); the "Active Incidents / Critical Now / Reports Ingested" stats
row (deleted `StatsBar.tsx`, unwired from `DashboardPage`). Each removal included tracing every
prop/import that only existed to feed the deleted piece (e.g. `TopLiveHeader`'s `reports`/`stats`
props, `mockApi.ts`'s `computeStats`) rather than leaving orphaned plumbing behind.

**Part 2** — user asked for a full-codebase pass to remove dead code/files and simplify without
changing behavior. Method: cross-referenced every `export` in `src/`, `server/`, `api/` against
the rest of the codebase (grep-based usage count, both same-file and external) to separate
"exported but only used internally" (fine, left alone) from "referenced nowhere at all" (removed).
Verified every removal against `npm run build` (`tsc -b` — `noUnusedLocals`/`noUnusedParameters`
are on for `src/`, so this also catches any newly-orphaned local), `npm run lint`, a throwaway
Vercel-mode `tsc --noEmit` check (per gotcha #8) covering `api/reports.ts` +
`api/situation-brief.ts`, an equivalent bundler-mode check with `noUnusedLocals` enabled across
all of `server/`+`api/` (not covered by any real tsconfig otherwise), and one live
`npx tsx server/index.ts` run confirming `/api/reports` still serves real ingested data
end-to-end. No browser tool was available in this environment to click through the UI directly;
correctness relied on the type-checker catching any prop/shape mismatch from the removals below
(a mismatch would have failed `tsc -b`, which stayed clean throughout) plus manual review of
every touched render path.

Found and removed:
- **Fully dead files**: `PulseTimeline.tsx` component + `mockApi.ts`'s `getPulseTimeline()` (a
  24-bucket hourly chart, built but never rendered from any page — `recharts` was installed for
  exactly this and never actually used, uninstalled). `src/App.css`, `src/assets/{hero.png,
  react.svg,vite.svg}` (unreferenced Vite-template leftovers), `public/icons.svg` (an unused
  social-platform icon sprite, no `<use>` reference anywhere).
- **Dead exports in `mockApi.ts`**: `getReports`, `getIncidentById`, `getClusterById`,
  `computeStats`, `getStats`, `pushLiveReport` — none had any caller once `getReportsWithStatus`
  became the sole frontend entry point (see Architecture). Removing `pushLiveReport` also let
  `sessionPushedReports` (the module-level array only it ever wrote to) collapse into nothing —
  simplified `getFreshLocalReports`'s merge accordingly.
- **Dead selection-state subsystem in `useDashboardStore.ts`**: `selectedIncidentId`,
  `selectedClusterId`, `isDetailOpen`, `liveMode`, `setSelectedIncident`, `closeDetail`,
  `toggleLiveMode` — written to (from `DisasterMap.tsx`'s `onSelectReport` fallback branch) but
  never read anywhere; the real incident-detail-open mechanism has been react-router's
  `/incident/:clusterId` param (`DashboardPage`'s `activeClusterId`) all along, not this store
  state. Since `DisasterMap` has exactly one render site (`DashboardPage`) and it always passes
  `onSelectReport`, made that prop required and deleted the dead fallback branches rather than
  leaving unreachable code + unused store wiring to support a caller that doesn't exist (matches
  the project's own "don't add abstraction for a single call site" standard).
- **Dead filter dimensions**: `FilterState.region`/`searchQuery`/`timeRange` and their
  `setRegion`/`setSearchQuery`/`setTimeRange`/`setCategoryFilter`/`setSeverityFilter` store
  actions — `CategoryFilterBar` (the only filter UI in the app) never exposed a search box,
  region picker, or time-range control, so these fields could never become anything but their
  defaults; removed the fields, the actions, and the three corresponding dead branches in
  `mockApi.ts`'s `applyFilters`.
- **Dead config fields**: `SeverityConfig`'s `bgSubtle`/`borderHex`/`badgeBg`/`badgeText`/
  `description`/`priorityOrder`/`level` and `CATEGORY_CONFIG`'s `iconName` in `severity.ts` — only
  `.color` and `.label` were ever read anywhere (icons are rendered via hardcoded switch
  statements per component, not a string→icon lookup); every severity/category config object
  trimmed to just the two fields actually used.
- **Small dead helpers**: `isIndiaRelated()` in `server/classifier.ts` (an unused wrapper around
  `isStrictIndiaDisaster`), `cn()` in `src/lib/utils.ts` (a `clsx`+`tailwind-merge` classname
  helper with zero call sites — `clsx`/`tailwind-merge` uninstalled alongside it), unused
  `clientId`/`clientSecret` env reads in `redditAdapter.ts` (dead — no OAuth branch actually
  exists to use them, see gotcha/coding-standard on the Reddit OAuth path being unimplemented),
  unused `inferSeverity` import in `usgsAdapter.ts` (severity there is derived from magnitude,
  not text), unused `CategoryType`/`SeverityLevel` type imports in `aiClassifier.ts`.
- **Unused npm dependencies removed**: `jspdf` (orphaned once `pdfExport.ts` was deleted),
  `recharts`, `clsx`, `tailwind-merge` — confirmed zero references anywhere in `src`/`server`/`api`
  before uninstalling.
- **Cosmetic**: replaced several unused `catch (e)`/`catch (err)` bindings with bare `catch {}`
  (`server/db.ts`, `server/index.ts`, `IncidentDetailPanel.tsx`, `mockApi.ts`) — zero behavior
  change, just drops the now-pointless binding.
- **Docs**: updated the directory map, "AI explains, rules decide" principle, and the dedicated
  coding-standard bullet that all still described `src/lib/actionProtocol.ts` and
  `src/data/demoMode.ts` as living files — both were already deleted from the working tree before
  this session started (the former "removed at the user's request" per a comment left in
  `IncidentDetailPanel.tsx`, the latter per the 2026-08-17 entry above) but the docs describing
  them hadn't caught up.

Deliberately left alone: exports that are used only within their own file (e.g. `ReportsPayload`
in `api/reports.ts`, `SourceDiagnostic` in `aggregate.ts`, `AIClassificationResult` in
`aiClassifier.ts`) — not dead, just not imported elsewhere, and stripping their `export` keyword
would be a cosmetic-only change with no real benefit. Also left the three still-broken source
adapters (ReliefWeb v1 decommissioned, Bluesky bot-walled, Reddit anti-bot) wired into
`aggregate.ts` untouched — they're a known, documented, intentional state (see the 2026-08-16
ninth entry), not dead code to prune, and removing them would be a functional/product decision
outside the scope of "remove code nothing uses."

### 2026-08-21 (second entry) — Added a Gemini "is this a genuine disaster" gate; fixed two real clustering bugs
User reported the dashboard was showing clearly non-disaster content (an obituary, a political
dharna, a crime story, a military exercise) and that unrelated reports were landing on the same
incident card, and asked specifically for Gemini to be used to decide relevance rather than more
keyword patching. Confirmed both against the live dev DB (128 accumulated reports) before
touching anything.

**Root cause 1 — the keyword gate never got a second opinion.** `aggregate.ts`'s pipeline runs
`isStrictIndiaDisaster` (pure keyword) BEFORE `classifyReportsBatch` (Gemini) — Gemini only ever
refines the *category* of something that already passed the keyword gate, it never gets to
reject it outright. Fixed by adding `isGenuineDisaster: boolean` to `AIClassificationSchema`
(`server/services/aiClassifier.ts`), a much stronger prompt instructing Gemini to reject
political/crime/obituary/military-drill/administrative-notice/pure-forecast content even when it
contains a disaster keyword like "hospital" or "fire", and having `applyAIResultToReport` return
`null` (dropped by the caller) when Gemini says false. Defaults to `true` on any parse hiccup —
never silently drop something on an ambiguous signal. **This only takes effect when Gemini is
actually reachable** — mid-implementation, live testing hit the documented 20/day free-tier quota
(confirmed via a direct `generateContent` call, not assumed: `429 ... GenerateRequestsPerDayPerProjectPerModel-FreeTier`,
limit 20) — so as an immediate, quota-independent stopgap, also added 8 new `FORBIDDEN_TERMS`
entries in `server/classifier.ts` for the exact false positives found (`'age-related health
issues'`, `'pellet gun row'`, `'on way to kill'`, `'yudh abhyas'`, `'gets army award'`, `'chinese
manjha'`, `'trafficking racket'`, `'will schools remain closed'`), each verified both directions
per the established convention. These are explicitly a safety net for when Gemini is unavailable,
not a replacement for the AI gate.

**Root cause 2 — a wire-service dateline bug in `extractLocation()`.** A real Arunachal Pradesh
flash-flood story (4 dead) was clustering under "Delhi" — traced to `extractLocation` checking
`INDIAN_LOCATIONS` for the earliest text match, then falling back to the separate
`PRADESH_FALLBACKS` list (which is where "Arunachal Pradesh" lived) ONLY if zero
`INDIAN_LOCATIONS` matches existed anywhere in the text — so a "NEW DELHI:" wire dateline
elsewhere in the body (standard PTI/TOI byline format, meaning where the story was *filed*, not
where the disaster happened) always won, regardless of "Arunachal Pradesh" appearing at index 0
of the headline. Fixed by racing `PRADESH_FALLBACKS` in the exact same positional comparison as
`INDIAN_LOCATIONS` instead of as an all-or-nothing last resort. Verified directly:
`extractLocation()` on the real headline+description now correctly returns Arunachal Pradesh, and
after a pipeline run the live report's `location` updated accordingly (pipeline.ts already
recomputes every report's location every cycle, so this fix retroactively corrected the
already-accumulated bad data with no manual migration needed).

**Root cause 3 — keyword-overlap clustering had no bound on cluster vocabulary growth, and no
place-mismatch veto.** Traced two more real bad merges: a Kolkata hotel fire cluster had
absorbed an unrelated Tarapith (Birbhum district) hotel fire from the same week, and an Income
Tax office fire in Mumbai had absorbed an unrelated Kandivali hotel fire. Diagnosed with a
throwaway instrumented copy of the clustering loop against the live dataset (not guessed) — this
found the *specific* mechanism: `performSmartClustering`'s match required only "same state +
same category + ≥2 shared significant words", checked against the CONCATENATED text of every
report already in the cluster. That concatenated bag grows every time a report joins, which
steadily lowers the effective bar for the next candidate — two individually-unrelated reports'
own pairwise overlap was only 2 words, but the Kolkata cluster's accumulated vocabulary from 4
prior reports pushed a 5th (unrelated) candidate to 6+. Separately, both fire reports' formulaic
"N killed, M-storey building" phrasing coincidentally shared spelled-out numbers ("four-year-old"
vs "four-storey", "five-storey" vs "five were from...") that added overlap with zero real topical
signal. Three-part fix in `src/lib/clustering.ts`: (1) a hard veto — two reports that each name a
*specific* (non-generic) place and disagree are never merged, full stop, regardless of word
overlap, only falling through to the keyword check when at least one side is a generic
state-level fallback; (2) compare a candidate against the single BEST-matching existing member of
a cluster, not the whole cluster's concatenated bag, so the bar can't erode as a cluster grows;
(3) added spelled-out numbers (`'four'`, `'five'`, etc.), `'when'`, and `'storey'`/`'floor'` to
the keyword stopword list — generic story-detail vocabulary that recurs in any casualty-count
disaster report regardless of which specific incident. Also extended
`aiClassifier.ts`'s `applyAIResultToReport` to sharpen an overly-generic rule-based placeName
(one that fell back to just the state name because the fixed `INDIAN_LOCATIONS` dictionary didn't
recognize a specific city/town) using Gemini's own `extractedEntities.locationsMentioned` field —
previously extracted by every Gemini call and silently discarded. This is what will let the
place-mismatch veto correctly separate cases like Kolkata vs. Tarapith once Gemini is reachable
again (both currently fall back to the identical generic "West Bengal" placeName under
keyword-classification alone, since neither city is in the dictionary).

Verified against the live dev SQLite DB (128 accumulated reports, not a synthetic test set): all
8 new `FORBIDDEN_TERMS` false positives confirmed gone after a manual pipeline run, alongside a
battery of real disaster headlines (including ones the project had previously and deliberately
preserved, like "Flood victims protest against inadequate relief" and "Schools shut in 3 Odisha
districts amid heavy rainfall") re-confirmed still passing. Re-ran `performSmartClustering`
against the live re-processed data: the Arunachal Pradesh flood now has its own correct cluster
(previously buried inside "Delhi weather forecast"), and the Kolkata/Tarapith fires now correctly
split into two cards. **Known remaining limitation, left undone**: the Mumbai Income Tax office
fire and the unrelated Kandivali hotel fire still cluster together — both resolve to the exact
same specific placeName ("Mumbai"), so neither the place-mismatch veto nor the stopword fix
apply; separating this specific case needs either finer-grained geocoding than
`INDIAN_LOCATIONS` has, or Gemini's `locationsMentioned` to name "Kandivali" specifically (which
requires Gemini to be reachable — currently isn't, see above). `npm run build`/`npm run lint`
clean throughout; Vercel-mode `tsc --noEmit` on `api/reports.ts`/`api/situation-brief.ts` clean
(per gotcha #8). Not yet verified against the Vercel production deployment or against a fresh
Gemini quota window — next session should re-check `classificationMethod` distribution and the
Kolkata/Tarapith split specifically once quota resets, to confirm the `isGenuineDisaster` gate and
`locationsMentioned` sharpening work end-to-end against real Gemini output, not just the
keyword-fallback stopgap.
