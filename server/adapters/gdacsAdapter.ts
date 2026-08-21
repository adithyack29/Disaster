import Parser from 'rss-parser';
import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';
import { hashId } from '../hashId.js';

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

      // No fallback category: forcing an unmatched report into 'cyclone' would previously
      // survive here even though aggregate.ts's isStrictIndiaDisaster() re-derives category from
      // the same text independently and rejects it anyway — the fallback never actually reached
      // a user, but it was misleading/incorrect in the meantime. Skip instead, matching
      // rssAdapter.ts's existing pattern.
      const category = classifyCategory(title + ' ' + content);
      if (!category) continue;

      const loc = extractLocation(title + ' ' + content);
      const severity = inferSeverity(title + ' ' + content);
      const stableId = item.guid || item.link || `${title}-${pubDate}`;

      reports.push({
        id: `gdacs-${hashId(stableId)}`,
        clusterId: `cluster-gdacs-${hashId(stableId)}`,
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
