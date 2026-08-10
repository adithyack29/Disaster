import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'crypto';
import { z } from 'zod';
import type { DisasterReport, CategoryType, SeverityLevel } from '../../src/types/incident';
import { classifyCategory, inferSeverity } from '../classifier';

// 1. Zod Validation Schema for Gemini Structured Output
export const AIClassificationSchema = z.object({
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
      processedReports.push(applyAIResultToReport(report, cached));
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
      model: 'gemini-1.5-flash',
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

    const prompt = `You are an expert NDRF disaster intelligence extraction service. Classify the following disaster news items into structured JSON.
Return a JSON array containing an object for each item matching this exact schema:
[
  {
    "id": number,
    "category": "flood" | "fire" | "earthquake" | "cyclone" | "building_collapse" | "medical" | "landslide",
    "severitySignal": "critical" | "high" | "moderate" | "low",
    "confidence": number between 0.0 and 1.0,
    "extractedEntities": {
      "locationsMentioned": string[],
      "numericFigures": { "peopleAffected"?: number, "waterLevelMeters"?: number, "magnitude"?: number }
    },
    "reasoning": string
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

    // Merge AI results or Keyword Fallback for unCached reports
    for (const { report, hash } of unCachedReports) {
      const itemIndex = promptItems.findIndex((p) => p.headline === report.headline);
      const aiData = itemIndex >= 0 ? aiResultsMap.get(promptItems[itemIndex].id) : undefined;

      if (aiData) {
        classificationCache.set(hash, aiData);
        processedReports.push(applyAIResultToReport(report, aiData));
      } else {
        processedReports.push(applyKeywordFallback(report));
      }
    }
  } catch (error) {
    console.error('[AI Classifier] Gemini API batch classification failed:', error);
    recordFailure();

    // Fall back to keyword classification for all uncached reports
    for (const { report } of unCachedReports) {
      processedReports.push(applyKeywordFallback(report));
    }
  }

  return processedReports;
}

/**
 * Apply AI Structured Extraction to Report while keeping Rule-Based Evaluators in Command
 */
function applyAIResultToReport(report: DisasterReport, ai: AIClassificationResult): DisasterReport {
  const updated = { ...report };

  // AI extracts category, entity numbers, and provides severity signal
  updated.category = ai.category;
  updated.classificationMethod = 'ai';

  if (ai.extractedEntities?.numericFigures?.peopleAffected) {
    updated.affectedPopulationEstimate = ai.extractedEntities.numericFigures.peopleAffected;
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
