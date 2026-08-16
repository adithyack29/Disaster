import type {
  DisasterReport,
  FilterState,
  IncidentCluster,
  DashboardStats,
  PulseBucket,
  SeverityLevel
} from '../types/incident';
import { getFreshMockReports } from './mockReports';
import { performSmartClustering } from '../lib/clustering';
import { fetchLiveClientTelemetry } from './liveClientFetcher';
import { isDemoModeForced } from './demoMode';

// Local dev runs the Express backend (npm run server) on :3001; Vercel deploys the same
// /api/reports + /api/situation-brief contract as serverless functions under /api. See
// CLAUDE.md "Architecture" for why these are two separate implementations of one contract.
const isVercel = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
export const API_BASE_URL = isVercel ? '/api' : 'http://127.0.0.1:3001/api';

const BACKEND_FETCH_TIMEOUT_MS = 10000; // generous enough to cover a cold serverless start
const REFRESH_INTERVAL_MS = 90000;

export type IngestionMode = 'live' | 'demo';

export interface ReportsFetchResult {
  reports: DisasterReport[];
  mode: IngestionMode;
  liveCount: number;
}

let sessionPushedReports: DisasterReport[] = [];
let cachedResult: ReportsFetchResult | null = null;
let lastFetchTimeMs = 0;

function dedupeByHeadline(reports: DisasterReport[]): DisasterReport[] {
  const seenHeadlines = new Set<string>();
  const uniqueReports: DisasterReport[] = [];
  for (const rep of reports) {
    const key = rep.headline.toLowerCase().trim();
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      uniqueReports.push(rep);
    }
  }
  return uniqueReports;
}

function demoSnapshot(): ReportsFetchResult {
  return { reports: getFreshMockReports(), mode: 'demo', liveCount: 0 };
}

/**
 * Validates the /api/reports response shape defensively — a malformed or stale-contract
 * response (e.g. a bare array from an old deploy) must never crash the dashboard, it should
 * just be treated as "backend didn't give us usable data" and fall through to the next layer.
 */
function parseBackendPayload(data: unknown): ReportsFetchResult | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  if (!Array.isArray(obj.reports) || (obj.mode !== 'live' && obj.mode !== 'demo')) return null;
  return {
    reports: obj.reports as DisasterReport[],
    mode: obj.mode,
    liveCount: typeof obj.liveCount === 'number' ? obj.liveCount : 0,
  };
}

/**
 * Fetch the live, classified report set from the backend (Express locally, Vercel serverless
 * function in production — same /api/reports contract in both environments). Returns null on
 * any failure (network, timeout, malformed response) so the caller can fall through.
 */
async function fetchBackendReports(forceRefresh = false): Promise<ReportsFetchResult | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), BACKEND_FETCH_TIMEOUT_MS);
    const params = new URLSearchParams({ _t: String(Date.now()) });
    if (forceRefresh) params.set('refresh', 'true');

    const res = await fetch(`${API_BASE_URL}/reports?${params.toString()}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    if (!res.ok) return null;
    return parseBackendPayload(await res.json());
  } catch {
    return null;
  }
}

/**
 * Demo-safety fallback chain (required for live judging demos — see CLAUDE.md):
 *  1. If the presenter has armed "Force Demo Mode", skip the network entirely and serve the
 *     curated snapshot — deterministic, works with zero connectivity.
 *  2. Otherwise try the real backend (dev Express / Vercel function, same contract). The
 *     backend itself already falls back to the demo snapshot server-side if live ingestion
 *     fails or returns nothing — so a normal successful response here is trustworthy as-is.
 *  3. If the backend is completely unreachable (network down, function cold-start failure),
 *     try one more direct client-side live fetch (CORS-safe sources only, no keys needed).
 *  4. If that also comes back empty, serve the local demo snapshot. The dashboard is never
 *     blank and never silently blends fake data into a healthy live feed — every report shown
 *     is honestly attributable to 'live' or 'demo' via the returned mode.
 */
async function getFreshLocalReports(): Promise<ReportsFetchResult> {
  if (isDemoModeForced()) {
    return {
      reports: dedupeByHeadline([...sessionPushedReports, ...getFreshMockReports()]),
      mode: 'demo',
      liveCount: 0,
    };
  }

  const now = Date.now();

  if (now - lastFetchTimeMs > REFRESH_INTERVAL_MS || !cachedResult) {
    const backend = await fetchBackendReports();

    if (backend) {
      cachedResult = backend;
    } else {
      try {
        const live = await fetchLiveClientTelemetry();
        cachedResult = live.length > 0
          ? { reports: live, mode: 'live', liveCount: live.length }
          : demoSnapshot();
      } catch (err) {
        console.warn('[mockApi] Live client telemetry fallback warning:', err);
        cachedResult = demoSnapshot();
      }
    }
    lastFetchTimeMs = now;
  }

  const merged = dedupeByHeadline([...sessionPushedReports, ...cachedResult.reports]);
  merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return { reports: merged, mode: cachedResult.mode, liveCount: cachedResult.liveCount };
}

export function pushLiveReport(report: DisasterReport): void {
  sessionPushedReports = [report, ...sessionPushedReports];
}

// Force-invalidate the report cache so the next call re-fetches from the backend
export function invalidateClientCache(): void {
  lastFetchTimeMs = 0;
}

export function applyFilters(reports: DisasterReport[], filters?: FilterState): DisasterReport[] {
  if (!filters) return reports;

  return reports.filter((report) => {
    if (filters.categories && filters.categories.length > 0) {
      if (!filters.categories.includes(report.category)) return false;
    }

    if (filters.severities && filters.severities.length > 0) {
      if (!filters.severities.includes(report.severity)) return false;
    }

    if (filters.verifiedOnly) {
      if (!report.source.verified) return false;
    }

    if (filters.region && filters.region !== 'all') {
      if (report.location.state.toLowerCase() !== filters.region.toLowerCase()) return false;
    }

    if (filters.sourceType && filters.sourceType !== 'all') {
      if (report.source.type !== filters.sourceType) return false;
    }

    if (filters.timeRange && filters.timeRange.length === 2) {
      const reportTime = new Date(report.timestamp).getTime();
      const [start, end] = filters.timeRange;
      if (reportTime < start || reportTime > end) return false;
    }

    if (filters.searchQuery && filters.searchQuery.trim() !== '') {
      const query = filters.searchQuery.toLowerCase().trim();
      const matchHeadline = report.headline.toLowerCase().includes(query);
      const matchDesc = report.description.toLowerCase().includes(query);
      const matchPlace = report.location.placeName.toLowerCase().includes(query);
      const matchState = report.location.state.toLowerCase().includes(query);
      const matchSource = report.source.name.toLowerCase().includes(query);
      if (!matchHeadline && !matchDesc && !matchPlace && !matchState && !matchSource) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Fetch reports, filtered, along with honest live/demo attribution for the status indicator.
 */
export async function getReportsWithStatus(filters?: FilterState): Promise<ReportsFetchResult> {
  const { reports, mode, liveCount } = await getFreshLocalReports();
  return { reports: applyFilters(reports, filters), mode, liveCount };
}

/**
 * Fetch reports (backend-first, live-telemetry/demo-snapshot fallback — see getFreshLocalReports)
 */
export async function getReports(filters?: FilterState): Promise<DisasterReport[]> {
  const { reports } = await getFreshLocalReports();
  return applyFilters(reports, filters);
}

/**
 * Trigger a full pipeline re-ingestion + cache invalidation
 */
export async function triggerPipelineAndRefresh(): Promise<void> {
  invalidateClientCache();
  if (isDemoModeForced()) return;

  try {
    if (!isVercel) {
      await fetch(`${API_BASE_URL}/pipeline/run`, { method: 'POST', cache: 'no-store' });
    } else {
      // No long-running pipeline in production — force the serverless cache to recompute now.
      await fetchBackendReports(true);
    }
  } catch (_) {
    // Fall through — the next getReports() call will retry the backend and, failing that,
    // fall back to client telemetry / the demo snapshot.
  }
}

/**
 * Fetch single report by ID
 */
export async function getIncidentById(id: string): Promise<DisasterReport | null> {
  const { reports } = await getFreshLocalReports();
  return reports.find((r) => r.id === id) || null;
}

/**
 * Fetch incident cluster by clusterId
 */
export async function getClusterById(clusterId: string): Promise<IncidentCluster | null> {
  const { reports } = await getFreshLocalReports();
  const clusterReports = reports.filter((r) => r.clusterId === clusterId);
  if (clusterReports.length === 0) return null;
  const clusters = performSmartClustering(clusterReports);
  return clusters.length > 0 ? clusters[0] : null;
}

/**
 * Pure stats computation from an already-fetched report list — used both by getStats() below
 * and directly by DashboardPage (which already holds the current report set in memory and
 * shouldn't trigger a second fetch just to compute a summary of data it already has).
 */
export function computeStats(reports: DisasterReport[]): DashboardStats {
  const nowMs = Date.now();
  const oneHourAgo = nowMs - 3600 * 1000;

  const criticalCount = reports.filter((r) => r.severity === 'critical').length;
  const highCount = reports.filter((r) => r.severity === 'high').length;
  const reportsLastHour = reports.filter((r) => new Date(r.timestamp).getTime() >= oneHourAgo).length;
  const verifiedCount = reports.filter((r) => r.source.verified).length;
  const verifiedPercentage = reports.length > 0 ? Math.round((verifiedCount / reports.length) * 100) : 0;
  const sourceNames = new Set(reports.map((r) => r.source.name));

  return {
    activeIncidents: reports.length,
    criticalCount,
    highCount,
    reportsLastHour,
    verifiedPercentage,
    monitoredSourcesCount: sourceNames.size,
  };
}

/**
 * Fetch dashboard stats
 */
export async function getStats(filters?: FilterState): Promise<DashboardStats> {
  const { reports } = await getFreshLocalReports();
  return computeStats(applyFilters(reports, filters));
}

export async function getPulseTimeline(filters?: FilterState): Promise<PulseBucket[]> {
  const { reports } = await getFreshLocalReports();
  const filtered = applyFilters(reports, filters);
  const nowMs = Date.now();
  const buckets: PulseBucket[] = [];

  for (let i = 23; i >= 0; i--) {
    const bucketStart = nowMs - (i + 1) * 3600 * 1000;
    const bucketEnd = nowMs - i * 3600 * 1000;
    const dateObj = new Date(bucketEnd);
    const label = `${String(dateObj.getHours()).padStart(2, '0')}:00`;

    const reportsInBucket = filtered.filter((r) => {
      const t = new Date(r.timestamp).getTime();
      return t >= bucketStart && t < bucketEnd;
    });

    let critical = 0;
    let high = 0;
    let moderate = 0;
    let low = 0;

    reportsInBucket.forEach((r) => {
      if (r.severity === 'critical') critical++;
      else if (r.severity === 'high') high++;
      else if (r.severity === 'moderate') moderate++;
      else if (r.severity === 'low') low++;
    });

    let dominantSeverity: SeverityLevel = 'low';
    if (critical > 0) dominantSeverity = 'critical';
    else if (high > 0) dominantSeverity = 'high';
    else if (moderate > 0) dominantSeverity = 'moderate';

    buckets.push({
      timestamp: bucketEnd,
      label,
      total: reportsInBucket.length,
      critical,
      high,
      moderate,
      low,
      dominantSeverity,
    });
  }

  return buckets;
}
