import type { DisasterReport, IncidentCluster, SeverityLevel, ClusterHistoryEntry } from '../types/incident';
import { cleanText } from './utils';

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
};

function extractKeyWords(text: string): Set<string> {
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
    'as', 'is', 'was', 'were', 'are', 'been', 'be', 'has', 'have', 'had', 'it', 'its', 'this',
    'that', 'about', 'over', 'under', 'after', 'near', 'across', 'news', 'feed', 'report',
    'india', 'indian', 'state', 'district', 'area', 'zone', 'sector', 'national', 'local',
    'killed', 'injured', 'dead', 'reported', 'says', 'said', 'according'
  ]);
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return new Set(words.filter((w) => w.length > 2 && !stopWords.has(w)));
}

/**
 * Filter out non-disaster, US weather feeds, political/protest items, and foreign news topics
 */
function isDisasterTopic(headline: string, description: string): boolean {
  const fullText = `${headline} ${description}`.toLowerCase();

  const forbiddenTerms = [
    'teacher', 'assignment', 'school enrolment', 'udise+', 'student enrollment',
    'protest', 'lathi-charge', 'lathi', 'protesters', 'assembly march', 'demonstration',
    'cricket', 'ipl', 'bollywood', 'movie', 'actor', 'actress', 'box office',
    'election', 'political party', 'speech', 'modi vs', 'rahul gandhi', 'bjp', 'congress',
    'hindutva', 'ideologue', 'mcbroom', 'spider-man', 'controversy', 'land dispute', 'firing along',
    'stock market', 'sensex', 'nifty', 'share price', 'crypto', 'iphone', 'gadget', 'smartphone',
    'gaza', 'israel', 'netanyahu', 'hamas', 'russia', 'ukraine', 'kharkiv', 'odesa',
    'moldova', 'florida', 'california', 'hawaii', 'naalehu', 'alaska', 'beijing', 'taiwan', 'trump', 'biden',
    'nws', 'flashfloodwarning', '#inwx', '#ffw', 'lake, in', 'porter, in', 'indiana',
    'denmark', 'skjern', 'hoboken', 'resiliencity', 'national coastline zone', 'central command zone'
  ];

  return !forbiddenTerms.some((term) => fullText.includes(term));
}

/**
 * Pure Function: Selects representative report from a cluster strictly based on priority:
 * 1. Most recent report from an official source (govt/NDRF/agency)
 * 2. Most recent report from a news source
 * 3. Highest credibility social/sensor/citizen report (or most recent if tied)
 */
export function selectRepresentativeReport(reports: DisasterReport[]): DisasterReport {
  if (!reports || reports.length === 0) {
    throw new Error('Cannot select representative report from an empty report list.');
  }

  // 1. Official reports (sorted descending by timestamp)
  const officialReports = reports
    .filter((r) => r.source.type === 'official')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (officialReports.length > 0) {
    return officialReports[0];
  }

  // 2. News reports (sorted descending by timestamp)
  const newsReports = reports
    .filter((r) => r.source.type === 'news')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  if (newsReports.length > 0) {
    return newsReports[0];
  }

  // 3. Social / Sensor / Citizen: Highest credibility score (if tied, newest first)
  const otherReports = [...reports].sort((a, b) => {
    if (b.credibilityScore !== a.credibilityScore) {
      return b.credibilityScore - a.credibilityScore;
    }
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return otherReports[0] || reports[0];
}

/**
 * Pure Function: Re-evaluates cluster severity based on official authority and credibility weighting:
 * 1. Official Override: Highest severity reported by ANY official source report
 * 2. Credibility-Weighted Majority: Sum of credibility scores per severity level for non-official reports
 * 3. Safety De-escalation Rule: Non-official reports CANNOT de-escalate severity below previous official severity
 */
export function evaluateClusterSeverity(
  reports: DisasterReport[],
  previousSeverity?: SeverityLevel
): { severity: SeverityLevel; reason: string } {
  if (!reports || reports.length === 0) {
    return { severity: previousSeverity || 'low', reason: 'Fallback default (no reports)' };
  }

  const officialReports = reports.filter((r) => r.source.type === 'official');

  // Rule 1: Official source reports exist -> highest official severity wins
  if (officialReports.length > 0) {
    let maxOfficialSev: SeverityLevel = officialReports[0].severity;
    let triggeringReport = officialReports[0];

    for (const rep of officialReports) {
      if (SEVERITY_RANK[rep.severity] > SEVERITY_RANK[maxOfficialSev]) {
        maxOfficialSev = rep.severity;
        triggeringReport = rep;
      }
    }

    return {
      severity: maxOfficialSev,
      reason: `Official authority assessment from ${triggeringReport.source.name}`,
    };
  }

  // Rule 2: No official report -> Credibility-Weighted Majority
  const scores: Record<SeverityLevel, number> = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const rep of reports) {
    scores[rep.severity] += rep.credibilityScore || 50;
  }

  let winner: SeverityLevel = 'low';
  let maxScore = -1;

  for (const level of ['critical', 'high', 'moderate', 'low'] as SeverityLevel[]) {
    if (scores[level] > maxScore) {
      maxScore = scores[level];
      winner = level;
    }
  }

  // Rule 3: Safety De-escalation Protection (never auto-downgrade based on social posts alone if previous was higher)
  if (previousSeverity && SEVERITY_RANK[winner] < SEVERITY_RANK[previousSeverity]) {
    return {
      severity: previousSeverity,
      reason: `De-escalation to ${winner} held pending official government confirmation (retained previous ${previousSeverity})`,
    };
  }

  return {
    severity: winner,
    reason: `Credibility-weighted consensus across ${reports.length} dispatches`,
  };
}

/**
 * Perform Precision Semantic Clustering with Dynamic Representative Headline Selection,
 * Severity Re-evaluation, and History Tracking.
 */
export function performSmartClustering(
  reports: DisasterReport[],
  existingClustersMap?: Map<string, IncidentCluster>
): IncidentCluster[] {
  const clusters: IncidentCluster[] = [];

  for (const report of reports) {
    report.headline = cleanText(report.headline);
    report.description = cleanText(report.description);

    // Instant Reject if topic is forbidden
    if (!isDisasterTopic(report.headline, report.description)) {
      continue;
    }

    const rState = (report.location.state || '').toLowerCase();
    const rCat = report.category;
    const rWords = extractKeyWords(`${report.headline} ${report.description}`);

    let matchedCluster: IncidentCluster | null = null;

    for (const cluster of clusters) {
      if (report.clusterId && cluster.clusterId === report.clusterId) {
        matchedCluster = cluster;
        break;
      }

      const cState = (cluster.centerLocation.state || '').toLowerCase();
      const cCat = cluster.category;

      if (cCat !== rCat) continue;

      const isSameState = cState === rState || cState.includes(rState) || rState.includes(cState);
      if (!isSameState) continue;

      const clusterText = `${cluster.title} ${cluster.reports.map((r) => `${r.headline} ${r.description}`).join(' ')}`;
      const cWords = extractKeyWords(clusterText);
      const overlap = Array.from(rWords).filter((w) => cWords.has(w));

      if (overlap.length >= 2) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      // Prevent duplicate report entries
      if (!matchedCluster.reports.some((r) => r.id === report.id)) {
        matchedCluster.reports.push(report);
      }
    } else {
      const clusterId = report.clusterId || `cluster-${report.category}-${rState.replace(/[^a-z0-9]/g, '-')}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const existing = existingClustersMap?.get(clusterId);

      const newCluster: IncidentCluster = {
        clusterId,
        title: report.headline,
        representativeReportId: report.id,
        category: report.category,
        highestSeverity: report.severity,
        reportCount: 1,
        reports: [report],
        firstReportedAt: report.timestamp,
        lastReportedAt: report.timestamp,
        centerLocation: report.location,
        totalAffectedEstimate: report.affectedPopulationEstimate || 0,
        imageUrl: report.imageUrl,
        history: existing?.history || [],
      };
      clusters.push(newCluster);
    }
  }

  // Post-processing: Recompute Representative Headline, Severity, and History for each cluster
  for (const cluster of clusters) {
    cluster.reports.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    cluster.lastReportedAt = cluster.reports[0].timestamp;
    cluster.firstReportedAt = cluster.reports[cluster.reports.length - 1].timestamp;
    cluster.reportCount = cluster.reports.length;

    // 1. Select Live Representative Report & Headline
    const repReport = selectRepresentativeReport(cluster.reports);
    const prevRepId = cluster.representativeReportId;
    const prevTitle = cluster.title;

    // 2. Evaluate Dynamic Severity
    const prevSev = cluster.highestSeverity;
    const { severity: newSev, reason: sevReason } = evaluateClusterSeverity(cluster.reports, prevSev);

    const history: ClusterHistoryEntry[] = cluster.history || [];

    // Track Title / Representative Report Changes
    if (prevRepId !== repReport.id && prevTitle !== repReport.headline) {
      cluster.title = repReport.headline;
      cluster.representativeReportId = repReport.id;
      cluster.lastUpdatedAt = new Date().toISOString();
      cluster.hasRecentUpdate = true;

      const titleEntry: ClusterHistoryEntry = {
        id: `hist-title-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        field: 'title',
        previousValue: prevTitle,
        newValue: repReport.headline,
        triggeredByReportId: repReport.id,
        triggeredBySource: repReport.source.name,
        reason: `Representative headline selected from ${repReport.source.name} (${repReport.source.type})`,
      };
      history.unshift(titleEntry);
    } else {
      cluster.representativeReportId = repReport.id;
      cluster.title = repReport.headline;
    }

    // Track Severity Changes
    if (prevSev !== newSev) {
      cluster.highestSeverity = newSev;
      cluster.lastUpdatedAt = new Date().toISOString();
      cluster.hasRecentUpdate = true;

      const isEscalation = SEVERITY_RANK[newSev] > SEVERITY_RANK[prevSev];
      const actionVerb = isEscalation ? 'Escalated' : 'De-escalated';

      const sevEntry: ClusterHistoryEntry = {
        id: `hist-sev-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        timestamp: new Date().toISOString(),
        field: 'severity',
        previousValue: prevSev,
        newValue: newSev,
        triggeredByReportId: repReport.id,
        triggeredBySource: repReport.source.name,
        reason: `${actionVerb} ${prevSev.toUpperCase()} → ${newSev.toUpperCase()} (${sevReason})`,
      };
      history.unshift(sevEntry);
    }

    cluster.history = history;

    // Calculate max affected population estimate
    let maxPop = 0;
    for (const r of cluster.reports) {
      if (r.affectedPopulationEstimate && r.affectedPopulationEstimate > maxPop) {
        maxPop = r.affectedPopulationEstimate;
      }
    }
    cluster.totalAffectedEstimate = maxPop;
  }

  clusters.sort(
    (a, b) => new Date(b.lastReportedAt || b.firstReportedAt).getTime() - new Date(a.lastReportedAt || a.firstReportedAt).getTime()
  );

  return clusters;
}
