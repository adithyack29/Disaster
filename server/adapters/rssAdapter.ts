import Parser from 'rss-parser';
import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory, isStrictIndiaDisaster, cleanText } from '../classifier';

const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

// Comprehensive list of reliable public Indian disaster & news RSS feeds
const RSS_FEEDS = [
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu National' },
  { url: 'https://www.thehindu.com/news/states/feeder/default.rss', name: 'The Hindu States' },
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', name: 'Times of India India' },
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/2647163.cms', name: 'Times of India Environment' },
  { url: 'https://feeds.feedburner.com/ndtvnews-india-news', name: 'NDTV India' },
  { url: 'https://feeds.feedburner.com/ndtvnews-latest', name: 'NDTV Latest' },
  { url: 'https://indianexpress.com/section/india/feed/', name: 'Indian Express' },
];

export async function fetchRSSReports(): Promise<DisasterReport[]> {
  const reports: DisasterReport[] = [];

  for (const feedConfig of RSS_FEEDS) {
    try {
      const feed = await parser.parseURL(feedConfig.url);

      for (const item of (feed.items || []).slice(0, 30)) {
        const rawTitle = item.title || '';
        const rawContent = item.contentSnippet || item.content || rawTitle;

        const title = cleanText(rawTitle);
        const content = cleanText(rawContent);

        // Strict Disaster & India Relevance Filter
        if (!isStrictIndiaDisaster(title, content)) {
          continue;
        }

        const category = classifyCategory(`${title} ${content}`);
        if (!category) continue;

        const loc = extractLocation(`${title} ${content}`);
        const time = item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString();

        reports.push({
          id: `rss-${Buffer.from(item.link || title).toString('hex').slice(0, 16)}`,
          clusterId: `cluster-rss-${Buffer.from(title).toString('hex').slice(0, 16)}`,
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
