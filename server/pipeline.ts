import { insertReport, saveClusters, queryReports, purgeNonIndiaReports, purgeInvalidClusters } from './db';
import { getFreshMockReports } from '../src/data/mockReports';
import { extractLocation, isStrictIndiaDisaster, classifyCategory, cleanText } from './classifier';
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
  const currentDBIds = new Set(currentDB.map((r) => r.id));
  const validIndiaIds: string[] = [];

  const allReportsToProcess = [...currentDB, ...classifiedFetched];

  for (const report of allReportsToProcess) {
    report.headline = cleanText(report.headline);
    report.description = cleanText(report.description);

    // Reject if not a genuine India disaster
    if (!isStrictIndiaDisaster(report.headline, report.description)) {
      continue;
    }

    // Re-derive category for already-stored reports against the CURRENT classifier rules, not
    // just whatever was stored when the row was first inserted. Only applies to reports read
    // from currentDB — freshly fetched reports (classifiedFetched) already carry a fresh
    // classification from aggregateAndClassify() this same run (possibly AI-derived via
    // classifyReportsBatch), and re-deriving here with the plain keyword classifier would
    // downgrade/overwrite a correct AI classification. Paired with the matching fix in
    // db.ts's insertReport (the ON CONFLICT UPDATE SET used to silently discard a corrected
    // category on write even if one were computed here) — without both halves of this fix, a
    // classifier rule change never actually corrects a report that's already in the database.
    if (currentDBIds.has(report.id)) {
      const freshCategory = classifyCategory(`${report.headline} ${report.description}`.toLowerCase());
      if (freshCategory && freshCategory !== report.category) {
        report.category = freshCategory;
        // This correction is definitionally keyword-derived, not from whatever originally
        // classified the row (which may have been 'ai') — reflect that honestly rather than
        // leaving a stale classificationMethod badge that overstates how this value was set.
        report.classificationMethod = 'keyword-fallback';
      }
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
