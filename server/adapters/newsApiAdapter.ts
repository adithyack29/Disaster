import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier';
import { hashId } from '../hashId';

export async function fetchNewsAPIReports(): Promise<DisasterReport[]> {
  const apiKey = process.env.NEWSAPI_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return [];
  }

  try {
    const query = encodeURIComponent('(flood OR landslide OR cyclone OR rain OR earthquake OR collapse OR fire OR rescue OR inundation) India');
    const url = `https://newsapi.org/v2/everything?q=${query}&sortBy=publishedAt&pageSize=30&apiKey=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const articles = data.articles || [];
    const reports: DisasterReport[] = [];

    for (const art of articles) {
      if (!art.title || art.title.includes('[Removed]')) continue;

      const title = art.title;
      const desc = art.description || title;
      const fullText = title + ' ' + desc;

      const category = classifyCategory(fullText) || 'flood';
      const loc = extractLocation(fullText);
      const time = art.publishedAt ? new Date(art.publishedAt).toISOString() : new Date().toISOString();
      const sourceName = art.source?.name || 'NewsAPI Source';

      reports.push({
        id: `newsapi-${hashId(art.url || title)}`,
        clusterId: `cluster-newsapi-${hashId(title)}`,
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
        imageUrl: art.urlToImage || undefined,
      });
    }

    return reports;
  } catch (error) {
    console.error('[newsApiAdapter] Error fetching NewsAPI.org data:', error);
    return [];
  }
}
