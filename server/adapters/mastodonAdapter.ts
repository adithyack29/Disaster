import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';

export async function fetchMastodonReports(): Promise<DisasterReport[]> {
  try {
    const tags = ['disaster', 'flood', 'earthquake', 'cyclone', 'landslide'];
    const selectedTag = tags[Math.floor(Math.random() * tags.length)];

    const response = await fetch(`https://mastodon.social/api/v1/timelines/tag/${selectedTag}?limit=20`);
    if (!response.ok) return [];

    const posts = await response.json();
    const reports: DisasterReport[] = [];

    for (const post of posts) {
      // Strip HTML tags from Mastodon post content
      const rawContent = (post.content || '').replace(/<[^>]*>?/gm, '');
      if (rawContent.trim().length < 15) continue;

      const category = classifyCategory(rawContent) || (selectedTag as any) || 'flood';
      const loc = extractLocation(rawContent);
      const time = post.created_at ? new Date(post.created_at).toISOString() : new Date().toISOString();
      const accountName = post.account?.username ? `@${post.account.username}` : 'Mastodon User';

      reports.push({
        id: `mastodon-${post.id}`,
        clusterId: `cluster-mastodon-${post.id}`,
        category,
        severity: inferSeverity(rawContent),
        location: loc,
        headline: rawContent.slice(0, 110),
        description: rawContent.slice(0, 260),
        source: {
          type: 'social',
          name: `Mastodon (${accountName})`,
          verified: false,
          handleOrUrl: post.url,
        },
        credibilityScore: calculateCredibility({ type: 'social', name: accountName, verified: false }),
        language: 'en',
        timestamp: time,
      });
    }

    return reports;
  } catch (error) {
    console.error('[mastodonAdapter] Error fetching Mastodon posts:', error);
    return [];
  }
}
