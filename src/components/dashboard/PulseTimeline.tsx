import React from 'react';
import type { PulseBucket } from '../../types/incident';
import { useDashboardStore } from '../../store/useDashboardStore';
import { getSeverityColor } from '../../lib/severity';
import { Activity, XCircle } from 'lucide-react';

interface PulseTimelineProps {
  buckets: PulseBucket[];
}

export const PulseTimeline: React.FC<PulseTimelineProps> = ({ buckets }) => {
  const { filters, setTimeRange } = useDashboardStore();
  const selectedTimeRange = filters.timeRange;

  const handleBucketClick = (bucket: PulseBucket) => {
    const start = bucket.timestamp - 3600 * 1000;
    const end = bucket.timestamp;

    if (
      selectedTimeRange &&
      selectedTimeRange[0] === start &&
      selectedTimeRange[1] === end
    ) {
      setTimeRange(null);
    } else {
      setTimeRange([start, end]);
    }
  };

  const maxTotal = Math.max(...buckets.map((b) => b.total), 1);

  return (
    <div className="bg-[#FFFFFF] border-b border-[#E4E7EC] px-4 py-2 flex flex-col justify-center select-none">
      <div className="flex items-center justify-between text-[11px] font-mono-data mb-1.5">
        <div className="flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-[#1E3A5F] animate-pulse" />
          <span className="font-semibold text-[#1E3A5F] uppercase tracking-wider">
            24-HOUR DISASTER VITAL PULSE STREAM
          </span>
          <span className="text-[#6B7280]">
            — CLICK ANY HOURLY SPIKE TO ISOLATE INCIDENTS
          </span>
        </div>

        {selectedTimeRange ? (
          <div className="flex items-center gap-2">
            <span className="bg-[#1E3A5F] text-white px-2 py-0.5 rounded text-[10px] font-semibold">
              TIME WINDOW FILTERED
            </span>
            <button
              onClick={() => setTimeRange(null)}
              className="flex items-center gap-1 text-[#DC2626] hover:underline cursor-pointer font-semibold text-[11px]"
            >
              <XCircle className="w-3 h-3" />
              CLEAR WINDOW
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-[#6B7280]">
              <span className="w-2 h-2 rounded-full bg-[#DC2626]" /> CRITICAL
            </span>
            <span className="flex items-center gap-1 text-[#6B7280]">
              <span className="w-2 h-2 rounded-full bg-[#EA580C]" /> HIGH
            </span>
            <span className="flex items-center gap-1 text-[#6B7280]">
              <span className="w-2 h-2 rounded-full bg-[#D97706]" /> MODERATE
            </span>
            <span className="flex items-center gap-1 text-[#6B7280]">
              <span className="w-2 h-2 rounded-full bg-[#2563EB]" /> LOW
            </span>
          </div>
        )}
      </div>

      <div className="h-[48px] w-full flex items-end gap-1 bg-[#F7F8FA] border border-[#E4E7EC] rounded px-2 py-1 relative">
        {buckets.map((bucket, index) => {
          const isSelected =
            selectedTimeRange &&
            bucket.timestamp >= selectedTimeRange[0] &&
            bucket.timestamp <= selectedTimeRange[1];

          const heightPercent = bucket.total > 0 ? Math.max((bucket.total / maxTotal) * 100, 20) : 10;
          const barColor = getSeverityColor(bucket.dominantSeverity);

          return (
            <button
              key={index}
              onClick={() => handleBucketClick(bucket)}
              title={`${bucket.label}: ${bucket.total} reports (${bucket.critical} critical)`}
              className={`flex-1 flex flex-col justify-end items-center group relative h-full focus:outline-hidden cursor-pointer transition-all ${
                isSelected ? 'opacity-100 ring-2 ring-[#1E3A5F] rounded-xs' : 'hover:opacity-100 opacity-80'
              }`}
            >
              <div
                className="w-full rounded-t-xs transition-all duration-200"
                style={{
                  height: `${heightPercent}%`,
                  backgroundColor: bucket.total > 0 ? barColor : '#E4E7EC',
                }}
              />

              <div className="opacity-0 group-hover:opacity-100 pointer-events-none absolute bottom-full mb-1 z-30 bg-[#14181F] text-white text-[10px] font-mono-data rounded px-2 py-1 whitespace-nowrap shadow-md">
                <div className="font-semibold text-amber-400">{bucket.label}</div>
                <div>Total Reports: {bucket.total}</div>
                {bucket.critical > 0 && <div className="text-red-400">Critical: {bucket.critical}</div>}
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-between text-[9px] font-mono-data text-[#6B7280] mt-1 px-1">
        <span>-24 HRS AGO</span>
        <span>-18 HRS</span>
        <span>-12 HRS</span>
        <span>-6 HRS</span>
        <span>NOW (LIVE)</span>
      </div>
    </div>
  );
};
