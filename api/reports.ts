import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { DisasterReport } from '../src/types/incident';
import { aggregateAndClassify } from '../server/aggregate';
import { getFreshMockReports } from '../src/data/mockReports';

const CACHE_TTL_MS = 2 * 60 * 1000;

// Any live-and-real ingested report counts this run as genuinely "live" — see the demo-safety
// design note in CLAUDE.md. We do not require a minimum count beyond >0: a thin real feed is
// still honestly live, not demo. Only a total failure/empty result triggers the fallback.
const LIVE_MIN_COUNT = 1;

// Vercel has no database (see CLAUDE.md), so accumulated live reports only live as long as
// this warm instance does. Cap it so a long-lived instance doesn't grow unbounded, and drop
// anything older than a day so accumulation doesn't paper over a genuinely dead feed forever.
const MAX_ACCUMULATED_REPORTS = 300;
const MAX_ACCUMULATED_AGE_MS = 24 * 60 * 60 * 1000;

export type IngestionMode = 'live' | 'demo';

export interface ReportsPayload {
  reports: DisasterReport[];
  mode: IngestionMode;
  liveCount: number;
  generatedAt: string;
}

// Module-scope cache. Vercel Fluid Compute reuses warm function instances across requests,
// so this survives between invocations most of the time and saves hitting 10 upstream APIs
// on every page load — there is no database in this deployment (see CLAUDE.md).
let cache: { payload: ReportsPayload; fetchedAt: number } | null = null;
let inFlight: Promise<ReportsPayload> | null = null;

// Accumulates every genuinely live report ever seen by this warm instance, the serverless
// analog of server/pipeline.ts inserting into SQLite on every 3-minute run: a single 8s-per-
// source ingestion pass frequently comes back with zero *new* items (sparse real-time India
// disaster news, tight timeouts across 10 sources), and without this the cache used to fully
// overwrite itself with the static demo snapshot on every such pass — real reports never had
// a chance to accumulate the way they do locally, so production looked permanently "stuck" on
// the same 60 demo headlines while localhost (long-running, persistent SQLite) looked live.
let accumulatedLive: Map<string, DisasterReport> = new Map();

function mergeLiveReports(freshlyFetched: DisasterReport[]): DisasterReport[] {
  const cutoff = Date.now() - MAX_ACCUMULATED_AGE_MS;
  for (const report of freshlyFetched) {
    accumulatedLive.set(report.headline.toLowerCase().trim(), report);
  }
  for (const [key, report] of accumulatedLive) {
    if (new Date(report.timestamp).getTime() < cutoff) {
      accumulatedLive.delete(key);
    }
  }
  const merged = Array.from(accumulatedLive.values());
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  if (merged.length > MAX_ACCUMULATED_REPORTS) {
    merged.length = MAX_ACCUMULATED_REPORTS;
    accumulatedLive = new Map(merged.map((r) => [r.headline.toLowerCase().trim(), r]));
  }
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
  const merged = mergeLiveReports(freshlyFetched);
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
