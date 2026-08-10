import Database from 'better-sqlite3';
import path from 'path';
import type { DisasterReport, IncidentCluster } from '../src/types/incident';

const DB_PATH = path.join(process.cwd(), 'server', 'disaster.db');

export const db = new Database(DB_PATH);

// Enable WAL mode for high performance concurrent SQLite reads/writes
db.pragma('journal_mode = WAL');

// Initialize database tables
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    severity TEXT NOT NULL,
    placeName TEXT NOT NULL,
    district TEXT,
    state TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    headline TEXT NOT NULL,
    description TEXT NOT NULL,
    sourceType TEXT NOT NULL,
    sourceName TEXT NOT NULL,
    sourceVerified INTEGER NOT NULL,
    credibilityScore INTEGER NOT NULL,
    language TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    clusterId TEXT NOT NULL,
    affectedPopulationEstimate INTEGER,
    casualtyEstimate INTEGER,
    actionRequired TEXT,
    imageUrl TEXT,
    classificationMethod TEXT
  );

  CREATE TABLE IF NOT EXISTS clusters (
    clusterId TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    representativeReportId TEXT,
    category TEXT NOT NULL,
    highestSeverity TEXT NOT NULL,
    reportCount INTEGER NOT NULL,
    firstReportedAt TEXT NOT NULL,
    lastReportedAt TEXT NOT NULL,
    placeName TEXT NOT NULL,
    state TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL,
    totalAffectedEstimate INTEGER NOT NULL,
    imageUrl TEXT,
    historyJSON TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_reports_category ON reports(category);
  CREATE INDEX IF NOT EXISTS idx_reports_severity ON reports(severity);
  CREATE INDEX IF NOT EXISTS idx_reports_timestamp ON reports(timestamp);
  CREATE INDEX IF NOT EXISTS idx_reports_cluster ON reports(clusterId);
`);

// Safe column migrations for existing SQLite databases
try {
  db.exec(`ALTER TABLE clusters ADD COLUMN representativeReportId TEXT;`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE clusters ADD COLUMN historyJSON TEXT;`);
} catch (e) {
  // Column already exists
}

try {
  db.exec(`ALTER TABLE reports ADD COLUMN classificationMethod TEXT;`);
} catch (e) {
  // Column already exists
}

/**
 * Upsert a report into SQLite
 */
export function insertReport(report: DisasterReport): void {
  const stmt = db.prepare(`
    INSERT INTO reports (
      id, category, severity, placeName, district, state, lat, lng,
      headline, description, sourceType, sourceName, sourceVerified,
      credibilityScore, language, timestamp, clusterId,
      affectedPopulationEstimate, casualtyEstimate, actionRequired, imageUrl, classificationMethod
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    ) ON CONFLICT(id) DO UPDATE SET
      severity = excluded.severity,
      headline = excluded.headline,
      description = excluded.description,
      credibilityScore = excluded.credibilityScore,
      timestamp = excluded.timestamp,
      classificationMethod = excluded.classificationMethod
  `);

  stmt.run(
    report.id,
    report.category,
    report.severity,
    report.location.placeName,
    report.location.district || null,
    report.location.state,
    report.location.lat,
    report.location.lng,
    report.headline,
    report.description,
    report.source.type,
    report.source.name,
    report.source.verified ? 1 : 0,
    report.credibilityScore,
    report.language,
    report.timestamp,
    report.clusterId,
    report.affectedPopulationEstimate || null,
    report.casualtyEstimate || null,
    report.actionRequired || null,
    report.imageUrl || null,
    report.classificationMethod || 'keyword-fallback'
  );
}

/**
 * Query all reports from SQLite
 */
export function queryReports(): DisasterReport[] {
  const stmt = db.prepare(`SELECT * FROM reports ORDER BY timestamp DESC`);
  const rows = stmt.all() as any[];

  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    location: {
      lat: row.lat,
      lng: row.lng,
      placeName: row.placeName,
      district: row.district || undefined,
      state: row.state,
    },
    headline: row.headline,
    description: row.description,
    source: {
      type: row.sourceType,
      name: row.sourceName,
      verified: row.sourceVerified === 1,
    },
    credibilityScore: row.credibilityScore,
    language: row.language,
    timestamp: row.timestamp,
    clusterId: row.clusterId,
    affectedPopulationEstimate: row.affectedPopulationEstimate || undefined,
    casualtyEstimate: row.casualtyEstimate || undefined,
    actionRequired: row.actionRequired || undefined,
    imageUrl: row.imageUrl || undefined,
    classificationMethod: row.classificationMethod || 'keyword-fallback',
  }));
}

/**
 * Save/update clusters table in SQLite
 */
export function saveClusters(clusters: IncidentCluster[]): void {
  const deleteStmt = db.prepare(`DELETE FROM clusters`);
  const insertStmt = db.prepare(`
    INSERT INTO clusters (
      clusterId, title, representativeReportId, category, highestSeverity, reportCount,
      firstReportedAt, lastReportedAt, placeName, state, lat, lng,
      totalAffectedEstimate, imageUrl, historyJSON
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction((items: IncidentCluster[]) => {
    deleteStmt.run();
    for (const c of items) {
      insertStmt.run(
        c.clusterId,
        c.title,
        c.representativeReportId || c.reports[0]?.id || '',
        c.category,
        c.highestSeverity,
        c.reportCount,
        c.firstReportedAt,
        c.lastReportedAt,
        c.centerLocation.placeName,
        c.centerLocation.state,
        c.centerLocation.lat,
        c.centerLocation.lng,
        c.totalAffectedEstimate,
        c.imageUrl || null,
        JSON.stringify(c.history || [])
      );
    }
  });

  transaction(clusters);
}

/**
 * Purge any non-India reports from SQLite
 */
export function purgeNonIndiaReports(validIds: string[]): void {
  if (validIds.length === 0) return;
  const placeholders = validIds.map(() => '?').join(',');
  const stmt = db.prepare(`DELETE FROM reports WHERE id NOT IN (${placeholders})`);
  stmt.run(...validIds);
}

/**
 * Hard Purge: Deletes any report or cluster that fails valid disaster category criteria or contains generic fallback/US/foreign terms
 */
export function purgeInvalidClusters(): void {
  const validCategories = "('flood','fire','earthquake','cyclone','building_collapse','medical','landslide')";
  db.exec(`DELETE FROM reports WHERE category NOT IN ${validCategories}`);
  db.exec(`DELETE FROM clusters WHERE category NOT IN ${validCategories}`);

  // Hard purge generic fallbacks, US weather dispatches & foreign conflict residual records
  db.exec(`DELETE FROM reports WHERE placeName LIKE '%National Coastline%' OR placeName LIKE '%Central Command%' OR headline LIKE '%NWS%' OR headline LIKE '%Hoboken%' OR headline LIKE '%Denmark%' OR headline LIKE '%Gaza%' OR headline LIKE '%Ukraine%' OR headline LIKE '%Russia%' OR headline LIKE '%Tirado%' OR headline LIKE '%Lake, IN%'`);
  db.exec(`DELETE FROM clusters WHERE placeName LIKE '%National Coastline%' OR placeName LIKE '%Central Command%' OR title LIKE '%NWS%' OR title LIKE '%Hoboken%' OR title LIKE '%Denmark%' OR title LIKE '%Gaza%' OR title LIKE '%Ukraine%' OR title LIKE '%Russia%' OR title LIKE '%Tirado%' OR title LIKE '%Lake, IN%' OR clusterId LIKE '%AND-ZONE%'`);
}
