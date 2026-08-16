import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';
import { hashId } from '../hashId.js';

export async function fetchNewsAPIReports(): Promise<DisasterReport[]> {
  // Checks both naming conventions — this project's Vercel env vars use VITE_NEWS_API_KEY
  // (confirmed via the project's Environment Variables screen), not NEWSAPI_KEY, the same
  // mismatch pattern found for Gemini/Redis (see CLAUDE.md Investigation Log 2026-08-16).
  const apiKey = process.env.NEWSAPI_KEY || process.env.VITE_NEWS_API_KEY;
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
