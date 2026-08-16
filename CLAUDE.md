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
  `?refresh=true` to force). No database — Vercel Fluid Compute reuses warm instances, so the
  cache mostly survives between requests, but a cold instance just re-aggregates. In-flight
  requests are coalesced into a single shared promise.
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
4. **`api/reports.ts`'s in-memory cache is per-warm-instance, not global** — different concurrent
   Vercel instances can briefly disagree. Fine for this app; would need shared storage
   (Redis/KV) if strict cross-instance consistency ever mattered.
5. **Forgetting to invalidate the client cache / add a store field to `DashboardPage`'s effect
   deps silently breaks a toggle** that should cause an immediate refetch — happened with the
   Demo Mode toggle (badge changed, data didn't) before being caught by actually testing it, not
   just checking the build succeeded. If you add a new toggle that should change what
   `/api/reports` (or the fallback chain) returns, make sure something actually re-triggers the
   fetch effect, and verify it visually, not just structurally.
6. **`server/disaster.db*` are gitignored** (`db`, `-shm`, `-wal` all three, since 2026-08-16 —
   previously only `-shm`/`-wal` were tracked while `.db` wasn't, which caused a real corruption
   incident, see Investigation Log 2026-08-15 second entry).

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

**Known risk for a live demo, not fully closed**: `classifyCategory`'s bare-substring keyword
matching still occasionally miscategorizes borderline real news (crime/political stories that
happen to contain a category keyword as a substring, e.g. "attacker") — see Coding Standards.
Low-severity/low-frequency in testing, but a judge who reads a card closely could notice one.
