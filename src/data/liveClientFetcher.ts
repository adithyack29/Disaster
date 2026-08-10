import type { DisasterReport } from '../types/incident';
import { 
  isStrictIndiaDisaster, 
  classifyCategory, 
  inferSeverity, 
  extractLocation, 
  calculateCredibility, 
  cleanText 
} from '../../server/classifier';

/**
 * Live Client Telemetry Fetcher: Fetches real-time open-source disaster & news feeds
 * directly in the browser when backend Express server is unreachable (e.g. Vercel deployment)
 */
export async function fetchLiveClientTelemetry(): Promise<DisasterReport[]> {
  console.log('[Live Client Telemetry] 🌐 Fetching live real-time disaster dispatches directly in browser...');

  const results: DisasterReport[] = [];

  // Concurrently fetch USGS, NASA EONET, UN ReliefWeb, NewsAPI/GNews (if keys present) & Live RSS Feeds
  const [usgsReports, eonetReports, reliefWebReports, rssReports, gnewsReports] = await Promise.all([
    fetchUSGSClient(),
    fetchEONETClient(),
    fetchReliefWebClient(),
    fetchRSSClient(),
    fetchGNewsClient(),
  ]);

  results.push(...usgsReports, ...eonetReports, ...reliefWebReports, ...rssReports, ...gnewsReports);

  console.log(`[Live Client Telemetry] 📥 Ingested ${results.length} live real-time dispatches from open APIs.`);
  return results;
}

/**
 * 1. USGS Seismograph Telemetry (Native Browser CORS)
 */
async function fetchUSGSClient(): Promise<DisasterReport[]> {
  try {
    const res = await fetch('https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=60');
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

      const isSouthAsia = lat >= 5 && lat <= 38 && lng >= 65 && lng <= 98;
      if (!isSouthAsia && mag < 4.5) continue;

      const loc = extractLocation(place);
      const state = isSouthAsia ? (loc.state || 'India') : 'Global Alert';
      const severity = mag >= 5.5 ? 'critical' : mag >= 4.0 ? 'high' : 'moderate';

      reports.push({
        id: `usgs-${feat.id}`,
        clusterId: `cluster-usgs-${feat.id}`,
        category: 'earthquake',
        severity,
        location: {
          lat,
          lng,
          placeName: place,
          state,
        },
        headline: `Magnitude ${mag} Earthquake detected near ${place}`,
        description: `Seismograph data recorded magnitude ${mag} earthquake at depth of ${coords[2] || 10}km. Automatic USGS alert generated.`,
        source: {
          type: 'sensor',
          name: 'USGS Seismograph Telemetry',
          verified: true,
        },
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
 * 2. NASA EONET Satellite Tracker (Native Browser CORS)
 */
async function fetchEONETClient(): Promise<DisasterReport[]> {
  try {
    const res = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30');
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
          lat,
          lng,
          placeName: loc.placeName !== 'National Coastline Zone' ? loc.placeName : title,
          state: loc.state,
        },
        headline: title,
        description: `NASA Earth Observatory Natural Event Tracker detected active event "${title}". Category: ${categories[0]?.title || 'Natural Disaster'}.`,
        source: {
          type: 'official',
          name: 'NASA EONET Satellite Tracker',
          verified: true,
        },
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
 * 3. UN ReliefWeb Open API (Native Browser CORS)
 */
async function fetchReliefWebClient(): Promise<DisasterReport[]> {
  try {
    const res = await fetch('https://api.reliefweb.int/v1/reports?appname=ndrf-disaster-portal&limit=25&preset=latest');
    if (!res.ok) return [];

    const data = await res.json();
    const items = data.data || [];
    const reports: DisasterReport[] = [];

    for (const item of items) {
      const title = cleanText(item.fields?.title || '');
      const body = cleanText(item.fields?.body || title);
      const fullText = `${title} ${body}`;

      if (!isStrictIndiaDisaster(title, body)) continue;

      const category = classifyCategory(fullText);
      if (!category) continue;

      const loc = extractLocation(fullText);
      const time = item.fields?.date?.created ? new Date(item.fields.date.created).toISOString() : new Date().toISOString();

      reports.push({
        id: `reliefweb-${item.id}`,
        clusterId: `cluster-rw-${item.id}`,
        category,
        severity: inferSeverity(fullText),
        location: loc,
        headline: title,
        description: body.slice(0, 280),
        source: {
          type: 'official',
          name: 'UN ReliefWeb OCHA',
          verified: true,
          handleOrUrl: item.fields?.url,
        },
        credibilityScore: 97,
        language: 'en',
        timestamp: time,
      });
    }

    return reports;
  } catch (err) {
    console.warn('[Live Client Telemetry] ReliefWeb fetch warning:', err);
    return [];
  }
}

/**
 * 4. GNews Client Fetch (if VITE_GNEWS_KEY present)
 */
async function fetchGNewsClient(): Promise<DisasterReport[]> {
  const apiKey = import.meta.env.VITE_GNEWS_KEY || '1866b0c31d95e5e2e27ba553068a7c46';
  if (!apiKey) return [];

  try {
    const query = encodeURIComponent('(flood OR landslide OR cyclone OR rain OR earthquake OR collapse OR fire OR rescue) India');
    const res = await fetch(`https://gnews.io/api/v4/search?q=${query}&lang=en&country=in&max=15&apikey=${apiKey}`);
    if (!res.ok) return [];

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
        id: `client-gnews-${Math.random().toString(36).substr(2, 9)}`,
        clusterId: `cluster-gnews-${Math.random().toString(36).substr(2, 9)}`,
        category,
        severity: inferSeverity(fullText),
        location: loc,
        headline: title,
        description: desc.slice(0, 280),
        source: {
          type: 'news',
          name: art.source?.name || 'GNews Source',
          verified: true,
          handleOrUrl: art.url,
        },
        credibilityScore: 92,
        language: 'en',
        timestamp: time,
        imageUrl: art.image || undefined,
      });
    }

    return reports;
  } catch (err) {
    console.warn('[Live Client Telemetry] GNews fetch warning:', err);
    return [];
  }
}

/**
 * 5. Live Indian News RSS Feeds via CORS Proxy
 */
async function fetchRSSClient(): Promise<DisasterReport[]> {
  const rssUrls = [
    { url: 'https://www.thehindu.com/news/national/feeder/default.rss', name: 'The Hindu National' },
    { url: 'https://www.thehindu.com/news/states/feeder/default.rss', name: 'The Hindu States' },
    { url: 'https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms', name: 'Times of India India' },
    { url: 'https://timesofindia.indiatimes.com/rssfeeds/2647163.cms', name: 'Times of India Environment' },
    { url: 'https://feeds.feedburner.com/ndtvnews-india-news', name: 'NDTV India' },
    { url: 'https://indianexpress.com/section/india/feed/', name: 'Indian Express' },
  ];

  const reports: DisasterReport[] = [];

  for (const feed of rssUrls) {
    try {
      const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(feed.url)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) continue;

      const xmlText = await res.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
      const items = Array.from(xmlDoc.querySelectorAll('item')).slice(0, 15);

      for (const item of items) {
        const title = cleanText(item.querySelector('title')?.textContent || '');
        const desc = cleanText(item.querySelector('description')?.textContent || title);
        const pubDate = item.querySelector('pubDate')?.textContent;
        const link = item.querySelector('link')?.textContent || undefined;

        if (!isStrictIndiaDisaster(title, desc)) continue;

        const category = classifyCategory(`${title} ${desc}`);
        if (!category) continue;

        const loc = extractLocation(`${title} ${desc}`);
        const time = pubDate ? new Date(pubDate).toISOString() : new Date().toISOString();

        reports.push({
          id: `client-rss-${Math.random().toString(36).substr(2, 9)}`,
          clusterId: `cluster-rss-${Math.random().toString(36).substr(2, 9)}`,
          category,
          severity: inferSeverity(`${title} ${desc}`),
          location: loc,
          headline: title,
          description: desc.slice(0, 280),
          source: {
            type: 'news',
            name: feed.name,
            verified: true,
            handleOrUrl: link,
          },
          credibilityScore: 90,
          language: 'en',
          timestamp: time,
        });
      }
    } catch (err) {
      console.warn(`[Live Client Telemetry] RSS fetch warning for ${feed.name}:`, err);
    }
  }

  return reports;
}
