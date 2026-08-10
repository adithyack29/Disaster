import Parser from 'rss-parser';
import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory, isStrictIndiaDisaster, cleanText } from '../classifier';

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

// Reliable public Indian disaster & news RSS feeds
const RSS_FEEDS = [
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', name: 'Times of India India News' },
  { url: 'https://feeds.feedburner.com/ndtvnews-india-news', name: 'NDTV India Feed' },
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu National' },
];

export async function fetchRSSReports(): Promise<DisasterReport[]> {
  const reports: DisasterReport[] = [];

  for (const feedConfig of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedConfig.url);

      for (const item of (feed.items || []).slice(0, 15)) {
        const rawTitle = item.title || '';
        const rawContent = item.contentSnippet || item.content || rawTitle;

        const title = cleanText(rawTitle);
        const content = cleanText(rawContent);

        // Strict Disaster & India Relevance Filter
        if (!isStrictIndiaDisaster(title, content)) {
          continue; // Skip non-disaster / foreign items
        }

        const category = classifyCategory(`${title} ${content}`);
        if (!category) continue;

        const loc = extractLocation(`${title} ${content}`);
        const time = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

        reports.push({
          id: `rss-${item.guid || item.link || Math.random()}`,
          clusterId: `cluster-rss-${item.guid || Math.random()}`,
          category,
          severity: inferSeverity(`${title} ${content}`),
          location: loc,
          headline: title,
          description: content.slice(0, 280),
          source: {
            type: 'news',
            name: feedConfig.name,
            verified: true,
            handleOrUrl: item.link,
          },
          credibilityScore: calculateCredibility({ type: 'news', name: feedConfig.name, verified: true }),
          language: 'en',
          timestamp: time,
        });
      }
    } catch (error) {
      console.warn(`[rssAdapter] Could not parse RSS feed ${feedConfig.url}:`, error);
    }
  }

  return reports;
}
