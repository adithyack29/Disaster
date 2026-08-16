import type { VercelRequest, VercelResponse } from '@vercel/node';
import { generateAISituationBrief } from '../server/services/aiSituationBrief';

/**
 * Generates (or returns a cached) AI situation brief for a cluster. The client computes and
 * owns the IncidentCluster (see src/lib/clustering.ts, shared with the dev backend) and posts
 * it here so this endpoint stays stateless — no SQLite/cluster store on the serverless side.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const cluster = req.body?.cluster;
  if (!cluster || !cluster.clusterId || !Array.isArray(cluster.reports)) {
    res.status(400).json({ error: 'Request body must include a valid { cluster } payload' });
    return;
  }

  try {
    const brief = await generateAISituationBrief(cluster);
    res.status(200).json(brief);
  } catch (err) {
    console.error('[api/situation-brief] generation failed:', err);
    res.status(500).json({ error: 'AI brief generation failed' });
  }
}
