import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';

const TAGS = ['disaster', 'flood', 'earthquake', 'cyclone', 'landslide'];

// Previously picked one random tag per pipeline run and fetched only that timeline — over
// repeated runs it eventually samples every tag, but any single pass was leaving 4/5 of this
// source's available posts completely unfetched for no reason (no rate-limit constraint forced
// this; mastodon.social's anonymous API comfortably allows 5 concurrent timeline fetches). Now
// fetches every tag's timeline concurrently, same Promise.allSettled pattern as
// aggregate.ts/rssAdapter.ts, so one source failing/timing out doesn't drop the rest.
export async function fetchMastodonReports(): Promise<DisasterReport[]> {
  const results = await Promise.allSettled(TAGS.map((tag) => fetchOneTag(tag)));
  const reports: DisasterReport[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      reports.push(...result.value);
    } else {
      console.warn(`[mastodonAdapter] Could not fetch #${TAGS[i]} timeline:`, result.reason);
    }
  });
  return reports;
}

async function fetchOneTag(tag: string): Promise<DisasterReport[]> {
  const response = await fetch(`https://mastodon.social/api/v1/timelines/tag/${tag}?limit=20`);
  if (!response.ok) return [];

  const posts = await response.json();
  const reports: DisasterReport[] = [];

  for (const post of posts) {
    // Strip HTML tags from Mastodon post content
    const rawContent = (post.content || '').replace(/<[^>]*>?/gm, '');
    if (rawContent.trim().length < 15) continue;

    const category = classifyCategory(rawContent) || (tag as any) || 'flood';
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
}
