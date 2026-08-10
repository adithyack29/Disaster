import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity } from '../classifier';

export async function fetchUSGSReports(): Promise<DisasterReport[]> {
  try {
    const response = await fetch(
      'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&minmagnitude=2.5&limit=60'
    );
    if (!response.ok) return [];

    const data = await response.json();
    const features = data.features || [];

    const reports: DisasterReport[] = [];

    for (const feat of features) {
      const coords = feat.geometry?.coordinates; // [lng, lat, depth]
      if (!coords || coords.length < 2) continue;

      const lng = coords[0];
      const lat = coords[1];
      const place = feat.properties?.place || 'Unknown Region';
      const mag = feat.properties?.mag || 0;
      const time = feat.properties?.time ? new Date(feat.properties.time).toISOString() : new Date().toISOString();

      // Filter for South Asia & Indian Region (Lat 5..38, Lng 65..98) or major events (mag > 4.5)
      const isSouthAsia = lat >= 5 && lat <= 38 && lng >= 65 && lng <= 98;
      if (!isSouthAsia && mag < 4.5) continue;

      const state = isSouthAsia ? (place.split(',').pop()?.trim() || 'India') : 'Global Alert';
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
        headline: `Magnitude ${mag} Earthquake near ${place}`,
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
  } catch (error) {
    console.error('[usgsAdapter] Error fetching USGS data:', error);
    return [];
  }
}
