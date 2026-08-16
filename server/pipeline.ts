import { insertReport, saveClusters, queryReports, purgeNonIndiaReports, purgeInvalidClusters } from './db';
import { getFreshMockReports } from '../src/data/mockReports';
import { extractLocation, isStrictIndiaDisaster, cleanText } from './classifier';
import { performSmartClustering } from '../src/lib/clustering';
import { aggregateAndClassify } from './aggregate';

/**
 * Execute the Central Ingestion Pipeline across all 10 data sources
 */
export async function runPipeline(): Promise<void> {
  console.log('[Pipeline] 🚀 Starting real-time India disaster data ingestion run...');

  // 1-2.5. Fetch, filter to India disasters, and classify (shared with the Vercel serverless
  // endpoint in api/reports.ts — see server/aggregate.ts).
  const classifiedFetched = await aggregateAndClassify();
  console.log(`[Pipeline] 📥 Ingested ${classifiedFetched.length} classified India disaster dispatches across 10 open sources.`);

  // Seed baseline mock dataset if DB is empty
  const existingDBReports = queryReports();
  if (existingDBReports.length < 15) {
    console.log('[Pipeline] 📦 Seeding initial baseline telemetry dataset into SQLite...');
    getFreshMockReports().forEach((rep) => {
      rep.headline = cleanText(rep.headline);
      rep.description = cleanText(rep.description);
      insertReport(rep);
    });
  }

  // 3. Process & Purge non-disaster / foreign reports from SQLite
  const currentDB = queryReports();
  const validIndiaIds: string[] = [];

  const allReportsToProcess = [...currentDB, ...classifiedFetched];

  for (const report of allReportsToProcess) {
    report.headline = cleanText(report.headline);
    report.description = cleanText(report.description);

    // Reject if not a genuine India disaster
    if (!isStrictIndiaDisaster(report.headline, report.description)) {
      continue;
    }

    const text = `${report.headline} ${report.description}`;
    report.location = extractLocation(text);
    insertReport(report);
    validIndiaIds.push(report.id);
  }

  if (validIndiaIds.length > 0) {
    purgeNonIndiaReports(validIndiaIds);
  }

  // Hard purge any invalid or non-disaster category records
  purgeInvalidClusters();

  // 4. Recompute Clusters using Smart Precision Semantic Clustering & Representative Selection
  const updatedReports = queryReports();
  const clusterList = performSmartClustering(updatedReports);

  saveClusters(clusterList);
  console.log(`[Pipeline] ✅ India disaster ingestion complete. ${clusterList.length} incident clusters updated with AI classification and severity audit logs in SQLite.`);
}
