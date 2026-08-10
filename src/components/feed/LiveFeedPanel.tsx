import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { DisasterReport } from '../../types/incident';
import { ReportCard } from './ReportCard';
import { useDashboardStore } from '../../store/useDashboardStore';
import { Radio, AlertCircle, RefreshCw } from 'lucide-react';

interface LiveFeedPanelProps {
  reports: DisasterReport[];
  loading?: boolean;
}

export const LiveFeedPanel: React.FC<LiveFeedPanelProps> = ({ reports, loading = false }) => {
  const { selectedIncidentId, setSelectedIncident, resetFilters } = useDashboardStore();

  // Deduplicate reports by clusterId
  // Group reports by clusterId; pick the newest / highest severity report as the lead card
  const clusterMap = new Map<string, DisasterReport[]>();
  
  reports.forEach((r) => {
    const key = r.clusterId || r.id;
    const existing = clusterMap.get(key) || [];
    existing.push(r);
    clusterMap.set(key, existing);
  });

  // Array of deduplicated cluster entries
  const deduplicatedClusters: { leadReport: DisasterReport; clusterReports: DisasterReport[] }[] = [];
  
  clusterMap.forEach((clusterReports) => {
    // Sort cluster reports by timestamp desc (newest first)
    const sorted = [...clusterReports].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    deduplicatedClusters.push({
      leadReport: sorted[0],
      clusterReports: sorted,
    });
  });

  return (
    <div className="flex flex-col h-full bg-[#F7F8FA] border-l border-[#E4E7EC] font-sans-ui">
      {/* Feed Panel Header */}
      <div className="bg-[#FFFFFF] border-b border-[#E4E7EC] px-3.5 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-[#1E3A5F] animate-pulse" />
          <h2 className="text-xs font-bold text-[#14181F] font-sans-ui uppercase tracking-wider">
            LIVE DISASTER STREAM
          </h2>
        </div>

        <div className="flex items-center gap-2 font-sans-ui text-xs">
          <span className="bg-[#1E3A5F] text-white font-mono-data tabular-nums font-bold px-2 py-0.5 rounded text-[11px]">
            {loading ? '...' : `${deduplicatedClusters.length} EVENTS (${reports.length} REPS)`}
          </span>
        </div>
      </div>

      {/* Feed List Container */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((n) => (
              <div
                key={n}
                className="bg-white p-3.5 rounded border border-[#E4E7EC] animate-pulse space-y-2"
              >
                <div className="h-4 bg-gray-200 rounded w-1/3" />
                <div className="h-4 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-100 rounded w-2/3" />
              </div>
            ))}
          </div>
        ) : deduplicatedClusters.length === 0 ? (
          <div className="bg-white border border-[#E4E7EC] rounded p-6 text-center space-y-3 my-8">
            <div className="w-10 h-10 rounded-full bg-gray-100 text-[#6B7280] flex items-center justify-center mx-auto">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-[#14181F] font-sans-ui uppercase">
                NO MATCHING DISASTER REPORTS
              </h3>
              <p className="text-xs text-[#6B7280] mt-1 font-sans-ui max-w-[260px] mx-auto">
                No incidents match your current filter criteria. Try widening your severity selection, region, or time window.
              </p>
            </div>
            <button
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1E3A5F] text-white text-xs font-semibold rounded hover:bg-[#152a45] transition-colors cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>RESET ALL FILTERS</span>
            </button>
          </div>
        ) : (
          /* Framer Motion AnimatePresence for smooth enter animation on new live reports */
          <AnimatePresence initial={false}>
            {deduplicatedClusters.map(({ leadReport, clusterReports }) => {
              const isSelected = leadReport.id === selectedIncidentId || clusterReports.some((r) => r.id === selectedIncidentId);
              
              // Part 1 Step 6: Visual recession for non-selected items when an item is selected
              const isAnySelected = selectedIncidentId !== null;
              const opacityClass = isAnySelected && !isSelected ? 'opacity-70 scale-[0.99]' : 'opacity-100 scale-100';

              return (
                <motion.div
                  key={leadReport.id}
                  layout
                  initial={{ opacity: 0, height: 0, y: -10 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, ease: 'easeOut' }}
                  className={`transition-all duration-200 ${opacityClass}`}
                >
                  <ReportCard
                    report={leadReport}
                    clusterReports={clusterReports}
                    isSelected={isSelected}
                    onClick={() => setSelectedIncident(leadReport.id, leadReport.clusterId)}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
};
