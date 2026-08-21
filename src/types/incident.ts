export type CategoryType = 
  | 'flood' 
  | 'fire' 
  | 'earthquake' 
  | 'cyclone' 
  | 'building_collapse' 
  | 'medical' 
  | 'landslide';

export type SeverityLevel = 'critical' | 'high' | 'moderate' | 'low';

export interface LocationInfo {
  lat: number;
  lng: number;
  placeName: string;
  district?: string;
  state: string;
}

export interface ReportSource {
  type: 'official' | 'news' | 'social' | 'sensor' | 'citizen';
  name: string;
  verified: boolean;
  handleOrUrl?: string;
}

export interface DisasterReport {
  id: string;
  category: CategoryType;
  severity: SeverityLevel;
  location: LocationInfo;
  headline: string;
  description: string;
  source: ReportSource;
  credibilityScore: number; // 0-100
  language: string; // e.g., "en", "hi", "ta", "or", "as", "gu", "ml"
  timestamp: string; // ISO timestamp
  clusterId: string; // reports about the same real event share a clusterId
  affectedPopulationEstimate?: number;
  casualtyEstimate?: number;
  actionRequired?: string;
  imageUrl?: string;
  classificationMethod?: 'ai' | 'keyword-fallback';
}

export interface FilterState {
  categories: CategoryType[];
  severities: SeverityLevel[];
  verifiedOnly: boolean;
  recentlyReportedOnly?: boolean;
  sourceType: 'all' | 'official' | 'news' | 'social' | 'sensor' | 'citizen';
}

export interface ClusterHistoryEntry {
  id: string;
  timestamp: string; // ISO timestamp
  field: 'severity' | 'title';
  previousValue: string;
  newValue: string;
  triggeredByReportId: string;
  triggeredBySource: string; // e.g. "Indian Coast Guard PRO" or "KSDMA"
  reason?: string;
}

export interface IncidentCluster {
  clusterId: string;
  title: string;
  representativeReportId: string; // ID of the live-selected real report backing this headline
  category: CategoryType;
  highestSeverity: SeverityLevel;
  reportCount: number;
  reports: DisasterReport[];
  firstReportedAt: string;
  lastReportedAt: string;
  centerLocation: LocationInfo;
  totalAffectedEstimate: number;
  imageUrl?: string;
  history?: ClusterHistoryEntry[];
  lastUpdatedAt?: string; // ISO string when title or severity changed
  hasRecentUpdate?: boolean; // temporary change flag
}

export interface DashboardStats {
  activeIncidents: number;
  criticalCount: number;
  highCount: number;
  reportsLastHour: number;
  verifiedPercentage: number;
  monitoredSourcesCount: number;
}
