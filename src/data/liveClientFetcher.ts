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
 * Live Client Telemetry Fetcher: last-resort direct-from-browser fetch, used only when the
 * backend (/api/reports — see src/data/mockApi.ts) is genuinely unreachable. Deliberately
 * limited to sources that are CORS-open and need no API key (USGS, NASA EONET) plus GNews when
 * the user has configured a real VITE_GNEWS_KEY — no hardcoded fallback key ships in the bundle,
 * and no third-party CORS proxy is used (see CLAUDE.md Known Gotchas for why that used to bite).
 */
export async function fetchLiveClientTelemetry(): Promise<DisasterReport[]> {
  console.log('[Live Client Telemetry] 🌐 Backend unreachable — fetching fallback telemetry directly...');

  const results: DisasterReport[] = [];

  // Run all fetches concurrently; each has its own timeout guard
  const settled = await Promise.allSettled([
    fetchUSGSClient(),
    fetchEONETClient(),
    fetchGNewsClient(),
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

      // South Asia bounding box: lat 5-38, lng 65-98. No magnitude bypass — this fetcher only
      // runs as a fallback when the real backend is unreachable, so a large-but-irrelevant
      // global quake (e.g. Indonesia) must never slip through just because it's big; it isn't
      // an India disaster. See CLAUDE.md Investigation Log for the demo where this was caught.
      const isSouthAsia = lat >= 5 && lat <= 38 && lng >= 65 && lng <= 98;
      if (!isSouthAsia) continue;

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
      const description = `NASA EONET detected active event: "${title}". Category: ${categories[0]?.title || 'Natural Disaster'}.`;

      // EONET is a global satellite feed — most events are NOT in India (see CLAUDE.md
      // Investigation Log: a Colorado wildfire and an Indonesian quake both slipped through
      // here before this filter was added). Same relevance gate the server-side adapters use.
      if (!isStrictIndiaDisaster(title, description)) continue;

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
        description,
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
  // Client-only var; never fall back to a literal key here — anything in this file ships
  // in the public bundle, so a hardcoded key is a public key (see CLAUDE.md Known Gotchas).
  const apiKey = getEnvVar('VITE_GNEWS_KEY');
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

