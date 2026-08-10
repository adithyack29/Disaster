import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import type { IncidentCluster } from '../../src/types/incident';

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

/**
 * Synthesize a 3-5 sentence operational situation brief from cluster reports using Gemini API
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

  if (!apiKey || apiKey.length < 15) {
    // Local synthesis fallback
    const localBrief = generateLocalBriefFallback(cluster);
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
      model: 'gemini-2.0-flash',
      generationConfig: {
        temperature: 0.2,
      },
    });

    const prompt = `You are an expert NDRF Tactical Command Officer synthesizing a disaster situation brief for operational commanders.

CRITICAL INSTRUCTIONS:
- Synthesize a concise 3-5 sentence natural language operational brief strictly from the provided source reports.
- DO NOT invent, assume, or extrapolate any figures, percentages, casualty numbers, or facts not explicitly stated in the source text.
- If report information is thin or conflicting, state that explicitly.
- Focus on: (1) what happened, (2) current severity & affected area, (3) rescue/relief actions underway.

Cluster Information:
- Location: ${cluster.centerLocation.placeName}, ${cluster.centerLocation.state}
- Category: ${cluster.category.toUpperCase()}
- Highest Severity: ${cluster.highestSeverity.toUpperCase()}
- Total Reports: ${cluster.reports.length}

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
    const localBrief = generateLocalBriefFallback(cluster);
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
 * Fallback Local Synthesis Engine (Zero hallucination ground-truth summary)
 */
function generateLocalBriefFallback(cluster: IncidentCluster): string {
  const officialReps = cluster.reports.filter((r) => r.source.type === 'official');
  const leadReport = officialReps[0] || cluster.reports[0];

  const sentences = [
    `A ${cluster.highestSeverity.toUpperCase()} ${cluster.category.toUpperCase()} incident is active in ${cluster.centerLocation.placeName}, ${cluster.centerLocation.state}.`,
    `Primary dispatch from ${leadReport.source.name} reports: "${leadReport.headline}".`,
    `A total of ${cluster.reports.length} verified telemetry reports have been aggregated across official and news sources.`,
    cluster.totalAffectedEstimate > 0
      ? `Estimated affected population stands at ${cluster.totalAffectedEstimate.toLocaleString('en-IN')} individuals.`
      : `Tactical monitoring and response operations remain ongoing.`,
  ];

  return sentences.join(' ');
}
