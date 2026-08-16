import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import type { DisasterReport } from '../src/types/incident.js';
import { aggregateAndClassify } from '../server/aggregate.js';
import { getFreshMockReports } from '../src/data/mockReports.js';

const CACHE_TTL_MS = 2 * 60 * 1000;

// Any live-and-real ingested report counts this run as genuinely "live" — see the demo-safety
// design note in CLAUDE.md. We do not require a minimum count beyond >0: a thin real feed is
// still honestly live, not demo. Only a total failure/empty result triggers the fallback.
const LIVE_MIN_COUNT = 1;

// Cap accumulation so it doesn't grow unbounded, and drop anything older than a day so it
// doesn't paper over a genuinely dead feed forever.
const MAX_ACCUMULATED_REPORTS = 300;
const MAX_ACCUMULATED_AGE_MS = 24 * 60 * 60 * 1000;
const REDIS_ACCUMULATED_KEY = 'disaster:accumulated-live-reports';

export type IngestionMode = 'live' | 'demo';

export interface ReportsPayload {
  reports: DisasterReport[];
  mode: IngestionMode;
  liveCount: number;
  generatedAt: string;
}

// Module-scope cache. Vercel Fluid Compute reuses warm function instances across requests,
// so this survives between invocations most of the time and saves hitting 10 upstream APIs
// on every page load.
let cache: { payload: ReportsPayload; fetchedAt: number } | null = null;
let inFlight: Promise<ReportsPayload> | null = null;

// Accumulates every genuinely live report ever seen, the serverless analog of
// server/pipeline.ts inserting into SQLite on every 3-minute run: a single 8s-per-source
// ingestion pass frequently comes back with zero *new* items (sparse real-time India disaster
// news, tight timeouts across 10 sources), and without accumulation the cache used to fully
// overwrite itself with the static demo snapshot on every such pass — real reports never had a
// chance to build up the way they do locally.
//
// Persisted in Upstash Redis when `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set
// (provision via the Vercel Marketplace — see CLAUDE.md) so accumulation survives cold starts
// and is shared across concurrent warm instances, unlike plain module-scope state. Falls back
// to an in-memory Map if Redis isn't configured, so the app still works (with the same
// per-warm-instance caveat as before) before/without provisioning it.
const redis = process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  ? Redis.fromEnv()
  : null;
let memoryAccumulatedLive: Map<string, DisasterReport> = new Map();

function dedupeByHeadlineMap(reports: DisasterReport[]): Map<string, DisasterReport> {
  const map = new Map<string, DisasterReport>();
  for (const report of reports) {
    map.set(report.headline.toLowerCase().trim(), report);
  }
  return map;
}

function pruneAndCap(reports: DisasterReport[]): DisasterReport[] {
  const cutoff = Date.now() - MAX_ACCUMULATED_AGE_MS;
  const fresh = reports.filter((r) => new Date(r.timestamp).getTime() >= cutoff);
  fresh.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  fresh.length = Math.min(fresh.length, MAX_ACCUMULATED_REPORTS);
  return fresh;
}

async function mergeLiveReports(freshlyFetched: DisasterReport[]): Promise<DisasterReport[]> {
  if (redis) {
    let existing: DisasterReport[] = [];
    try {
      existing = (await redis.get<DisasterReport[]>(REDIS_ACCUMULATED_KEY)) || [];
    } catch (err) {
      console.error('[api/reports] Redis read failed, continuing with an empty accumulator this pass:', err);
    }
    const merged = pruneAndCap(Array.from(dedupeByHeadlineMap([...existing, ...freshlyFetched]).values()));
    try {
      await redis.set(REDIS_ACCUMULATED_KEY, merged);
    } catch (err) {
      console.error('[api/reports] Redis write failed (accumulation for this pass won\'t persist):', err);
    }
    return merged;
  }

  for (const report of freshlyFetched) {
    memoryAccumulatedLive.set(report.headline.toLowerCase().trim(), report);
  }
  const merged = pruneAndCap(Array.from(memoryAccumulatedLive.values()));
  memoryAccumulatedLive = dedupeByHeadlineMap(merged);
  return merged;
}

function demoPayload(): ReportsPayload {
  return {
    reports: getFreshMockReports(),
    mode: 'demo',
    liveCount: 0,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Demo-safety fallback (required for live judging demos — see CLAUDE.md "Demo-safety mode").
 * Live ingestion failing, timing out, or coming back empty must never blank the dashboard —
 * it falls back to a curated, realistic snapshot instead, honestly labeled via `mode`.
 *
 * Falls back to demo only if this instance has *never* accumulated a live report — once any
 * real report has been seen, it stays in the accumulated set (see mergeLiveReports) so a
 * single quiet ingestion pass doesn't yank the dashboard back to static demo content.
 */
async function refreshReports(): Promise<ReportsPayload> {
  const freshlyFetched = await aggregateAndClassify();
  const merged = await mergeLiveReports(freshlyFetched);
  if (merged.length >= LIVE_MIN_COUNT) {
    return { reports: merged, mode: 'live', liveCount: merged.length, generatedAt: new Date().toISOString() };
  }
  return demoPayload();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
  const now = Date.now();
  const isStale = !cache || now - cache.fetchedAt > CACHE_TTL_MS;

  if (isStale || forceRefresh) {
    try {
      // Coalesce concurrent requests during a cold/expired cache into a single upstream run.
      if (!inFlight) {
        inFlight = refreshReports().finally(() => {
          inFlight = null;
        });
      }
      const payload = await inFlight;
      cache = { payload, fetchedAt: Date.now() };
    } catch (err) {
      console.error('[api/reports] aggregation failed:', err);
      // Total failure (network dead, every source threw, etc.) — never return an empty
      // dashboard, fall back to the demo snapshot regardless of whether we had a prior cache.
      cache = { payload: demoPayload(), fetchedAt: Date.now() };
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(cache!.payload);
}
