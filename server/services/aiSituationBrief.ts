import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import type { IncidentCluster } from '../../src/types/incident.js';

export interface AISituationBriefResponse {
  brief: string;
  generatedAt: string;
  reportCount: number;
  reportIds: string[];
  source: 'gemini' | 'local_engine';
}

interface CacheEntry {
  briefResponse: AISituationBriefResponse;
  hash: string;
}

// Cache keyed by clusterId -> { briefResponse, hash }
const briefCache = new Map<string, CacheEntry>();

function computeClusterHash(cluster: IncidentCluster): string {
  const reportKeys = cluster.reports
    .map((r) => `${r.id}:${r.timestamp}`)
    .sort()
    .join('|');
  return crypto.createHash('sha256').update(`${cluster.clusterId}:${reportKeys}`).digest('hex');
}

// Computed once and handed to both the Gemini prompt and the local fallback so the two paths
// stay consistent — neither has to guess at facts the other already has available.
interface ClusterStats {
  sourceCount: number;
  uniqueSourceNames: string[];
  avgCredibility: number;
  officialSourceCount: number;
  spanHours: number;
}

function computeClusterStats(cluster: IncidentCluster): ClusterStats {
  const uniqueSourceNames = Array.from(new Set(cluster.reports.map((r) => r.source.name)));
  const avgCredibility = Math.round(
    cluster.reports.reduce((acc, r) => acc + r.credibilityScore, 0) / (cluster.reports.length || 1)
  );
  const officialSourceCount = cluster.reports.filter((r) => r.source.type === 'official').length;
  const first = new Date(cluster.firstReportedAt).getTime();
  const last = new Date(cluster.lastReportedAt || cluster.firstReportedAt).getTime();
  const spanHours = Math.max(0, Math.round(((last - first) / (1000 * 60 * 60)) * 10) / 10);

  return {
    sourceCount: cluster.reports.length,
    uniqueSourceNames,
    avgCredibility,
    officialSourceCount,
    spanHours,
  };
}

/**
 * Synthesize a structured operational situation brief from cluster reports using Gemini API.
 */
export async function generateAISituationBrief(cluster: IncidentCluster): Promise<AISituationBriefResponse> {
  const currentHash = computeClusterHash(cluster);
  const cached = briefCache.get(cluster.clusterId);

  // Return cached brief if report set has not changed
  if (cached && cached.hash === currentHash) {
    console.log(`[AI Situation Brief] ⚡ Cache HIT for cluster ${cluster.clusterId} (${cluster.reports.length} reports). Reusing cached brief.`);
    return cached.briefResponse;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  const reportIds = cluster.reports.map((r) => r.id);
  const nowISO = new Date().toISOString();

  // Detail every single report in the cluster
  const reportTexts = cluster.reports
    .map(
      (r, i) =>
        `Report #${i + 1} [Source: ${r.source.name} | Type: ${r.source.type.toUpperCase()} | Credibility: ${r.credibilityScore}%]: ${r.headline}. ${r.description || 'No additional text.'}`
    )
    .join('\n\n');

  const stats = computeClusterStats(cluster);

  if (!apiKey || apiKey.length < 15) {
    // Local synthesis fallback
    const localBrief = generateLocalBriefFallback(cluster, stats);
    const result: AISituationBriefResponse = {
      brief: localBrief,
      generatedAt: nowISO,
      reportCount: cluster.reports.length,
      reportIds,
      source: 'local_engine',
    };
    briefCache.set(cluster.clusterId, { briefResponse: result, hash: currentHash });
    return result;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: {
        temperature: 0.2,
      },
    });

    const prompt = `You are an expert NDRF Tactical Command Officer synthesizing a disaster situation brief for operational commanders.

CRITICAL INSTRUCTIONS:
- DO NOT invent, assume, or extrapolate any figures, percentages, casualty numbers, resources, or facts not explicitly stated in the source text.
- If a section below has nothing to report from the source text, write "Not stated in current reporting." for that section instead of guessing or omitting it.
- If reports conflict with each other, say so explicitly rather than picking one silently.
- Output EXACTLY these four section headers, each in plain text (no markdown bold/asterisks), followed by 1-3 sentences of body text, in this order and with no other text before, between, or after them:

SITUATION SUMMARY
SEVERITY & SCALE
RESPONSE STATUS
SOURCE RELIABILITY

Guidance per section:
- SITUATION SUMMARY: what happened, where, and when, strictly from the reports.
- SEVERITY & SCALE: the affected area/population and any casualty figures explicitly stated in the reports (the numeric severity/affected-population figures given below are already rule-computed and may be cited directly).
- RESPONSE STATUS: rescue/relief actions the reports explicitly describe as underway. If none are mentioned, say so plainly rather than assuming a response is happening.
- SOURCE RELIABILITY: a brief note on how many independent sources corroborate this, and whether any are official agencies (the counts below are already computed and may be cited directly).

Cluster Information:
- Location: ${cluster.centerLocation.placeName}, ${cluster.centerLocation.state}
- Category: ${cluster.category.toUpperCase()}
- Highest Severity: ${cluster.highestSeverity.toUpperCase()}
- Rule-computed affected population estimate: ${cluster.totalAffectedEstimate > 0 ? cluster.totalAffectedEstimate.toLocaleString('en-IN') : 'not yet estimated'}
- Total Reports: ${stats.sourceCount} from ${stats.uniqueSourceNames.length} distinct source(s) (${stats.officialSourceCount} official), average credibility score ${stats.avgCredibility}%
- Reporting span: first report to latest report covers ${stats.spanHours} hour(s)

Source Telemetry Reports:
${reportTexts}`;

    const result = await model.generateContent(prompt);
    const briefText = result.response.text().trim();

    const responsePayload: AISituationBriefResponse = {
      brief: briefText,
      generatedAt: nowISO,
      reportCount: cluster.reports.length,
      reportIds,
      source: 'gemini',
    };

    briefCache.set(cluster.clusterId, { briefResponse: responsePayload, hash: currentHash });
    console.log(`[AI Situation Brief] ✅ Successfully generated & cached new Gemini brief for cluster ${cluster.clusterId}.`);
    return responsePayload;
  } catch (error) {
    console.error(`[AI Situation Brief] Failed to generate Gemini brief for cluster ${cluster.clusterId}:`, error);

    // Fall back to local synthesis on API error
    const localBrief = generateLocalBriefFallback(cluster, stats);
    const fallbackPayload: AISituationBriefResponse = {
      brief: localBrief,
      generatedAt: nowISO,
      reportCount: cluster.reports.length,
      reportIds,
      source: 'local_engine',
    };
    return fallbackPayload;
  }
}

/**
 * Fallback Local Synthesis Engine (used when no Gemini key is configured, or the Gemini call
 * itself fails). Mirrors the same four-section structure the Gemini prompt is instructed to
 * produce, so the UI renders consistently regardless of which path served the brief — but built
 * entirely from fields already computed elsewhere (rule-based severity/affected-population
 * estimate, aggregated credibility, source counts) rather than free-text generation, so there is
 * nothing here to hallucinate.
 */
function generateLocalBriefFallback(cluster: IncidentCluster, stats: ClusterStats): string {
  const officialReps = cluster.reports.filter((r) => r.source.type === 'official');
  const leadReport = officialReps[0] || cluster.reports[0];
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

  const sourceReliability = `${stats.sourceCount} report(s) from ${stats.uniqueSourceNames.length} distinct source(s) (${stats.officialSourceCount} official) corroborate this incident, average credibility score ${stats.avgCredibility}%, spanning ${stats.spanHours} hour(s) of reporting.`;

  return [
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
}
