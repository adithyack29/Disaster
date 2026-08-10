import type { 
  DisasterReport, 
  FilterState, 
  IncidentCluster, 
  DashboardStats, 
  PulseBucket, 
  SeverityLevel,
  CategoryType
} from '../types/incident';
import { INITIAL_MOCK_REPORTS } from './mockReports';
import { performSmartClustering } from '../lib/clustering';

const API_BASE_URL = 'http://127.0.0.1:3001/api';

let localReports: DisasterReport[] = [...INITIAL_MOCK_REPORTS];

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
 * Fetch reports from Node.js backend (/api/reports) with fallback
 */
export async function getReports(filters?: FilterState): Promise<DisasterReport[]> {
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

    const res = await fetch(`${API_BASE_URL}/reports?${params.toString()}`);
    if (res.ok) {
      const backendReports = await res.json();
      if (Array.isArray(backendReports) && backendReports.length > 0) {
        return backendReports;
      }
    }
  } catch (err) {
    // Fall back to local array if backend is unavailable
  }

  return applyFilters(localReports, filters);
}

/**
 * Fetch single report by ID
 */
export async function getIncidentById(id: string): Promise<DisasterReport | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/reports/${id}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Fall back
  }

  const report = localReports.find((r) => r.id === id);
  return report || null;
}

/**
 * Fetch incident cluster by clusterId
 */
export async function getClusterById(clusterId: string): Promise<IncidentCluster | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/clusters/${clusterId}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Fall back
  }

  const reports = localReports.filter((r) => r.clusterId === clusterId);
  if (reports.length === 0) return null;
  const clusters = performSmartClustering(reports);
  return clusters.length > 0 ? clusters[0] : null;
}

/**
 * Fetch dashboard stats
 */
export async function getStats(filters?: FilterState): Promise<DashboardStats> {
  try {
    const res = await fetch(`${API_BASE_URL}/stats`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    // Fall back
  }

  const filtered = applyFilters(localReports, filters);
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
  const filtered = applyFilters(localReports, filters);
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

export function pushLiveReport(report: DisasterReport): void {
  localReports = [report, ...localReports];
}

// Live Telemetry Dispatch Injector Templates
const DEMO_LIVE_DISPATCH_TEMPLATES = [
  {
    clusterId: 'cluster-kerala-kochi-01',
    headline: 'KSDMA Bulletin: High-tide surge receding slowly; 4 extra motorboats deployed at Fort Kochi',
    description: 'General Hospital Annex water level down by 0.3m. Emergency power restoration in progress.',
    source: { type: 'official', name: 'Kerala State Disaster Management Authority (KSDMA)', verified: true },
    severity: 'critical',
    category: 'flood',
    location: { lat: 9.9312, lng: 76.2673, placeName: 'Fort Kochi Coastal Zone', state: 'Kerala' },
    credibilityScore: 98,
  },
  {
    clusterId: 'cluster-wayanad-landslide-02',
    headline: 'Southern Command Engineers complete footbridge launch across Meppadi torrent',
    description: '122 Infantry Battalion task force opens foot transit for emergency supply carrying team.',
    source: { type: 'official', name: 'Southern Command Indian Army', verified: true },
    severity: 'critical',
    category: 'landslide',
    location: { lat: 11.5304, lng: 76.1306, placeName: 'Meppadi Chooralmala Sector', state: 'Kerala' },
    credibilityScore: 100,
  },
  {
    clusterId: 'cluster-assam-kaziranga-03',
    headline: 'ASDMA Update: Brahmaputra discharge stabilizes at Bokakhat; relief camps stocked',
    description: 'Over 15,000 villagers accommodated across 24 temporary relief centers along NH-37.',
    source: { type: 'official', name: 'ASDMA (Assam State Disaster Management)', verified: true },
    severity: 'critical',
    category: 'flood',
    location: { lat: 26.5925, lng: 93.4116, placeName: 'Bokakhat Sub-Division', state: 'Assam' },
    credibilityScore: 99,
  },
  {
    clusterId: 'cluster-uttarakhand-dharasu-04',
    headline: 'BRO clears upper rockfall debris at Dharasu Bend; emergency vehicle convoys allowed',
    description: 'Light vehicles permitted to move towards Uttarkashi. Heavy earthmovers clearing remaining boulders.',
    source: { type: 'official', name: 'Uttarakhand State Disaster Response Force (SDRF)', verified: true },
    severity: 'critical',
    category: 'landslide',
    location: { lat: 30.7268, lng: 78.4354, placeName: 'Dharasu Bend Highway km 42', state: 'Uttarakhand' },
    credibilityScore: 97,
  },
  {
    clusterId: 'cluster-odisha-puri-05',
    headline: 'IMD Alert: Cyclone ASNA storm surge subsides; Puri port operations resuming',
    description: 'Power grid restoration crews working on main Bhubaneswar-Puri 132kV transmission line.',
    source: { type: 'official', name: 'IMD India Meteorological Department', verified: true },
    severity: 'critical',
    category: 'cyclone',
    location: { lat: 19.8135, lng: 85.8312, placeName: 'Puri Coastal Bay Sector', state: 'Odisha' },
    credibilityScore: 100,
  },
  {
    clusterId: 'cluster-gujarat-surat-06',
    headline: 'GPCB Field Team: Chemical air quality stabilizes at Pandesara industrial zone',
    description: 'Foam cover containment successful. Mobile monitoring van reports VOC levels dropping to safe range.',
    source: { type: 'official', name: 'Gujarat Pollution Control Board (GPCB)', verified: true },
    severity: 'high',
    category: 'fire',
    location: { lat: 21.1702, lng: 72.8311, placeName: 'Pandesara Industrial Estate', state: 'Gujarat' },
    credibilityScore: 96,
  },
];

let dispatchIndex = 0;

export function injectLiveSimulatedDispatch(): DisasterReport {
  const tpl = DEMO_LIVE_DISPATCH_TEMPLATES[dispatchIndex % DEMO_LIVE_DISPATCH_TEMPLATES.length];
  dispatchIndex++;

  const newReport: DisasterReport = {
    id: `live-sim-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    clusterId: tpl.clusterId,
    category: tpl.category as CategoryType,
    severity: tpl.severity as SeverityLevel,
    location: tpl.location,
    headline: tpl.headline,
    description: tpl.description,
    source: {
      type: tpl.source.type as any,
      name: tpl.source.name,
      verified: tpl.source.verified,
    },
    credibilityScore: tpl.credibilityScore,
    language: 'en',
    timestamp: new Date().toISOString(),
    classificationMethod: 'ai',
  };

  localReports = [newReport, ...localReports];
  return newReport;
}
