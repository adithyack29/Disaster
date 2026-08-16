import type { DisasterReport } from '../src/types/incident.js';
import { cleanText, isStrictIndiaDisaster } from './classifier.js';
import { classifyReportsBatch } from './services/aiClassifier.js';
import { fetchUSGSReports } from './adapters/usgsAdapter.js';
import { fetchEONETReports } from './adapters/eonetAdapter.js';
import { fetchGDACSReports } from './adapters/gdacsAdapter.js';
import { fetchReliefWebReports } from './adapters/reliefwebAdapter.js';
import { fetchMastodonReports } from './adapters/mastodonAdapter.js';
import { fetchBlueskyReports } from './adapters/blueskyAdapter.js';
import { fetchRSSReports } from './adapters/rssAdapter.js';
import { fetchRedditReports } from './adapters/redditAdapter.js';
import { fetchNewsAPIReports } from './adapters/newsApiAdapter.js';
import { fetchGNewsReports } from './adapters/gnewsAdapter.js';

const SOURCE_TIMEOUT_MS = 8000;

// Diagnostic-only state so callers (e.g. api/reports.ts) can report per-source fetch counts
// without needing Vercel Function Logs access — tells apart "adapter's key/config is broken"
// from "adapter works but found zero matching real disasters right now" (see CLAUDE.md
// Investigation Log 2026-08-16, seventh/eighth entries). Safe to remove once source health is
// confirmed working end-to-end.
export interface SourceDiagnostic {
  label: string;
  status: 'fulfilled' | 'rejected';
  fetchedCount: number;
  error?: string;
}
let lastSourceDiagnostics: SourceDiagnostic[] = [];
export function getLastSourceDiagnostics(): SourceDiagnostic[] {
  return lastSourceDiagnostics;
}

/**
 * Bounds a single adapter call so one slow/hanging source can never stall the whole
 * aggregation run (adapters themselves do not set fetch timeouts).
 */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${SOURCE_TIMEOUT_MS}ms`)), SOURCE_TIMEOUT_MS);
    }),
  ]);
}

function dedupeByHeadline(reports: DisasterReport[]): DisasterReport[] {
  const seen = new Set<string>();
  const unique: DisasterReport[] = [];
  for (const report of reports) {
    const key = report.headline.toLowerCase().trim();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(report);
    }
  }
  return unique;
}

/**
 * Fetch every open-source adapter concurrently, filter to genuine India disaster
 * dispatches, and classify (Gemini + keyword fallback). No persistence — callers decide
 * whether/how to cache or store the result. Shared by the local dev pipeline (server/pipeline.ts)
 * and the Vercel serverless endpoint (api/reports.ts) so both run identical ingestion logic.
 */
export async function aggregateAndClassify(): Promise<DisasterReport[]> {
  const sources: Array<[string, Promise<DisasterReport[]>]> = [
    ['USGS', fetchUSGSReports()],
    ['NASA EONET', fetchEONETReports()],
    ['GDACS', fetchGDACSReports()],
    ['ReliefWeb', fetchReliefWebReports()],
    ['Mastodon', fetchMastodonReports()],
    ['Bluesky', fetchBlueskyReports()],
    ['RSS', fetchRSSReports()],
    ['Reddit', fetchRedditReports()],
    ['NewsAPI', fetchNewsAPIReports()],
    ['GNews', fetchGNewsReports()],
  ];

  const settled = await Promise.allSettled(sources.map(([label, p]) => withTimeout(p, label)));

  const allFetched: DisasterReport[] = [];
  lastSourceDiagnostics = settled.map((result, i) => {
    const [label] = sources[i];
    if (result.status === 'fulfilled') {
      allFetched.push(...result.value);
      return { label, status: 'fulfilled' as const, fetchedCount: result.value.length };
    }
    console.warn(`[Aggregate] ${label} source failed/timed out:`, result.reason?.message || result.reason);
    return {
      label,
      status: 'rejected' as const,
      fetchedCount: 0,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  });

  allFetched.forEach((r) => {
    r.headline = cleanText(r.headline);
    r.description = cleanText(r.description);
  });

  const indiaOnly = allFetched.filter((r) => isStrictIndiaDisaster(r.headline, r.description));
  const classified = await classifyReportsBatch(indiaOnly);
  const unique = dedupeByHeadline(classified);

  unique.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return unique;
}
