import React from 'react';
import type { DisasterReport, DashboardStats } from '../../types/incident';
import { getSeverityConfig } from '../../lib/severity';
import { formatExactTime, formatCoordinates } from '../../lib/utils';
import { ShieldAlert, Printer, Download, X } from 'lucide-react';

interface SituationReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reports: DisasterReport[];
  stats: DashboardStats;
  selectedReport?: DisasterReport | null;
}

export const SituationReportModal: React.FC<SituationReportModalProps> = ({
  isOpen,
  onClose,
  reports,
  stats,
  selectedReport,
}) => {
  if (!isOpen) return null;

  const handlePrint = () => {
    window.print();
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Category', 'Severity', 'Place', 'State', 'Source', 'Verified', 'Timestamp', 'Headline'];
    const rows = reports.map((r) => [
      r.id,
      r.category,
      r.severity,
      `"${r.location.placeName}"`,
      `"${r.location.state}"`,
      `"${r.source.name}"`,
      r.source.verified ? 'YES' : 'NO',
      r.timestamp,
      `"${r.headline.replace(/"/g, '""')}"`,
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `NDRF_SITREP_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const criticalReports = reports.filter((r) => r.severity === 'critical');
  const highReports = reports.filter((r) => r.severity === 'high');

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-[#FFFFFF] border-2 border-[#1E3A5F] w-full max-w-4xl max-h-[90vh] rounded flex flex-col shadow-2xl overflow-hidden print:border-none print:shadow-none print:max-h-none print:w-full">
        <div className="bg-[#1E3A5F] text-white px-4 py-3 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2 font-mono-data">
            <ShieldAlert className="w-5 h-5 text-red-400" />
            <span className="font-bold text-sm tracking-wider uppercase">
              OFFICIAL NDRF SITUATION REPORT (SITREP) GENERATOR
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1 bg-white text-[#1E3A5F] hover:bg-gray-100 text-xs font-semibold rounded font-mono-data cursor-pointer transition-colors"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>PRINT SITREP</span>
            </button>
            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded font-mono-data cursor-pointer transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>EXPORT DATA (.CSV)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 text-gray-300 hover:text-white rounded focus:outline-hidden"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto font-sans-ui text-[#14181F] space-y-6 print:p-0">
          <div className="border-b-2 border-[#14181F] pb-4 flex justify-between items-start">
            <div>
              <div className="text-xs font-mono-data font-bold tracking-widest text-[#1E3A5F] uppercase">
                GOVERNMENT OF INDIA — MINISTRY OF HOME AFFAIRS
              </div>
              <h1 className="text-xl font-bold text-[#14181F] tracking-tight uppercase mt-0.5">
                NATIONAL DISASTER RESPONSE FORCE (NDRF)
              </h1>
              <h2 className="text-sm font-semibold font-mono-data text-[#6B7280]">
                CENTRAL COMMAND & CONTROL CELL — DISASTER SITUATION BRIEFING
              </h2>
            </div>
            <div className="text-right font-mono-data text-xs space-y-1">
              <div className="inline-block bg-[#14181F] text-white px-2 py-0.5 text-[10px] font-bold rounded">
                RESTRICTED // OFFICIAL USE ONLY
              </div>
              <div>DOC REF: SITREP-2026-IND-NDRF</div>
              <div>ISSUED: {formatExactTime(new Date().toISOString())}</div>
            </div>
          </div>

          <div>
            <h3 className="text-xs font-mono-data font-bold text-[#1E3A5F] uppercase tracking-wider mb-2 border-b border-[#E4E7EC] pb-1">
              1. EXECUTIVE THREAT ASSESSMENT & SITUATIONAL METRICS
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 font-mono-data">
              <div className="bg-[#F7F8FA] border border-[#E4E7EC] p-2.5 rounded">
                <div className="text-[10px] text-[#6B7280]">ACTIVE INCIDENTS MONITORED</div>
                <div className="text-xl font-bold text-[#14181F]">{stats.activeIncidents}</div>
              </div>
              <div className="bg-red-50 border border-red-200 p-2.5 rounded">
                <div className="text-[10px] text-[#DC2626] font-bold">CRITICAL SEVERITY ZONES</div>
                <div className="text-xl font-bold text-[#DC2626]">{stats.criticalCount}</div>
              </div>
              <div className="bg-orange-50 border border-orange-200 p-2.5 rounded">
                <div className="text-[10px] text-[#EA580C] font-bold">HIGH PRIORITY SECTORS</div>
                <div className="text-xl font-bold text-[#EA580C]">{stats.highCount}</div>
              </div>
              <div className="bg-blue-50 border border-blue-200 p-2.5 rounded">
                <div className="text-[10px] text-[#2563EB] font-bold">VERIFIED SOURCE RATIO</div>
                <div className="text-xl font-bold text-[#2563EB]">{stats.verifiedPercentage}%</div>
              </div>
            </div>
          </div>

          {selectedReport && (
            <div className="bg-[#F7F8FA] border-l-4 border-[#DC2626] p-4 rounded border">
              <h3 className="text-xs font-mono-data font-bold text-[#DC2626] uppercase tracking-wider mb-1">
                2. FOCUS INCIDENT SPECIFIC ASSESSMENT
              </h3>
              <h4 className="text-sm font-bold text-[#14181F] mb-1">{selectedReport.headline}</h4>
              <div className="text-xs font-mono-data text-[#6B7280] mb-2">
                LOCATION: {selectedReport.location.placeName}, {selectedReport.location.state} (
                {formatCoordinates(selectedReport.location.lat, selectedReport.location.lng)})
              </div>
              <p className="text-xs text-[#14181F] leading-relaxed mb-2">
                {selectedReport.description}
              </p>
              {selectedReport.actionRequired && (
                <div className="bg-white border border-red-200 p-2 rounded text-xs font-mono-data text-[#DC2626] font-semibold">
                  DISPATCH ACTION: {selectedReport.actionRequired}
                </div>
              )}
            </div>
          )}

          <div>
            <h3 className="text-xs font-mono-data font-bold text-[#1E3A5F] uppercase tracking-wider mb-2 border-b border-[#E4E7EC] pb-1">
              3. PRIORITY CRITICAL & HIGH INCIDENT DISPATCH LOG
            </h3>
            <table className="w-full text-left border-collapse text-xs font-mono-data">
              <thead>
                <tr className="bg-[#1E3A5F] text-white">
                  <th className="p-2 border border-[#1E3A5F]">SEV</th>
                  <th className="p-2 border border-[#1E3A5F]">CAT</th>
                  <th className="p-2 border border-[#1E3A5F]">LOCATION</th>
                  <th className="p-2 border border-[#1E3A5F]">SOURCE</th>
                  <th className="p-2 border border-[#1E3A5F]">SCORE</th>
                  <th className="p-2 border border-[#1E3A5F]">SITUATION BRIEF</th>
                </tr>
              </thead>
              <tbody>
                {[...criticalReports, ...highReports].map((rep, idx) => {
                  const cfg = getSeverityConfig(rep.severity);
                  return (
                    <tr
                      key={rep.id}
                      className={idx % 2 === 0 ? 'bg-[#FFFFFF]' : 'bg-[#F7F8FA]'}
                    >
                      <td className="p-2 border border-[#E4E7EC] font-bold" style={{ color: cfg.color }}>
                        {cfg.label}
                      </td>
                      <td className="p-2 border border-[#E4E7EC] uppercase">{rep.category}</td>
                      <td className="p-2 border border-[#E4E7EC]">
                        {rep.location.placeName}, {rep.location.state}
                      </td>
                      <td className="p-2 border border-[#E4E7EC]">{rep.source.name}</td>
                      <td className="p-2 border border-[#E4E7EC]">{rep.credibilityScore}</td>
                      <td className="p-2 border border-[#E4E7EC] font-sans-ui text-[11px]">
                        {rep.headline}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pt-4 border-t border-[#E4E7EC] flex justify-between items-center text-xs font-mono-data text-[#6B7280]">
            <div>NDRF CENTRAL COMMAND ROOM — AUTHORIZED SIGN-OFF</div>
            <div>PAGE 1 OF 1</div>
          </div>
        </div>
      </div>
    </div>
  );
};
