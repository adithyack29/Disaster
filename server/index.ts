import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { queryReports } from './db';
import { runPipeline } from './pipeline';
import { performSmartClustering } from '../src/lib/clustering';
import { generateAISituationBrief } from './services/aiSituationBrief';
import { getFreshMockReports } from '../src/data/mockReports';
import type { DisasterReport, DashboardStats } from '../src/types/incident';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Run initial pipeline run on server start
runPipeline();

// Periodically run ingestion pipeline every 3 minutes
setInterval(() => {
  runPipeline().catch((err) => console.error('[Server] Pipeline interval error:', err));
}, 3 * 60 * 1000);

/**
 * A report is "live" if it came from a real adapter this session, vs. the curated demo-safety
 * seed data (server/pipeline.ts inserts baseline mock reports with `rep-*` IDs — see
 * src/data/mockReports.ts). Filtering is done client-side (src/data/mockApi.ts's applyFilters)
 * — this endpoint intentionally has no server-side filter params to avoid the two drifting
 * apart, which already happened once (see CLAUDE.md Investigation Log).
 */
function isLiveReport(report: DisasterReport): boolean {
  return !report.id.startsWith('rep-');
}

// REST Endpoints

/**
 * GET /api/reports
 *
 * Demo-safety contract (mirrors api/reports.ts on Vercel — see CLAUDE.md): if the DB currently
 * holds any live-ingested reports, serve those (mode: 'live'). Otherwise — pipeline hasn't run
 * yet, every source failed, or this is a fresh demo-mode DB — serve the curated snapshot
 * (mode: 'demo'), freshly re-timestamped so it always reads as "now" rather than stale seed data.
 */
app.get('/api/reports', (_req, res) => {
  const all = queryReports();
  const liveReports = all.filter(isLiveReport);

  if (liveReports.length > 0) {
    res.json({
      reports: liveReports,
      mode: 'live',
      liveCount: liveReports.length,
      generatedAt: new Date().toISOString(),
    });
    return;
  }

  res.json({
    reports: getFreshMockReports(),
    mode: 'demo',
    liveCount: 0,
    generatedAt: new Date().toISOString(),
  });
});

/**
 * GET /api/reports/:id
 */
app.get('/api/reports/:id', (req, res) => {
  const all = queryReports();
  const found = all.find((r) => r.id === req.params.id);
  if (!found) {
    return res.status(404).json({ error: 'Report not found' });
  }
  res.json(found);
});

/**
 * GET /api/clusters
 */
app.get('/api/clusters', (req, res) => {
  const allReports = queryReports();
  const clusterList = performSmartClustering(allReports);
  res.json(clusterList);
});

/**
 * GET /api/clusters/:clusterId
 */
app.get('/api/clusters/:clusterId', (req, res) => {
  const all = queryReports();
  const clusterReports = all.filter((r) => r.clusterId === req.params.clusterId);

  if (clusterReports.length === 0) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const clusters = performSmartClustering(clusterReports);
  if (clusters.length === 0) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  res.json(clusters[0]);
});

/**
 * POST /api/clusters/:clusterId/brief (Generate/Retrieve Cached AI Situation Brief)
 */
app.post('/api/clusters/:clusterId/brief', async (req, res) => {
  const all = queryReports();
  const clusterReports = all.filter((r) => r.clusterId === req.params.clusterId);

  if (clusterReports.length === 0) {
    return res.status(404).json({ error: 'Cluster not found' });
  }

  const clusters = performSmartClustering(clusterReports);
  if (clusters.length === 0) {
    return res.status(404).json({ error: 'Cluster could not be processed' });
  }

  try {
    const briefResult = await generateAISituationBrief(clusters[0]);
    res.json(briefResult);
  } catch {
    res.status(500).json({ error: 'AI Brief generation failed' });
  }
});

/**
 * POST /api/situation-brief (stateless variant — takes a client-computed cluster payload,
 * mirrors api/situation-brief.ts on Vercel so both environments share one contract)
 */
app.post('/api/situation-brief', async (req, res) => {
  const cluster = req.body?.cluster;
  if (!cluster || !cluster.clusterId || !Array.isArray(cluster.reports)) {
    return res.status(400).json({ error: 'Request body must include a valid { cluster } payload' });
  }

  try {
    const brief = await generateAISituationBrief(cluster);
    res.json(brief);
  } catch {
    res.status(500).json({ error: 'AI Brief generation failed' });
  }
});

/**
 * GET /api/stats
 */
app.get('/api/stats', (req, res) => {
  const all = queryReports();
  const nowMs = Date.now();
  const oneHourAgo = nowMs - 3600 * 1000;

  const criticalCount = all.filter((r) => r.severity === 'critical').length;
  const highCount = all.filter((r) => r.severity === 'high').length;
  const reportsLastHour = all.filter((r) => new Date(r.timestamp).getTime() >= oneHourAgo).length;
  const verifiedCount = all.filter((r) => r.source.verified).length;
  const verifiedPercentage = all.length > 0 ? Math.round((verifiedCount / all.length) * 100) : 0;
  const sourceNames = new Set(all.map((r) => r.source.name));

  const stats: DashboardStats = {
    activeIncidents: all.length,
    criticalCount,
    highCount,
    reportsLastHour,
    verifiedPercentage,
    monitoredSourcesCount: sourceNames.size,
  };

  res.json(stats);
});

/**
 * POST /api/pipeline/run (Manual Trigger)
 */
app.post('/api/pipeline/run', async (req, res) => {
  try {
    await runPipeline();
    res.json({ success: true, message: 'Pipeline ingestion run completed.' });
  } catch {
    res.status(500).json({ error: 'Pipeline execution failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] ⚡ NDRF Disaster Ingestion Backend running on http://localhost:${PORT}`);
});
