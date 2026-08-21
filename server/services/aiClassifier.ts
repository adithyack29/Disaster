import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { z } from 'zod';
import type { DisasterReport } from '../../src/types/incident.js';
import { classifyCategory, inferSeverity } from '../classifier.js';

// 1. Zod Validation Schema for Gemini Structured Output
export const AIClassificationSchema = z.object({
  // Whether this text describes a genuine, current disaster/emergency incident an NDRF-style
  // response force would actually care about — as opposed to political news, crime/violence
  // unrelated to a disaster response, an obituary or celebrity health story, a military/defense
  // exercise, sports, entertainment, a routine administrative notice (school holidays, transport
  // schedules), or a pure weather forecast/advisory that isn't describing an already-occurring
  // event. Defaults to true (never silently drop something on a parse hiccup) — see
  // classifyReportsBatch's isGenuineDisaster handling for why this is the primary defense against
  // the keyword gate's false positives (see CLAUDE.md).
  isGenuineDisaster: z.boolean().default(true),
  category: z.enum(['flood', 'fire', 'earthquake', 'cyclone', 'building_collapse', 'medical', 'landslide']),
  severitySignal: z.enum(['critical', 'high', 'moderate', 'low']),
  confidence: z.number().min(0).max(1),
  extractedEntities: z.object({
    locationsMentioned: z.array(z.string()).default([]),
    numericFigures: z.object({
      peopleAffected: z.number().optional(),
      waterLevelMeters: z.number().optional(),
      magnitude: z.number().optional(),
    }).default({}),
  }).default({ locationsMentioned: [], numericFigures: {} }),
  reasoning: z.string().default('AI extraction completed'),
});

export type AIClassificationResult = z.infer<typeof AIClassificationSchema>;

// Cache keyed by SHA-256 text hash
const classificationCache = new Map<string, AIClassificationResult>();

// Circuit Breaker State
let circuitBreakerOpen = false;
let circuitBreakerTrippedUntil = 0;
let consecutiveFailures = 0;

// Diagnostic-only state so callers (e.g. api/reports.ts) can report why Gemini classification
// isn't running without needing Vercel Function Logs access — see CLAUDE.md Investigation Log
// 2026-08-16, sixth entry (the "VITE_GEMINI_API_KEY is set but classificationMethod is always
// keyword-fallback" mystery). Safe to remove once root-caused.
let lastGeminiError: string | null = null;

export function getAIClassifierDiagnostic() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
  return {
    keyPresent: Boolean(apiKey),
    keyLength: apiKey ? apiKey.length : 0,
    circuitBreakerOpen,
    circuitBreakerTrippedUntil: circuitBreakerOpen ? new Date(circuitBreakerTrippedUntil).toISOString() : null,
    consecutiveFailures,
    lastGeminiError,
  };
}

function isCircuitBreakerOpen(): boolean {
  if (!circuitBreakerOpen) return false;
  if (Date.now() > circuitBreakerTrippedUntil) {
    console.log('[AI Classifier] 🔄 Circuit breaker cooldown elapsed. Testing Gemini API recovery...');
    circuitBreakerOpen = false;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordFailure(): void {
  consecutiveFailures++;
  if (consecutiveFailures >= 3) {
    circuitBreakerOpen = true;
    circuitBreakerTrippedUntil = Date.now() + 3 * 60 * 1000; // 3 minute cooldown
    console.warn(`[AI Classifier] ⚠️ 3 consecutive Gemini API failures detected. Circuit breaker TRIPPED OPEN for 3 minutes. Falling back to keyword classification.`);
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitBreakerOpen = false;
}

function computeTextHash(text: string): string {
  return crypto.createHash('sha256').update(text.toLowerCase().trim()).digest('hex');
}

/**
 * Classify a batch of reports using Google Gemini AI with fallback & circuit breaker protection
 */
export async function classifyReportsBatch(reports: DisasterReport[]): Promise<DisasterReport[]> {
  if (!reports || reports.length === 0) return [];

  const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

  // Check Circuit Breaker or API key presence
  if (isCircuitBreakerOpen() || !apiKey || apiKey.length < 15) {
    if (!apiKey) console.log('[AI Classifier] ℹ️ GEMINI_API_KEY not found in backend .env. Using keyword-fallback classification.');
    return reports.map((r) => applyKeywordFallback(r));
  }

  const unCachedReports: { report: DisasterReport; hash: string }[] = [];
  const processedReports: DisasterReport[] = [];

  // Check Cache first
  for (const report of reports) {
    const textHash = computeTextHash(`${report.headline} ${report.description}`);
    const cached = classificationCache.get(textHash);

    if (cached) {
      const applied = applyAIResultToReport(report, cached);
      if (applied) processedReports.push(applied);
      else console.log(`[AI Classifier] 🚫 Excluded (cached, not a genuine disaster): "${report.headline}"`);
    } else {
      unCachedReports.push({ report, hash: textHash });
    }
  }

  if (unCachedReports.length === 0) {
    return processedReports; // 100% Cache Hit!
  }

  // Perform Batch Gemini API Call with Retry Logic
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-flash-latest',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    const promptItems = unCachedReports.map((item, index) => ({
      id: index,
      headline: item.report.headline,
      description: item.report.description,
    }));

    const prompt = `You are an expert NDRF (National Disaster Response Force) intelligence triage service. For each news item below, decide (1) whether it describes a GENUINE, CURRENT disaster/emergency incident that NDRF would actually need to monitor or respond to, and (2) if so, classify it.

Set "isGenuineDisaster": true ONLY for items describing an actual, ongoing or recent disaster/emergency event in one of these categories: flood, fire, earthquake, cyclone/storm, building/structure collapse, mass-casualty medical emergency (e.g. stampede, mass poisoning, epidemic outbreak), or landslide.

Set "isGenuineDisaster": false for everything else, even if it contains a word like "fire", "flood", "hospital", or "injured" — including but not limited to:
- Political news, protests, dharnas, or statements by politicians (even about a past disaster)
- Crime, violence, terrorism, or accidents unrelated to a natural/structural disaster (murders, shootings, trafficking, road accidents, court cases, arrests)
- Obituaries, celebrity deaths, or health news about a specific named individual (e.g. "actor dies of age-related illness")
- Military/defense exercises, drills, or troop movements
- Sports, entertainment, culture, or human-interest stories
- Routine administrative announcements (school holidays, exam schedules, transport timetables)
- Pure weather forecasts/advisories/predictions that do NOT describe an already-occurring disaster (e.g. "IMD predicts rain tomorrow", "yellow alert issued for next week") — only mark true if the disaster is already happening or has already happened
- Financial, economic, agricultural, or infrastructure commentary that only mentions a disaster in passing
- Follow-up human-interest coverage once the emergency itself has clearly ended (e.g. a fundraiser, a memorial, a legal compensation ruling) — the original incident report is what should be marked true, not every downstream story about it

When "isGenuineDisaster" is false, you may still fill "category"/"severitySignal" with your best guess (they will be ignored) — do not omit them.

Return a JSON array containing an object for each item matching this exact schema:
[
  {
    "id": number,
    "isGenuineDisaster": boolean,
    "category": "flood" | "fire" | "earthquake" | "cyclone" | "building_collapse" | "medical" | "landslide",
    "severitySignal": "critical" | "high" | "moderate" | "low",
    "confidence": number between 0.0 and 1.0,
    "extractedEntities": {
      "locationsMentioned": string[],
      "numericFigures": { "peopleAffected"?: number, "waterLevelMeters"?: number, "magnitude"?: number }
    },
    "reasoning": string (briefly state WHY it is or isn't a genuine disaster)
  }
]

Input Items:
${JSON.stringify(promptItems, null, 2)}`;

    // Exponential Backoff Retry (Max 2 retries)
    let responseText = '';
    let attempt = 0;
    const maxRetries = 2;

    while (attempt <= maxRetries) {
      try {
        const result = await model.generateContent(prompt);
        responseText = result.response.text();
        recordSuccess();
        break;
      } catch (err: any) {
        attempt++;
        if (attempt > maxRetries) {
          throw err;
        }
        const backoffMs = Math.pow(2, attempt) * 500 + Math.random() * 200;
        console.warn(`[AI Classifier] Transient Gemini call failed (Attempt ${attempt}/${maxRetries}). Retrying in ${Math.round(backoffMs)}ms...`);
        await new Promise((res) => setTimeout(res, backoffMs));
      }
    }

    // Parse & Validate Response JSON
    const parsedJSON = JSON.parse(responseText);
    const itemArray = Array.isArray(parsedJSON) ? parsedJSON : [parsedJSON];

    const aiResultsMap = new Map<number, AIClassificationResult>();

    for (const rawItem of itemArray) {
      const valResult = AIClassificationSchema.safeParse(rawItem);
      if (valResult.success) {
        aiResultsMap.set(rawItem.id, valResult.data);
      } else {
        console.warn(`[AI Classifier] Zod validation failed for item id ${rawItem.id}:`, valResult.error.format());
      }
    }

    // Merge AI results or Keyword Fallback for unCached reports. Matched by array index (which
    // is exactly what promptItems' 'id' field was set to when the prompt was built), NOT by
    // re-searching for a matching headline — two reports can legitimately share byte-identical
    // headlines (wire-service syndication across multiple outlets is common), and
    // `findIndex(headline match)` always resolves to the FIRST such report, silently assigning
    // every later duplicate-headline report the wrong report's AI classification result.
    for (let i = 0; i < unCachedReports.length; i++) {
      const { report, hash } = unCachedReports[i];
      const aiData = aiResultsMap.get(i);

      if (aiData) {
        classificationCache.set(hash, aiData);
        const applied = applyAIResultToReport(report, aiData);
        if (applied) processedReports.push(applied);
        else console.log(`[AI Classifier] 🚫 Excluded (${aiData.reasoning}): "${report.headline}"`);
      } else {
        processedReports.push(applyKeywordFallback(report));
      }
    }
  } catch (error) {
    console.error('[AI Classifier] Gemini API batch classification failed:', error);
    lastGeminiError = error instanceof Error ? error.message : String(error);
    recordFailure();

    // Fall back to keyword classification for all uncached reports
    for (const { report } of unCachedReports) {
      processedReports.push(applyKeywordFallback(report));
    }
  }

  return processedReports;
}

/**
 * Apply AI Structured Extraction to Report while keeping Rule-Based Evaluators in Command.
 * Returns null when Gemini determined this isn't a genuine disaster — the caller drops it
 * entirely rather than showing it with a best-guess category (see AIClassificationSchema's
 * isGenuineDisaster field and CLAUDE.md).
 */
function applyAIResultToReport(report: DisasterReport, ai: AIClassificationResult): DisasterReport | null {
  if (!ai.isGenuineDisaster) {
    return null;
  }

  const updated = { ...report };

  // AI extracts category, entity numbers, and provides severity signal
  updated.category = ai.category;
  updated.classificationMethod = 'ai';

  if (ai.extractedEntities?.numericFigures?.peopleAffected) {
    updated.affectedPopulationEstimate = ai.extractedEntities.numericFigures.peopleAffected;
  }

  // Sharpen a too-generic rule-based location (extractLocation() fell back to just the state
  // name because its fixed dictionary doesn't know the specific city/town mentioned in the
  // text) using Gemini's own extracted location mention, when it names something more specific
  // than the state itself. Only placeName (used for clustering + display) is sharpened — lat/lng
  // stay at the rule-based state-center coordinate, since we have no geocoding for an arbitrary
  // AI-mentioned place name. This is what stops e.g. a Tarapith hotel fire from clustering
  // together with an unrelated Kolkata hotel fire under the generic "West Bengal" placeName both
  // fell back to — see clustering.ts's place-mismatch veto and CLAUDE.md.
  const mention = ai.extractedEntities?.locationsMentioned?.[0]?.trim();
  const isGenericPlace = updated.location.placeName.toLowerCase() === updated.location.state.toLowerCase();
  if (mention && isGenericPlace && mention.toLowerCase() !== updated.location.state.toLowerCase()) {
    updated.location = { ...updated.location, placeName: mention };
  }

  return updated;
}

/**
 * Apply Keyword-Based Fallback Classification
 */
function applyKeywordFallback(report: DisasterReport): DisasterReport {
  const updated = { ...report };
  const text = `${report.headline} ${report.description}`;

  const category = classifyCategory(text);
  if (category) {
    updated.category = category;
  }
  updated.severity = inferSeverity(text);
  updated.classificationMethod = 'keyword-fallback';
  return updated;
}
