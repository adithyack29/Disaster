import { jsPDF } from 'jspdf';
import type { IncidentCluster } from '../types/incident';
import { getSeverityConfig, getCategoryLabel } from './severity';
import { formatTimeAgo } from './utils';

/**
 * Programmatically generate and trigger download of an official NDRF Incident PDF Report
 */
export function generateIncidentPDF(cluster: IncidentCluster): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const sevCfg = getSeverityConfig(cluster.highestSeverity);
  const categoryLabel = getCategoryLabel(cluster.category);
  const generatedAt = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

  // 1. Header Bar (Navy Accent)
  doc.setFillColor(30, 58, 95); // #1E3A5F
  doc.rect(0, 0, 210, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('NATIONAL DISASTER RESPONSE FORCE (NDRF)', 14, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('COMMAND CENTER — SITUATION REPORT', 14, 18);

  let y = 34;

  // 2. Incident Title & Location Header
  doc.setTextColor(20, 24, 31); // #14181F
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  
  const titleLines = doc.splitTextToSize(cluster.title, 180);
  doc.text(titleLines, 14, y);
  y += titleLines.length * 7 + 2;

  // Location & Meta Row
  doc.setFont('helvetica', 'semibold');
  doc.setFontSize(10);
  doc.setTextColor(107, 114, 128);
  doc.text(`Location: ${cluster.centerLocation.placeName}, ${cluster.centerLocation.state}`, 14, y);
  y += 6;

  // Metadata Chips Box
  doc.setFillColor(247, 248, 250);
  doc.rect(14, y, 182, 14, 'F');
  doc.setDrawColor(228, 231, 236);
  doc.rect(14, y, 182, 14, 'S');

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 24, 31);

  doc.text(`SEVERITY: ${sevCfg.label.toUpperCase()}`, 18, y + 9);
  doc.text(`CATEGORY: ${categoryLabel.toUpperCase()}`, 65, y + 9);
  doc.text(`REPORTS: ${cluster.reportCount}`, 120, y + 9);
  doc.text(`FIRST REPORTED: ${formatTimeAgo(cluster.firstReportedAt)}`, 155, y + 9);

  y += 22;

  // 3. Situation Summary & Aggregate Stats
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 95);
  doc.text('INCIDENT OVERVIEW & STATS', 14, y);
  y += 6;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(50, 50, 50);

  const avgCredibility = Math.round(
    cluster.reports.reduce((acc, r) => acc + (r.credibilityScore || 80), 0) / (cluster.reports.length || 1)
  );

  doc.text(`• Total Incident Reports Aggregated: ${cluster.reportCount}`, 16, y);
  y += 5;
  doc.text(`• Average Algorithmic Credibility Score: ${avgCredibility}%`, 16, y);
  y += 5;
  if (cluster.totalAffectedEstimate > 0) {
    doc.text(`• Estimated Affected Population: ${cluster.totalAffectedEstimate.toLocaleString('en-IN')} individuals`, 16, y);
    y += 5;
  }
  doc.text(`• Coordinates: Lat ${cluster.centerLocation.lat.toFixed(4)}°, Lng ${cluster.centerLocation.lng.toFixed(4)}°`, 16, y);
  y += 10;

  // 4. Aggregated Telemetry Timeline
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 95);
  doc.text('AGGREGATED MULTI-SOURCE TIMELINE', 14, y);
  y += 6;

  cluster.reports.forEach((rep, index) => {
    // Check if near bottom of page
    if (y > 260) {
      doc.addPage();
      y = 20;
    }

    doc.setFillColor(250, 250, 250);
    doc.rect(14, y, 182, 22, 'F');
    doc.setDrawColor(230, 230, 230);
    doc.rect(14, y, 182, 22, 'S');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 95);
    doc.text(`[${index + 1}] ${rep.source.type.toUpperCase()} — ${rep.source.name}`, 18, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Score: ${rep.credibilityScore}%  |  Time: ${formatTimeAgo(rep.timestamp)}`, 140, y + 6);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(8.5);
    const descLines = doc.splitTextToSize(rep.headline || rep.description, 174);
    doc.text(descLines.slice(0, 2), 18, y + 13);

    y += 26;
  });

  // 5. Source List Section
  if (y > 250) {
    doc.addPage();
    y = 20;
  }

  y += 4;
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 58, 95);
  doc.text('VERIFIED SOURCE DIRECTORY', 14, y);
  y += 6;

  const uniqueSources = Array.from(
    new Map(cluster.reports.map((r) => [r.source.name, r.source])).values()
  );

  uniqueSources.forEach((src) => {
    if (y > 270) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(20, 24, 31);
    doc.text(`• ${src.name} (${src.type.toUpperCase()})`, 16, y);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    const urlText = src.handleOrUrl ? `URL: ${src.handleOrUrl}` : 'URL: Link unavailable (Internal Telemetry)';
    doc.text(urlText, 75, y);

    y += 5;
  });

  // 6. Footer (Page numbers & generated timestamp)
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text(`Generated on: ${generatedAt} IST  |  NDRF Command Center Internal Use Only`, 14, 287);
    doc.text(`Page ${i} of ${pageCount}`, 180, 287);
  }

  // Trigger Download
  const filename = `incident-report-${cluster.clusterId}-${Date.now()}.pdf`;
  doc.save(filename);
}
