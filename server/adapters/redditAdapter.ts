import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';

export async function fetchRedditReports(): Promise<DisasterReport[]> {
  try {
    const headers: Record<string, string> = {
      'User-Agent': process.env.REDDIT_USER_AGENT || 'ndrf-disaster-aggregator:v1.0 (by /u/ndrf)',
    };

    // Public Reddit JSON Search fallback if OAuth keys aren't set
    const url = 'https://www.reddit.com/r/india/search.json?q=flood+OR+earthquake+OR+cyclone+OR+fire+OR+landslide&restrict_sr=1&sort=new&limit=25';

    const response = await fetch(url, { headers });
    if (!response.ok) return [];

    const data = await response.json();
    const children = data.data?.children || [];
    const reports: DisasterReport[] = [];

    for (const child of children) {
      const post = child.data;
      if (!post || !post.title) continue;

      const title = post.title;
      const selftext = post.selftext || title;
      const fullText = title + ' ' + selftext;

      const category = classifyCategory(fullText);
      if (!category) continue;

      const loc = extractLocation(fullText);
      const time = post.created_utc ? new Date(post.created_utc * 1000).toISOString() : new Date().toISOString();
      const author = post.author ? `/u/${post.author}` : 'Reddit User';

      reports.push({
        id: `reddit-${post.id}`,
        clusterId: `cluster-reddit-${post.id}`,
        category,
        severity: inferSeverity(fullText),
        location: loc,
        headline: title,
        description: selftext.length > 10 ? selftext.slice(0, 260) : title,
        source: {
          type: 'social',
          name: `Reddit (${author})`,
          verified: false,
          handleOrUrl: `https://reddit.com${post.permalink}`,
        },
        credibilityScore: calculateCredibility({ type: 'social', name: author, verified: false }),
        language: 'en',
        timestamp: time,
      });
    }

    return reports;
  } catch (error) {
    console.error('[redditAdapter] Error fetching Reddit reports:', error);
    return [];
  }
}
