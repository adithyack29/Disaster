import type { IncidentCluster } from '../types/incident';

export interface AISummaryResult {
  brief: string;
  source: 'gemini' | 'local_engine';
}

/**
 * Client-side, zero-hallucination fallback brief — used only when /api/situation-brief itself
 * is unreachable (see mockApi.ts's fallback chain). Mirrors the same four-section structure as
 * server/services/aiSituationBrief.ts's Gemini prompt/local fallback so the UI renders
 * consistently no matter which path served the brief.
 *
 * Earlier versions of this function guessed at "deployed tactical assets" (boats, pumps,
 * excavators) from keyword matches in the report text and asserted unconditional claims like
 * "Emergency response teams are actively managing ground protocols" even when nothing in the
 * source reports said so — a real violation of this project's own no-hallucination principle for
 * this feature (see CLAUDE.md). Rewritten to state only facts already computed elsewhere
 * (rule-based severity/affected-population estimate, aggregated credibility, source counts) or
 * explicitly attributed to a source (report.actionRequired), never a guess.
 */
export async function generateAISummary(cluster: IncidentCluster): Promise<AISummaryResult> {
  const leadReport =
    cluster.reports.find((r) => r.source.type === 'official') || cluster.reports[0];

  const uniqueSourceNames = Array.from(new Set(cluster.reports.map((r) => r.source.name)));
  const officialSourceCount = cluster.reports.filter((r) => r.source.type === 'official').length;
  const avgCredibility = Math.round(
    cluster.reports.reduce((acc, r) => acc + r.credibilityScore, 0) / (cluster.reports.length || 1)
  );
  const first = new Date(cluster.firstReportedAt).getTime();
  const last = new Date(cluster.lastReportedAt || cluster.firstReportedAt).getTime();
  const spanHours = Math.max(0, Math.round(((last - first) / (1000 * 60 * 60)) * 10) / 10);

  const statedActions = cluster.reports
    .map((r) => r.actionRequired)
    .filter((a): a is string => Boolean(a && a.trim()));

  const situationSummary = `A ${cluster.highestSeverity.toUpperCase()} ${cluster.category.toUpperCase()} incident is active in ${cluster.centerLocation.placeName}, ${cluster.centerLocation.state}. Primary dispatch from ${leadReport.source.name}: "${leadReport.headline}".`;

  const severityScale = cluster.totalAffectedEstimate > 0
    ? `Estimated affected population stands at ${cluster.totalAffectedEstimate.toLocaleString('en-IN')} individuals, per rule-based assessment of the aggregated reports.`
    : `Affected population has not yet been estimated from current reporting.`;

  const responseStatus = statedActions.length > 0
    ? statedActions.slice(0, 2).join(' ')
    : `No response or rescue action has been explicitly stated by any source in this cluster yet.`;

  const sourceReliability = `${cluster.reports.length} report(s) from ${uniqueSourceNames.length} distinct source(s) (${officialSourceCount} official) corroborate this incident, average credibility score ${avgCredibility}%, spanning ${spanHours} hour(s) of reporting.`;

  const brief = [
    'SITUATION SUMMARY',
    situationSummary,
    '',
    'SEVERITY & SCALE',
    severityScale,
    '',
    'RESPONSE STATUS',
    responseStatus,
    '',
    'SOURCE RELIABILITY',
    sourceReliability,
  ].join('\n');

  return { brief, source: 'local_engine' };
}
