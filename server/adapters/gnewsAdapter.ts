import type { DisasterReport } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier.js';
import { hashId } from '../hashId.js';

export async function fetchGNewsReports(): Promise<DisasterReport[]> {
  // Checks both naming conventions — this project's Vercel env vars use VITE_GNEWS_API_KEY
  // (confirmed via the project's Environment Variables screen), not GNEWS_KEY, the same
  // mismatch pattern found for Gemini/Redis (see CLAUDE.md Investigation Log 2026-08-16).
  const apiKey = process.env.GNEWS_KEY || process.env.VITE_GNEWS_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return [];
  }

  // See newsApiAdapter.ts for why this list was broadened beyond the original 8 terms.
  const query = encodeURIComponent('(flood OR landslide OR cyclone OR rain OR earthquake OR collapse OR fire OR rescue OR heatwave OR stampede OR cloudburst OR lightning OR "gas leak" OR capsize OR avalanche) India');
  const url = `https://gnews.io/api/v4/search?q=${query}&lang=en&country=in&max=20&apikey=${apiKey}`;
  const response = await fetch(url);
  if (!response.ok) {
    // Throw (rather than silently return []) so aggregate.ts's per-source diagnostics can
    // distinguish "GNews returned 0 real matches" from "our request is failing" (e.g. an
    // invalid/expired key returns 403/401 here) — see CLAUDE.md Investigation Log 2026-08-16,
    // ninth entry. aggregate.ts's Promise.allSettled already treats a rejected source safely
    // (0 reports contributed, no blank dashboard), so this is a pure diagnostics improvement.
    const body = await response.text().catch(() => '');
    throw new Error(`GNews request failed: ${response.status} ${response.statusText} — ${body.slice(0, 200)}`);
  }

  try {
    const data = await response.json();
    const articles = data.articles || [];
    const reports: DisasterReport[] = [];

    for (const art of articles) {
      if (!art.title) continue;

      const title = art.title;
      const desc = art.description || title;
      const fullText = title + ' ' + desc;

      // Skip rather than default to 'flood' — see gdacsAdapter.ts for why forcing a category
      // classifyCategory couldn't determine is incorrect even though aggregate.ts's downstream
      // isStrictIndiaDisaster() re-check currently masks its effect on what users see.
      const category = classifyCategory(fullText);
      if (!category) continue;

      const loc = extractLocation(fullText);
      const time = art.publishedAt ? new Date(art.publishedAt).toISOString() : new Date().toISOString();
      const sourceName = art.source?.name || 'GNews Source';

      reports.push({
        id: `gnews-${hashId(art.url || title)}`,
        clusterId: `cluster-gnews-${hashId(title)}`,
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
