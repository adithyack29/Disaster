import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { queryReports, db } from './db';
import { runPipeline } from './pipeline';
import { performSmartClustering } from '../src/lib/clustering';
import { generateAISituationBrief } from './services/aiSituationBrief';
import type { FilterState, DisasterReport, IncidentCluster, DashboardStats } from '../src/types/incident';

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
 * Filter helper matching frontend logic
 */
function filterReports(reports: DisasterReport[], filters?: Partial<FilterState>): DisasterReport[] {
  if (!filters) return reports;

  return reports.filter((r) => {
    if (filters.categories && filters.categories.length > 0) {
      if (!filters.categories.includes(r.category)) return false;
    }
    if (filters.severities && filters.severities.length > 0) {
      if (!filters.severities.includes(r.severity)) return false;
    }
    if (filters.verifiedOnly && !r.source.verified) return false;
    if (filters.region && filters.region !== 'all') {
      if (r.location.state.toLowerCase() !== filters.region.toLowerCase()) return false;
    }
    if (filters.sourceType && filters.sourceType !== 'all') {
      if (r.source.type !== filters.sourceType) return false;
    }
    if (filters.searchQuery && filters.searchQuery.trim() !== '') {
      const q = filters.searchQuery.toLowerCase().trim();
      const match =
        r.headline.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.location.placeName.toLowerCase().includes(q) ||
        r.source.name.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });
}

// REST Endpoints

/**
 * GET /api/reports
 */
app.get('/api/reports', (req, res) => {
  const all = queryReports();
  const categoriesStr = req.query.categories as string;
  const severitiesStr = req.query.severities as string;
  const verifiedOnly = req.query.verifiedOnly === 'true';
  const region = (req.query.region as string) || 'all';
  const searchQuery = (req.query.search as string) || '';
  const sourceType = (req.query.sourceType as any) || 'all';

  const categories = categoriesStr ? (categoriesStr.split(',') as any) : [];
  const severities = severitiesStr ? (severitiesStr.split(',') as any) : [];

  const filtered = filterReports(all, {
    categories,
    severities,
    verifiedOnly,
    region,
    searchQuery,
    sourceType,
  });

  res.json(filtered);
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
  } catch (err) {
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
  } catch (error) {
    res.status(500).json({ error: 'Pipeline execution failed' });
  }
});

app.listen(PORT, () => {
  console.log(`[Server] ⚡ NDRF Disaster Ingestion Backend running on http://localhost:${PORT}`);
});
