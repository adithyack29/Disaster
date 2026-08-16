import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { DisasterReport } from '../src/types/incident';
import { aggregateAndClassify } from '../server/aggregate';
import { getFreshMockReports } from '../src/data/mockReports';

const CACHE_TTL_MS = 2 * 60 * 1000;

// Any live-and-real ingested report counts this run as genuinely "live" — see the demo-safety
// design note in CLAUDE.md. We do not require a minimum count beyond >0: a thin real feed is
// still honestly live, not demo. Only a total failure/empty result triggers the fallback.
const LIVE_MIN_COUNT = 1;

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
 */
async function refreshReports(): Promise<ReportsPayload> {
  const live = await aggregateAndClassify();
  if (live.length >= LIVE_MIN_COUNT) {
    return { reports: live, mode: 'live', liveCount: live.length, generatedAt: new Date().toISOString() };
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
