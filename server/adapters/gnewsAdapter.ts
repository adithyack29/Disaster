import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier';

export async function fetchGNewsReports(): Promise<DisasterReport[]> {
  const apiKey = process.env.GNEWS_KEY;
  if (!apiKey || apiKey.trim() === '') {
    // Graceful fallback if key not configured
    return [];
  }

  try {
    const url = `https://gnews.io/api/v4/search?q=disaster+India&lang=en&country=in&max=15&apikey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const articles = data.articles || [];
    const reports: DisasterReport[] = [];

    for (const art of articles) {
      if (!art.title) continue;

      const title = art.title;
      const desc = art.description || title;
      const fullText = title + ' ' + desc;

      const category = classifyCategory(fullText) || 'flood';
      const loc = extractLocation(fullText);
      const time = art.publishedAt ? new Date(art.publishedAt).toISOString() : new Date().toISOString();
      const sourceName = art.source?.name || 'GNews Source';

      reports.push({
        id: `gnews-${Buffer.from(art.url || title).toString('hex').slice(0, 16)}`,
        clusterId: `cluster-gnews-${Buffer.from(title).toString('hex').slice(0, 16)}`,
        category,
        severity: inferSeverity(fullText),
        location: loc,
        headline: title,
        description: desc.slice(0, 280),
        source: {
          type: 'news',
          name: sourceName,
          verified: true,
          handleOrUrl: art.url,
        },
        credibilityScore: calculateCredibility({ type: 'news', name: sourceName, verified: true }),
        language: 'en',
        timestamp: time,
        imageUrl: art.image || undefined,
      });
    }

    return reports;
  } catch (error) {
    console.error('[gnewsAdapter] Error fetching GNews.io data:', error);
    return [];
  }
}
