import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier';

export async function fetchBlueskyReports(): Promise<DisasterReport[]> {
  try {
    const response = await fetch(
      'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=disaster%20OR%20flood%20OR%20earthquake%20OR%20cyclone&limit=25'
    );
    if (!response.ok) return [];

    const data = await response.json();
    const posts = data.posts || [];
    const reports: DisasterReport[] = [];

    for (const post of posts) {
      const text = post.record?.text || '';
      if (!text || text.length < 15) continue;

      const category = classifyCategory(text) || 'flood';
      const loc = extractLocation(text);
      const handle = post.author?.handle ? `@${post.author.handle}` : 'Bluesky User';
      const time = post.indexedAt ? new Date(post.indexedAt).toISOString() : new Date().toISOString();

      reports.push({
        id: `bsky-${post.cid || Math.random()}`,
        clusterId: `cluster-bsky-${post.cid || Math.random()}`,
        category,
        severity: inferSeverity(text),
        location: loc,
        headline: text.slice(0, 110),
        description: text.slice(0, 260),
        source: {
          type: 'social',
          name: `Bluesky (${handle})`,
          verified: false,
        },
        credibilityScore: calculateCredibility({ type: 'social', name: handle, verified: false }),
        language: 'en',
        timestamp: time,
      });
    }

    return reports;
  } catch (error) {
    console.error('[blueskyAdapter] Error fetching Bluesky posts:', error);
    return [];
  }
}
