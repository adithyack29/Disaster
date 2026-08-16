import type { DisasterReport } from '../src/types/incident';
import { cleanText, isStrictIndiaDisaster } from './classifier';
import { classifyReportsBatch } from './services/aiClassifier';
import { fetchUSGSReports } from './adapters/usgsAdapter';
import { fetchEONETReports } from './adapters/eonetAdapter';
import { fetchGDACSReports } from './adapters/gdacsAdapter';
import { fetchReliefWebReports } from './adapters/reliefwebAdapter';
import { fetchMastodonReports } from './adapters/mastodonAdapter';
import { fetchBlueskyReports } from './adapters/blueskyAdapter';
import { fetchRSSReports } from './adapters/rssAdapter';
import { fetchRedditReports } from './adapters/redditAdapter';
import { fetchNewsAPIReports } from './adapters/newsApiAdapter';
import { fetchGNewsReports } from './adapters/gnewsAdapter';

const SOURCE_TIMEOUT_MS = 8000;

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
  settled.forEach((result, i) => {
    const [label] = sources[i];
    if (result.status === 'fulfilled') {
      allFetched.push(...result.value);
    } else {
      console.warn(`[Aggregate] ${label} source failed/timed out:`, result.reason?.message || result.reason);
    }
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
