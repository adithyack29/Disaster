import type { DisasterReport, CategoryType } from '../../src/types/incident.js';
import { calculateCredibility, inferSeverity, extractLocation } from '../classifier.js';

export async function fetchEONETReports(): Promise<DisasterReport[]> {
  try {
    const response = await fetch('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30');
    if (!response.ok) return [];

    const data = await response.json();
    const events = data.events || [];

    const reports: DisasterReport[] = [];

    for (const ev of events) {
      const title = ev.title || 'Natural Event';
      const categories = ev.categories || [];
      const catTitle = categories[0]?.title?.toLowerCase() || '';
      
      let category: CategoryType = 'cyclone';
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
        // EONET stores [lng, lat]
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
  } catch (error) {
    console.error('[eonetAdapter] Error fetching NASA EONET data:', error);
    return [];
  }
}
