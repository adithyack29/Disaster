import type { DisasterReport } from '../../src/types/incident';
import { calculateCredibility, inferSeverity, extractLocation, classifyCategory } from '../classifier';

export async function fetchReliefWebReports(): Promise<DisasterReport[]> {
  try {
    const response = await fetch(
      'https://api.reliefweb.int/v1/reports?appname=ndrf-disaster&limit=30&preset=latest'
    );
    if (!response.ok) return [];

    const data = await response.json();
    const items = data.data || [];

    const reports: DisasterReport[] = [];

    for (const item of items) {
      const title = item.fields?.title || 'ReliefWeb Update';
      const body = item.fields?.body || title;
      const date = item.fields?.date?.created
        ? new Date(item.fields.date.created).toISOString()
        : new Date().toISOString();

      const category = classifyCategory(title + ' ' + body) || 'flood';
      const loc = extractLocation(title + ' ' + body);

      reports.push({
        id: `reliefweb-${item.id}`,
        clusterId: `cluster-reliefweb-${item.id}`,
        category,
        severity: inferSeverity(title),
        location: loc,
        headline: `UN ReliefWeb: ${title}`,
        description: body.slice(0, 280),
        source: {
          type: 'official',
          name: 'UN OCHA ReliefWeb',
          verified: true,
        },
        credibilityScore: calculateCredibility({ type: 'official', name: 'ReliefWeb', verified: true }),
        language: 'en',
        timestamp: date,
      });
    }

    return reports;
  } catch (error) {
    console.error('[reliefwebAdapter] Error fetching ReliefWeb reports:', error);
    return [];
  }
}
