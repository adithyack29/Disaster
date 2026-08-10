import type { DisasterReport } from '../types/incident';
import { 
  isStrictIndiaDisaster, 
  classifyCategory, 
  inferSeverity, 
  extractLocation, 
  calculateCredibility, 
  cleanText 
} from '../../server/classifier';

const getEnvVar = (key: string): string => {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key]) {
      return (import.meta as any).env[key];
    }
  } catch {}
  try {
    const proc = (globalThis as any).process;
    if (proc && proc.env && proc.env[key]) {
      return proc.env[key];
    }
  } catch {}
  return '';
};

const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
};

/**
 * Live Client Telemetry Fetcher: Fetches real-time open-source disaster & news feeds
 * directly in the browser when backend Express server is unreachable (e.g. Vercel deployment)
 */
export async function fetchLiveClientTelemetry(): Promise<DisasterReport[]> {
  console.log('[Live Client Telemetry] 🌐 Fetching live real-time disaster dispatches...');

  const results: DisasterReport[] = [];

  // Run all fetches concurrently; each has its own timeout guard
  const settled = await Promise.allSettled([
    fetchUSGSClient(),
    fetchEONETClient(),
    fetchGNewsClient(),
    fetchRSSClient(),
  ]);

  for (const s of settled) {
    if (s.status === 'fulfilled') {
      results.push(...s.value);
    }
  }

  // Sort by newest timestamp
  results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  console.log(`[Live Client Telemetry] 📥 Ingested ${results.length} live real-time dispatches.`);
  return results;
}

/**
 * 1. USGS Seismograph Telemetry – CORS-accessible
 */
async function fetchUSGSClient(): Promise<DisasterReport[]> {
  try {
    const res = await fetchWithTimeout(
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=60',
      {},
      8000
    );
    if (!res.ok) return [];

    const data = await res.json();
    const features = data.features || [];
    const reports: DisasterReport[] = [];

    for (const feat of features) {
      const coords = feat.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      const lng = coords[0];
      const lat = coords[1];
      const place = feat.properties?.place || 'India';
      const mag = feat.properties?.mag || 0;
      const time = feat.properties?.time ? new Date(feat.properties.time).toISOString() : new Date().toISOString();

      // South Asia bounding box: lat 5-38, lng 65-98
      const isSouthAsia = lat >= 5 && lat <= 38 && lng >= 65 && lng <= 98;
      if (!isSouthAsia && mag < 4.5) continue;

      const loc = extractLocation(place);
      const state = loc.state !== 'Madhya Pradesh' ? loc.state : 'India';
      const severity = mag >= 5.5 ? 'critical' : mag >= 4.0 ? 'high' : 'moderate';

      reports.push({
        id: `usgs-${feat.id}`,
        clusterId: `cluster-usgs-${feat.id}`,
        category: 'earthquake',
        severity,
        location: { lat, lng, placeName: place, state },
        headline: `Magnitude ${mag} Earthquake detected near ${place}`,
        description: `Seismograph data recorded magnitude ${mag} earthquake at depth of ${coords[2] || 10}km.`,
        source: { type: 'sensor', name: 'USGS Seismograph Telemetry', verified: true },
        credibilityScore: calculateCredibility({ type: 'sensor', name: 'USGS', verified: true }),
        language: 'en',
        timestamp: time,
        affectedPopulationEstimate: Math.round(mag * 2500),
      });
    }

    return reports;
  } catch (err) {
    console.warn('[Live Client Telemetry] USGS fetch warning:', err);
    return [];
  }
}

/**
 * 2. NASA EONET Satellite Tracker – CORS-accessible
 */
async function fetchEONETClient(): Promise<DisasterReport[]> {
  try {
    const res = await fetchWithTimeout('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30', {}, 8000);
    if (!res.ok) return [];

    const data = await res.json();
    const events = data.events || [];
    const reports: DisasterReport[] = [];

    for (const ev of events) {
      const title = cleanText(ev.title || 'Natural Event');
      const categories = ev.categories || [];
      const catTitle = categories[0]?.title?.toLowerCase() || '';

      let category = classifyCategory(title) || 'cyclone';
      if (catTitle.includes('fire')) category = 'fire';
      else if (catTitle.includes('flood') || catTitle.includes('water')) category = 'flood';
      else if (catTitle.includes('storm') || catTitle.includes('cyclone')) category = 'cyclone';
      else if (catTitle.includes('landslide')) category = 'landslide';

      const geometry = ev.geometry || [];
      const lastGeo = geometry[geometry.length - 1];
      const coords = lastGeo?.coordinates;

      let lat = 20.5937;
      let lng = 78.9629;
      if (coords && Array.isArray(coords) && coords.length >= 2) {
        lng = coords[0];
        lat = coords[1];
      }

      const loc = extractLocation(title);
      const time = lastGeo?.date ? new Date(lastGeo.date).toISOString() : new Date().toISOString();

      reports.push({
        id: `nasa-eonet-${ev.id}`,
        clusterId: `cluster-eonet-${ev.id}`,
        category,
        severity: inferSeverity(title),
        location: {
          lat, lng,
          placeName: loc.placeName !== 'Central Command Zone' ? loc.placeName : title,
          state: loc.state,
        },
        headline: title,
        description: `NASA EONET detected active event: "${title}". Category: ${categories[0]?.title || 'Natural Disaster'}.`,
        source: { type: 'official', name: 'NASA EONET Satellite Tracker', verified: true },
        credibilityScore: calculateCredibility({ type: 'official', name: 'NASA', verified: true }),
        language: 'en',
        timestamp: time,
      });
    }

    return reports;
  } catch (err) {
    console.warn('[Live Client Telemetry] NASA EONET fetch warning:', err);
    return [];
  }
}

/**
 * 3. GNews API – live Indian disaster news
 */
async function fetchGNewsClient(): Promise<DisasterReport[]> {
  const apiKey = getEnvVar('VITE_GNEWS_KEY') || getEnvVar('GNEWS_KEY') || '1866b0c31d95e5e2e27ba553068a7c46';
  if (!apiKey) return [];

  try {
    const query = encodeURIComponent('(flood OR landslide OR cyclone OR earthquake OR collapse OR fire OR rescue) India');
    const res = await fetchWithTimeout(
      `https://gnews.io/api/v4/search?q=${query}&lang=en&country=in&max=20&apikey=${apiKey}`,
      {},
      8000
    );
    if (!res.ok) {
      console.warn('[Live Client Telemetry] GNews response not OK:', res.status);
      return [];
    }

    const data = await res.json();
    const articles = data.articles || [];
    const reports: DisasterReport[] = [];

    for (const art of articles) {
      if (!art.title) continue;

      const title = cleanText(art.title);
      const desc = cleanText(art.description || title);
      const fullText = `${title} ${desc}`;

      if (!isStrictIndiaDisaster(title, desc)) continue;

      const category = classifyCategory(fullText) || 'flood';
      const loc = extractLocation(fullText);
      const time = art.publishedAt ? new Date(art.publishedAt).toISOString() : new Date().toISOString();

      reports.push({
        id: `gnews-${encodeURIComponent(art.url || title).slice(0, 32)}`,
        clusterId: `cluster-gnews-${encodeURIComponent(title).slice(0, 32)}`,
        category,
        severity: inferSeverity(fullText),
        location: loc,
        headline: title,
        description: desc.slice(0, 280),
        source: {
          type: 'news',
          name: art.source?.name || 'GNews',
          verified: true,
          handleOrUrl: art.url,
        },
        credibilityScore: 92,
        language: 'en',
        timestamp: time,
        imageUrl: art.image || undefined,
      });
    }

    console.log(`[Live Client Telemetry] GNews returned ${reports.length} India disaster articles.`);
    return reports;
  } catch (err) {
    console.warn('[Live Client Telemetry] GNews fetch warning:', err);
    return [];
  }
}

/**
 * 4. Live Indian News RSS Feeds via allorigins CORS proxy
 */
async function fetchRSSClient(): Promise<DisasterReport[]> {
  const rssUrls = [
    { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu National' },
    { url: 'https://www.thehindu.com/news/states/feeder/default.rss', name: 'The Hindu States' },
    { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', name: 'Times of India' },
    { url: 'https://feeds.feedburner.com/ndtvnews-india-news', name: 'NDTV India' },
  ];

  const reports: DisasterReport[] = [];

  // Use Promise.allSettled so one slow feed doesn't block others
  const feedResults = await Promise.allSettled(
    rssUrls.map(async (feed) => {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feed.url)}`;
      const res = await fetchWithTimeout(proxyUrl, {}, 8000);
      if (!res.ok) return [];

      const xmlText = await res.text();
      const items: DisasterReport[] = [];

      // Regex-based XML parsing (no DOMParser dependency)
      const itemMatches = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];

      for (const itemXml of itemMatches.slice(0, 20)) {
        const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
        const pubDateMatch = itemXml.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const linkMatch = itemXml.match(/<link>([\s\S]*?)<\/link>/i);

        const title = cleanText(titleMatch ? titleMatch[1] : '');
        const desc = cleanText(descMatch ? descMatch[1] : title);
        const pubDate = pubDateMatch ? pubDateMatch[1].trim() : undefined;
        const link = linkMatch ? linkMatch[1].trim() : undefined;

        if (!title || !isStrictIndiaDisaster(title, desc)) continue;

        const category = classifyCategory(`${title} ${desc}`);
        if (!category) continue;

        const loc = extractLocation(`${title} ${desc}`);
        const time = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

        items.push({
          id: `client-rss-${encodeURIComponent(link || title).slice(0, 32)}`,
          clusterId: `cluster-rss-${encodeURIComponent(title).slice(0, 32)}`,
          category,
          severity: inferSeverity(`${title} ${desc}`),
          location: loc,
          headline: title,
          description: desc.slice(0, 280),
          source: { type: 'news', name: feed.name, verified: true, handleOrUrl: link },
          credibilityScore: 90,
          language: 'en',
          timestamp: time,
        });
      }

      console.log(`[Live Client Telemetry] ${feed.name}: ${items.length} India disaster articles.`);
      return items;
    })
  );

  for (const result of feedResults) {
    if (result.status === 'fulfilled') {
      reports.push(...result.value);
    }
  }

  return reports;
}
