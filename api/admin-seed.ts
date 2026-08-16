import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Redis } from '@upstash/redis';
import type { DisasterReport } from '../src/types/incident.js';
import { isStrictIndiaDisaster } from '../server/classifier.js';

// TEMPORARY one-off migration endpoint: merges a caller-supplied batch of reports into the
// same accumulated-live-reports Redis key api/reports.ts reads/writes, using identical
// dedupe/prune logic. Used once to seed production with localhost's already-accumulated
// reports so production doesn't have to organically re-accumulate them over hours of traffic.
// Delete this file (and the SEED_ADMIN_SECRET env var) once the migration is done — see
// CLAUDE.md Investigation Log 2026-08-16, twelfth entry.
const REDIS_ACCUMULATED_KEY = 'disaster:accumulated-live-reports';
const MAX_ACCUMULATED_REPORTS = 300;
const MAX_ACCUMULATED_AGE_MS = 24 * 60 * 60 * 1000;

const redisRestUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisRestToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const redis = redisRestUrl && redisRestToken ? new Redis({ url: redisRestUrl, token: redisRestToken }) : null;

function dedupeByIdMap(reports: DisasterReport[]): Map<string, DisasterReport> {
  const map = new Map<string, DisasterReport>();
  for (const report of reports) map.set(report.id, report);
  return map;
}

function pruneAndCap(reports: DisasterReport[]): DisasterReport[] {
  const cutoff = Date.now() - MAX_ACCUMULATED_AGE_MS;
  const fresh = reports.filter(
    (r) => new Date(r.timestamp).getTime() >= cutoff && isStrictIndiaDisaster(r.headline, r.description)
  );
  fresh.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  fresh.length = Math.min(fresh.length, MAX_ACCUMULATED_REPORTS);
  return fresh;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'POST only' });
    return;
  }
  const expected = process.env.SEED_ADMIN_SECRET;
  if (!expected || req.headers['x-seed-secret'] !== expected) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (!redis) {
    res.status(500).json({ error: 'Redis not configured' });
    return;
  }

  const incoming = (req.body?.reports || []) as DisasterReport[];
  const existing = (await redis.get<DisasterReport[]>(REDIS_ACCUMULATED_KEY)) || [];
  const merged = pruneAndCap(Array.from(dedupeByIdMap([...existing, ...incoming]).values()));
  await redis.set(REDIS_ACCUMULATED_KEY, merged);

  res.status(200).json({ ok: true, incomingCount: incoming.length, mergedCount: merged.length });
}
