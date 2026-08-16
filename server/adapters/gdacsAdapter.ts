import Parser from 'rss-parser';
import type { DisasterReport, CategoryType } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

export async function fetchGDACSReports(): Promise<DisasterReport[]> {
  try {
    const feed = await parser.parseURL('https://www.gdacs.org/xml/rss.xml');
    const reports: DisasterReport[] = [];

    for (const item of feed.items || []) {
      const title = item.title || 'GDACS Alert';
      const content = item.contentSnippet || item.content || title;
      const pubDate = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

      const category: CategoryType = classifyCategory(title + ' ' + content) || 'cyclone';
      const loc = extractLocation(title + ' ' + content);
      const severity = inferSeverity(title + ' ' + content);

      reports.push({
        id: `gdacs-${item.guid || item.link || Math.random()}`,
        clusterId: `cluster-gdacs-${item.guid || Math.random()}`,
        category,
        severity,
        location: loc,
        headline: title,
        description: content.slice(0, 300),
        source: {
          type: 'official',
          name: 'GDACS Multi-Hazard Alert',
          verified: true,
        },
        credibilityScore: calculateCredibility({ type: 'official', name: 'GDACS', verified: true }),
        language: 'en',
        timestamp: pubDate,
      });
    }

    return reports;
  } catch (error) {
    console.error('[gdacsAdapter] Error parsing GDACS RSS feed:', error);
    return [];
  }
}
