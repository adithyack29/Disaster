import type { DisasterReport, IncidentCluster, SeverityLevel, ClusterHistoryEntry } from '../types/incident';
import { cleanText } from './utils';
import { FORBIDDEN_TERMS, containsKeyword } from '../../server/classifier';

const SEVERITY_RANK: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  moderate: 2,
  low: 1,
};

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from',
  'as', 'is', 'was', 'were', 'are', 'been', 'be', 'has', 'have', 'had', 'it', 'its', 'this',
  'that', 'about', 'over', 'under', 'after', 'near', 'across', 'news', 'feed', 'report',
  'india', 'indian', 'state', 'district', 'area', 'zone', 'sector', 'national', 'local',
  'killed', 'injured', 'dead', 'reported', 'says', 'said', 'according', 'when',
  // Spelled-out casualty/detail numbers ("four-year-old", "five-storey") and generic
  // building-height/story-count nouns. Any two unrelated disaster reports of the same TYPE
  // routinely reuse this exact vocabulary purely because they're both "N killed, M-storey
  // building" stories — it adds zero information about whether they're the SAME incident,
  // and was inflating keyword-overlap enough to cluster an unrelated Kolkata hotel fire
  // together with a same-week-different-city Tarapith hotel fire (see CLAUDE.md).
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'dozen', 'several', 'many', 'few', 'storey', 'floor', 'floors',
]);

function extractKeyWords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/);
  return new Set(words.filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
}

/**
 * Filter out non-disaster, US weather feeds, political/protest items, and foreign news topics
 */
function isDisasterTopic(headline: string, description: string): boolean {
  const fullText = `${headline} ${description}`.toLowerCase();
  return !FORBIDDEN_TERMS.some((term) => containsKeyword(fullText, term));
}

const GENERIC_PLACE_NAMES = new Set(['central command zone', 'northeast india', 'north east india']);

// True when a location's placeName carries no more specific information than its own state name
// — i.e. extractLocation()'s dictionary didn't recognize any city/town in the text, so it fell
// back to the state (or the generic region catch-all / default). A generic placeName can't be
// used to positively confirm OR rule out that two reports are about the same specific incident.
function isGenericPlaceName(loc: { placeName?: string; state?: string }): boolean {
  const place = (loc.placeName || '').toLowerCase();
  const state = (loc.state || '').toLowerCase();
  return place === state || GENERIC_PLACE_NAMES.has(place);
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

      // Two reports that each name a SPECIFIC place (not just a state-level fallback) and
      // disagree on it are never the same incident, no matter how much vocabulary they share —
      // news descriptions of the same disaster TYPE (e.g. two unrelated hotel fires) routinely
      // reuse near-identical phrasing ("massive fire", "several injured", "four-storey
      // building"), which let a plain keyword-overlap threshold alone merge them. Only fall
      // through to the keyword check when at least one side is generic (state-wide event, or our
      // location dictionary simply didn't recognize a city in the text) — see CLAUDE.md.
      const rPlace = (report.location.placeName || '').toLowerCase();
      const cPlace = (cluster.centerLocation.placeName || '').toLowerCase();
      const isExactPlaceMatch = rPlace === cPlace;
      const isSpecificPlaceMismatch =
        !isExactPlaceMatch && !isGenericPlaceName(report.location) && !isGenericPlaceName(cluster.centerLocation);
      if (isSpecificPlaceMismatch) continue;

      // Best-match-against-any-single-member, NOT overlap against the whole cluster's
      // concatenated text. A concatenated bag-of-words grows without bound as a cluster picks up
      // more reports, which steadily lowers the effective bar for the next candidate — two
      // reports that would never individually pass the threshold could still combine to drag an
      // unrelated later report in once the cluster's aggregate vocabulary got rich enough (this
      // is exactly how an unrelated Tarapith hotel fire ended up merged into a Kolkata hotel fire
      // cluster: their OWN pairwise overlap was only 2, but the Kolkata cluster's accumulated
      // text from 4 prior reports pushed it well past threshold). Requiring a strong match
      // against at least one existing member keeps the bar constant regardless of cluster size.
      let bestOverlap = 0;
      for (const existing of cluster.reports) {
        const eWords = extractKeyWords(`${existing.headline} ${existing.description}`);
        const ov = Array.from(rWords).filter((w) => eWords.has(w)).length;
        if (ov > bestOverlap) bestOverlap = ov;
      }

      // Same specific place named on both sides is strong corroboration on its own; when at
      // least one side is only a generic state-level fallback, require more textual evidence
      // before treating them as the same incident.
      const overlapThreshold = isExactPlaceMatch ? 2 : 4;

      if (bestOverlap >= overlapThreshold) {
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
