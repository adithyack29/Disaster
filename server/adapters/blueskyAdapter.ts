import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';
import { hashId } from '../hashId.js';

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

      // Skip rather than default to 'flood' — see gdacsAdapter.ts for why forcing a category
      // classifyCategory couldn't determine is incorrect even though aggregate.ts's downstream
      // isStrictIndiaDisaster() re-check currently masks its effect on what users see.
      const category = classifyCategory(text);
      if (!category) continue;

      const loc = extractLocation(text);
      const handle = post.author?.handle ? `@${post.author.handle}` : 'Bluesky User';
      const time = post.indexedAt ? new Date(post.indexedAt).toISOString() : new Date().toISOString();
      const stableId = post.cid || `${handle}-${text.slice(0, 60)}`;

      reports.push({
        id: `bsky-${hashId(stableId)}`,
        clusterId: `cluster-bsky-${hashId(stableId)}`,
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
