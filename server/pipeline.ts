import type { DisasterReport } from '../src/types/incident';
import { insertReport, saveClusters, queryReports, purgeNonIndiaReports, purgeInvalidClusters } from './db';
import { getFreshMockReports } from '../src/data/mockReports';
import { extractLocation, isStrictIndiaDisaster, cleanText } from './classifier';
import { performSmartClustering } from '../src/lib/clustering';
import { fetchUSGSReports } from './adapters/usgsAdapter';
import { fetchEONETReports } from './adapters/eonetAdapter';
import { fetchGDACSReports } from './adapters/gdacsAdapter';
import { fetchReliefWebReports } from './adapters/reliefwebAdapter';
import { fetchMastodonReports } from './adapters/mastodonAdapter';
import { fetchBlueskyReports } from './adapters/blueskyAdapter';
import { fetchRSSReports } from './adapters/rssAdapter';
import { fetchRedditReports } from './adapters/redditAdapter';
import { fetchNewsAPIReports } from './adapters/newsApiAdapter';
import { fetchGNewsReports } from './adapters/gnewsAdapter';

/**
 * Execute the Central Ingestion Pipeline across all 10 data sources
 */
export async function runPipeline(): Promise<void> {
  console.log('[Pipeline] 🚀 Starting real-time India disaster data ingestion run...');

  // 1. Fetch raw telemetry from all adapters concurrently
  const [
    usgs,
    eonet,
    gdacs,
    reliefweb,
    mastodon,
    bluesky,
    rss,
    reddit,
    newsApi,
    gnews,
  ] = await Promise.all([
    fetchUSGSReports(),
    fetchEONETReports(),
    fetchGDACSReports(),
    fetchReliefWebReports(),
    fetchMastodonReports(),
    fetchBlueskyReports(),
    fetchRSSReports(),
    fetchRedditReports(),
    fetchNewsAPIReports(),
    fetchGNewsReports(),
  ]);

  const allFetched: DisasterReport[] = [
    ...usgs,
    ...eonet,
    ...gdacs,
    ...reliefweb,
    ...mastodon,
    ...bluesky,
    ...rss,
    ...reddit,
    ...newsApi,
    ...gnews,
  ];

  console.log(`[Pipeline] 📥 Ingested ${allFetched.length} raw reports across 10 open sources.`);

  // Clean HTML junk from all fetched dispatches
  allFetched.forEach((r) => {
    r.headline = cleanText(r.headline);
    r.description = cleanText(r.description);
  });

  // 2. Strict India Disaster Relevance Filter (Discard foreign conflicts & non-disaster news)
  const indiaOnlyFetched = allFetched.filter((rep) => 
    isStrictIndiaDisaster(rep.headline, rep.description)
  );

  console.log(`[Pipeline] 🇮🇳 Filtered down to ${indiaOnlyFetched.length} verified India-related disaster dispatches.`);

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

  const allReportsToProcess = [...currentDB, ...indiaOnlyFetched];

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
  console.log(`[Pipeline] ✅ India disaster ingestion complete. ${clusterList.length} incident clusters updated with live representative headlines and severity audit logs in SQLite.`);
}
