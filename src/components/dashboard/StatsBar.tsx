import React from 'react';
import type { DashboardStats } from '../../types/incident';

interface StatsBarProps {
  stats: DashboardStats;
  loading?: boolean;
}

export const StatsBar: React.FC<StatsBarProps> = ({ stats, loading = false }) => {
  return (
    <div className="bg-[#F7F8FA] border-b border-[#E4E7EC] px-4 py-2.5 flex flex-col gap-2">
      {/* Primary Row: Exactly 3 Prominent Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* 1. Active Incidents */}
        <div className="bg-[#FFFFFF] p-3 rounded border border-[#E4E7EC] flex items-center justify-between h-[64px] min-w-[180px]">
          <div>
            <span className="text-[11px] font-sans-ui font-semibold text-[#6B7280] uppercase tracking-wider block">
              ACTIVE INCIDENTS
            </span>
            <span className="text-xs font-sans-ui text-[#6B7280]">FILTERED TOTAL</span>
          </div>
          <span className="text-2xl font-bold font-mono-data tabular-nums text-[#14181F] shrink-0 min-w-[48px] text-right">
            {loading ? '--' : stats.activeIncidents}
          </span>
        </div>

        {/* 2. Critical Now */}
        <div className="bg-[#FFFFFF] p-3 rounded border border-[#E4E7EC] flex items-center justify-between h-[64px] min-w-[180px] relative overflow-hidden">
          <div className="absolute top-0 left-0 bottom-0 w-1.5 bg-[#DC2626]" />
          <div className="pl-1.5">
            <span className="text-[11px] font-sans-ui font-bold text-[#DC2626] uppercase tracking-wider block">
              CRITICAL NOW
            </span>
            <span className="text-[10px] font-sans-ui font-semibold text-[#DC2626] bg-red-50 px-1.5 py-0.5 rounded">
              PRIORITY 1 DISPATCH
            </span>
          </div>
          <span className="text-2xl font-bold font-mono-data tabular-nums text-[#DC2626] shrink-0 min-w-[48px] text-right">
            {loading ? '--' : stats.criticalCount}
          </span>
        </div>

        {/* 3. Reports Ingested (1hr) */}
        <div className="bg-[#FFFFFF] p-3 rounded border border-[#E4E7EC] flex items-center justify-between h-[64px] min-w-[180px]">
          <div>
            <span className="text-[11px] font-sans-ui font-semibold text-[#6B7280] uppercase tracking-wider block">
              REPORTS INGESTED (1HR)
            </span>
            <span className="text-xs font-sans-ui text-[#6B7280]">RATE PER HOUR</span>
          </div>
          <span className="text-2xl font-bold font-mono-data tabular-nums text-[#1E3A5F] shrink-0 min-w-[48px] text-right">
            {loading ? '--' : stats.reportsLastHour}
          </span>
        </div>
      </div>

      {/* Secondary Row: Subdued inline telemetry metrics (No heavy cards, muted gray) */}
      <div className="flex flex-wrap items-center justify-end gap-6 text-xs text-[#6B7280] font-sans-ui pt-0.5 px-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#EA580C]" />
          <span>High Severity:</span>
          <span className="font-mono-data font-bold text-[#EA580C] tabular-nums">
            {loading ? '--' : stats.highCount}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#2563EB]" />
          <span>Verified Sources:</span>
          <span className="font-mono-data font-bold text-[#2563EB] tabular-nums">
            {loading ? '--' : `${stats.verifiedPercentage}%`}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[#14181F]" />
          <span>Active Channels:</span>
          <span className="font-mono-data font-bold text-[#14181F] tabular-nums">
            {loading ? '--' : stats.monitoredSourcesCount}
          </span>
        </div>
      </div>
    </div>
  );
};
