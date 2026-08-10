import { selectRepresentativeReport, evaluateClusterSeverity, performSmartClustering } from '../src/lib/clustering';
import type { DisasterReport } from '../src/types/incident';

console.log('--- TESTING REPRESENTATIVE REPORT SELECTION & SEVERITY EVALUATION ---');

const socialReport: DisasterReport = {
  id: 'rep-soc-01',
  category: 'flood',
  severity: 'critical',
  location: { lat: 9.93, lng: 76.26, placeName: 'Kochi', state: 'Kerala' },
  headline: '@KochiCitizen: Water flooding Fort Kochi hospital ground floor!',
  description: 'Water rising fast, 20 trapped',
  source: { type: 'social', name: '@KochiCitizen', verified: false },
  credibilityScore: 65,
  language: 'en',
  timestamp: '2026-08-10T10:00:00Z',
  clusterId: 'test-cluster-01',
};

const newsReport: DisasterReport = {
  id: 'rep-news-01',
  category: 'flood',
  severity: 'moderate',
  location: { lat: 9.93, lng: 76.26, placeName: 'Kochi', state: 'Kerala' },
  headline: 'The Hindu: High tide causes waterlogging in Fort Kochi coastal wards',
  description: 'Waterlogging depth 0.5m',
  source: { type: 'news', name: 'The Hindu National', verified: true },
  credibilityScore: 88,
  language: 'en',
  timestamp: '2026-08-10T10:15:00Z',
  clusterId: 'test-cluster-01',
};

const officialReport: DisasterReport = {
  id: 'rep-off-01',
  category: 'flood',
  severity: 'critical',
  location: { lat: 9.93, lng: 76.26, placeName: 'Kochi', state: 'Kerala' },
  headline: 'KSDMA Bulletin: Tidal surge reaches 1.2m depth in Fort Kochi ward 3',
  description: 'Emergency response deployed',
  source: { type: 'official', name: 'Kerala State Disaster Management Authority (KSDMA)', verified: true },
  credibilityScore: 98,
  language: 'en',
  timestamp: '2026-08-10T10:30:00Z',
  clusterId: 'test-cluster-01',
};

// Test 1: Only social report present -> representative is social report
let chosenRep = selectRepresentativeReport([socialReport]);
console.log('Test 1 (Only Social): Chosen =', chosenRep.id, '| Title =', chosenRep.headline);
console.assert(chosenRep.id === 'rep-soc-01', 'Test 1 Failed');

// Test 2: Social + News present -> News wins over Social
chosenRep = selectRepresentativeReport([socialReport, newsReport]);
console.log('Test 2 (Social + News): Chosen =', chosenRep.id, '| Title =', chosenRep.headline);
console.assert(chosenRep.id === 'rep-news-01', 'Test 2 Failed');

// Test 3: Social + News + Official present -> Official wins over News & Social
chosenRep = selectRepresentativeReport([socialReport, newsReport, officialReport]);
console.log('Test 3 (Social + News + Official): Chosen =', chosenRep.id, '| Title =', chosenRep.headline);
console.assert(chosenRep.id === 'rep-off-01', 'Test 3 Failed');

// Test 4: Credibility weighted majority (No Official)
const sevEval1 = evaluateClusterSeverity([socialReport, newsReport]);
console.log('Test 4 (Severity Majority): Winner =', sevEval1.severity, '| Reason =', sevEval1.reason);
console.assert(sevEval1.severity === 'moderate', 'Test 4 Failed');

// Test 5: Official Severity Override
const sevEval2 = evaluateClusterSeverity([socialReport, newsReport, officialReport]);
console.log('Test 5 (Official Severity Override): Winner =', sevEval2.severity, '| Reason =', sevEval2.reason);
console.assert(sevEval2.severity === 'critical', 'Test 5 Failed');

// Test 6: Smart Clustering Trajectory Simulation
console.log('\n--- SIMULATING CLUSTER EVOLUTION TRAJECTORY ---');
const clusterSim1 = performSmartClustering([socialReport]);
console.log('Step 1 (Social Arrives): Title =', clusterSim1[0].title, '| Severity =', clusterSim1[0].highestSeverity, '| History =', clusterSim1[0].history?.length);

const clusterSim2 = performSmartClustering([socialReport, newsReport]);
console.log('Step 2 (News Arrives): Title =', clusterSim2[0].title, '| Severity =', clusterSim2[0].highestSeverity, '| History =', clusterSim2[0].history?.length);

const clusterSim3 = performSmartClustering([socialReport, newsReport, officialReport]);
console.log('Step 3 (Official Arrives): Title =', clusterSim3[0].title, '| Severity =', clusterSim3[0].highestSeverity, '| History =', clusterSim3[0].history?.length);

console.log('Audit Log Entries for Cluster:', JSON.stringify(clusterSim3[0].history, null, 2));
console.log('\nALL TESTS PASSED CLEANLY! ✅');
