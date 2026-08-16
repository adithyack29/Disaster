import Parser from 'rss-parser';
import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory, isStrictIndiaDisaster, cleanText } from '../classifier.js';
import { hashId } from '../hashId.js';

const parser = new Parser({
  timeout: 6000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  },
});

// Comprehensive list of reliable public Indian disaster & news RSS feeds. Each URL was verified
// live end-to-end (actually fetched and parsed through rss-parser, not just curled — a curl
// with a browser User-Agent can succeed while rss-parser's Node HTTP client still gets blocked
// by TLS-fingerprint-based bot detection, which is exactly what happened with Zee News and DNA
// India below) before being added — see CLAUDE.md Investigation Log 2026-08-16, ninth entry.
// Candidates that 403'd, 404'd, or redirected to a non-feed page (oneindia.com,
// deccanherald.com, aninews.in, livehindustan.com, theprint.in, zeenews.india.com,
// dnaindia.com) were deliberately left out rather than added speculatively.
const RSS_FEEDS = [
  { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu National' },
  { url: 'https://www.thehindu.com/news/states/feeder/default.rss', name: 'The Hindu States' },
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', name: 'Times of India India' },
  { url: 'https://timesofindia.indiatimes.com/rssfeeds/2647163.cms', name: 'Times of India Environment' },
  { url: 'https://feeds.feedburner.com/ndtvnews-india-news', name: 'NDTV India' },
  { url: 'https://feeds.feedburner.com/ndtvnews-latest', name: 'NDTV Latest' },
  { url: 'https://indianexpress.com/section/india/feed/', name: 'Indian Express' },
  { url: 'https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml', name: 'Hindustan Times India' },
  { url: 'https://www.news18.com/commonfeeds/v1/eng/rss/india.xml', name: 'News18 India' },
  { url: 'https://www.indiatoday.in/rss/1206578', name: 'India Today India' },
  { url: 'https://www.freepressjournal.in/stories.rss', name: 'Free Press Journal' },
];

export async function fetchRSSReports(): Promise<DisasterReport[]> {
  const feedResults = await Promise.allSettled(RSS_FEEDS.map((feedConfig) => fetchOneFeed(feedConfig)));

  const reports: DisasterReport[] = [];
  feedResults.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      reports.push(...result.value);
    } else {
      console.warn(`[rssAdapter] Could not parse RSS feed ${RSS_FEEDS[i].url}:`, result.reason);
    }
  });

  return reports;
}

async function fetchOneFeed(feedConfig: { url: string; name: string }): Promise<DisasterReport[]> {
  const reports: DisasterReport[] = [];
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
      id: `rss-${hashId(item.link || title)}`,
      clusterId: `cluster-rss-${hashId(title)}`,
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

  return reports;
}
