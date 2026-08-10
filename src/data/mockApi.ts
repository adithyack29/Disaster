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
import { isStrictIndiaDisaster } from '../../server/classifier';
import { fetchLiveClientTelemetry } from './liveClientFetcher';

// Always try the local backend first; Vercel deploys only have window.location available
const isVercel = typeof window !== 'undefined' && !window.location.hostname.includes('localhost') && !window.location.hostname.includes('127.0.0.1');
const API_BASE_URL = isVercel ? '' : 'http://127.0.0.1:3001/api';

let sessionPushedReports: DisasterReport[] = [];
let liveClientFetchedReports: DisasterReport[] = [];
let lastClientFetchTimeMs = 0;


/**
 * Returns fresh mock reports merged with live client fetched telemetry and session dispatches
 */
async function getFreshLocalReports(): Promise<DisasterReport[]> {
  const now = Date.now();

  // Fetch live open-source telemetry in browser every 90 seconds
  if (now - lastClientFetchTimeMs > 90000 || liveClientFetchedReports.length === 0) {
    try {
      const fresh = await fetchLiveClientTelemetry();
      if (fresh.length > 0) {
        liveClientFetchedReports = fresh;
        lastClientFetchTimeMs = now;
      }
    } catch (err) {
      console.warn('[mockApi] Live client telemetry fetch fallback warning:', err);
    }
  }

  const base = getFreshMockReports().filter((r) => isStrictIndiaDisaster(r.headline, r.description));
  const combined = [...sessionPushedReports, ...liveClientFetchedReports, ...base];

  // De-duplicate by headline
  const seenHeadlines = new Set<string>();
  const uniqueReports: DisasterReport[] = [];

  for (const rep of combined) {
    const key = rep.headline.toLowerCase().trim();
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      uniqueReports.push(rep);
    }
  }

  // Sort by most recent timestamp
  uniqueReports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  return uniqueReports;
}

export function pushLiveReport(report: DisasterReport): void {
  sessionPushedReports = [report, ...sessionPushedReports];
}

// Force-invalidate the client-side telemetry cache so next call re-fetches
export function invalidateClientCache(): void {
  lastClientFetchTimeMs = 0;
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
 * Fetch reports from Node.js backend (/api/reports) with dynamic live fallback
 */
export async function getReports(filters?: FilterState): Promise<DisasterReport[]> {
  // On localhost: try backend Express server
  if (!isVercel && API_BASE_URL) {
    try {
      const params = new URLSearchParams();
      if (filters?.categories && filters.categories.length > 0) {
        params.append('categories', filters.categories.join(','));
      }
      if (filters?.severities && filters.severities.length > 0) {
        params.append('severities', filters.severities.join(','));
      }
      if (filters?.verifiedOnly) {
        params.append('verifiedOnly', 'true');
      }
      if (filters?.sourceType && filters.sourceType !== 'all') {
        params.append('sourceType', filters.sourceType);
      }
      if (filters?.region && filters.region !== 'all') {
        params.append('region', filters.region);
      }
      if (filters?.searchQuery) {
        params.append('search', filters.searchQuery);
      }

      // Cache-bust with timestamp to prevent browser fetch caching stale data
      params.append('_t', String(Date.now()));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE_URL}/reports?${params.toString()}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const backendReports = await res.json();
        if (Array.isArray(backendReports) && backendReports.length > 0) {
          // Sort by latest timestamp
          backendReports.sort((a: DisasterReport, b: DisasterReport) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
          );
          return backendReports;
        }
      }
    } catch (err) {
      // Fall through to live client telemetry fallback
    }
  }

  // On Vercel (or when backend unreachable): use live browser telemetry
  const reports = await getFreshLocalReports();
  return applyFilters(reports, filters);
}

/**
 * Trigger a full pipeline re-ingestion + cache invalidation
 */
export async function triggerPipelineAndRefresh(): Promise<void> {
  // On localhost: hit backend pipeline endpoint
  if (!isVercel && API_BASE_URL) {
    try {
      await fetch(`${API_BASE_URL.replace('/api', '')}/api/pipeline/run`, {
        method: 'POST',
        cache: 'no-store',
      });
    } catch (_) {}
  }
  // On Vercel: force-invalidate client telemetry cache so next getReports() re-fetches
  invalidateClientCache();
}

/**
 * Fetch single report by ID
 */
export async function getIncidentById(id: string): Promise<DisasterReport | null> {
  if (!isVercel && API_BASE_URL) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE_URL}/reports/${id}`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeoutId);
      if (res.ok) return await res.json();
    } catch (_) {}
  }

  const reports = await getFreshLocalReports();
  const found = reports.find((r) => r.id === id);
  return found || null;
}

/**
 * Fetch incident cluster by clusterId
 */
export async function getClusterById(clusterId: string): Promise<IncidentCluster | null> {
  if (!isVercel && API_BASE_URL) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE_URL}/clusters/${clusterId}`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeoutId);
      if (res.ok) return await res.json();
    } catch (_) {}
  }

  const freshReports = await getFreshLocalReports();
  const reports = freshReports.filter((r) => r.clusterId === clusterId);
  if (reports.length === 0) return null;
  const clusters = performSmartClustering(reports);
  return clusters.length > 0 ? clusters[0] : null;
}

/**
 * Fetch dashboard stats
 */
export async function getStats(filters?: FilterState): Promise<DashboardStats> {
  if (!isVercel && API_BASE_URL) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${API_BASE_URL}/stats`, { signal: controller.signal, cache: 'no-store' });
      clearTimeout(timeoutId);
      if (res.ok) return await res.json();
    } catch (_) {}
  }

  const reports = await getFreshLocalReports();
  const filtered = applyFilters(reports, filters);
  const nowMs = Date.now();
  const oneHourAgo = nowMs - 3600 * 1000;

  const criticalCount = filtered.filter((r) => r.severity === 'critical').length;
  const highCount = filtered.filter((r) => r.severity === 'high').length;
  const reportsLastHour = filtered.filter((r) => new Date(r.timestamp).getTime() >= oneHourAgo).length;
  const verifiedCount = filtered.filter((r) => r.source.verified).length;
  const verifiedPercentage = filtered.length > 0 ? Math.round((verifiedCount / filtered.length) * 100) : 0;
  const sourceNames = new Set(filtered.map((r) => r.source.name));

  return {
    activeIncidents: filtered.length,
    criticalCount,
    highCount,
    reportsLastHour,
    verifiedPercentage,
    monitoredSourcesCount: sourceNames.size,
  };
}

export async function getPulseTimeline(filters?: FilterState): Promise<PulseBucket[]> {
  const reports = await getFreshLocalReports();
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
