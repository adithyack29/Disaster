import React, { useState, useEffect } from 'react';
import { ShieldAlert, Radio, RefreshCw, FilterX, FileText } from 'lucide-react';
import { useDashboardStore } from '../../store/useDashboardStore';

interface AppHeaderProps {
  onOpenSituationReport?: () => void;
}

export const AppHeader: React.FC<AppHeaderProps> = ({ onOpenSituationReport }) => {
  const { liveMode, toggleLiveMode, resetFilters, lastUpdated, triggerRefresh } = useDashboardStore();
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    setSecondsAgo(0);
    const interval = setInterval(() => {
      setSecondsAgo((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  return (
    <header className="bg-[#FFFFFF] border-b border-[#E4E7EC] px-4 py-2.5 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-xs">
      {/* Left: Branding & Command Center Identifier */}
      <div className="flex items-center gap-3">
        <div className="bg-[#1E3A5F] text-white p-2 rounded flex items-center justify-center shadow-xs">
          <ShieldAlert className="w-5 h-5 text-red-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-bold text-[#14181F] tracking-tight font-sans-ui uppercase">
              NDRF COMMAND CENTER
            </h1>
            <span className="bg-[#F7F8FA] text-[#1E3A5F] text-[10px] font-sans-ui font-semibold px-2 py-0.5 rounded border border-[#E4E7EC]">
              V1.4-LIVE
            </span>
          </div>
          <p className="text-xs text-[#6B7280] font-sans-ui">
            Real-Time Open-Source Disaster Information Aggregator
          </p>
        </div>
      </div>

      {/* Center: Live Signal Status Indicator with Fixed Width to prevent CLS */}
      <div className="flex items-center gap-3 bg-[#F7F8FA] px-3 py-1.5 rounded border border-[#E4E7EC] self-start md:self-auto h-[34px]">
        <div className="flex items-center gap-2 shrink-0">
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            {liveMode && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span
              className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                liveMode ? 'bg-emerald-600' : 'bg-amber-500'
              }`}
            ></span>
          </span>
          <span className="text-xs font-semibold text-[#14181F] font-sans-ui w-[84px] shrink-0">
            {liveMode ? 'SYSTEM LIVE' : 'PAUSED'}
          </span>
        </div>
        
        <div className="h-3 w-[1px] bg-[#E4E7EC] shrink-0" />

        {/* Fixed Width Container with tabular-nums so ticking seconds never reflow neighbors */}
        <div className="text-xs text-[#6B7280] font-sans-ui flex items-center gap-1 min-w-[125px] shrink-0 justify-end">
          <span>UPDATED:</span>
          <span className="text-[#14181F] font-semibold font-mono-data tabular-nums text-right inline-block w-[44px]">
            {secondsAgo}s AGO
          </span>
        </div>

        <button
          onClick={triggerRefresh}
          title="Force refresh feed"
          className="text-[#6B7280] hover:text-[#1E3A5F] transition-colors p-0.5 focus:outline-hidden cursor-pointer shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right: Quick Action Controls */}
      <div className="flex items-center gap-2 font-sans-ui">
        <button
          onClick={toggleLiveMode}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold border transition-colors cursor-pointer ${
            liveMode
              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] hover:bg-[#152a45]'
              : 'bg-[#F7F8FA] text-[#14181F] border-[#E4E7EC] hover:bg-gray-100'
          }`}
        >
          <Radio className={`w-3.5 h-3.5 ${liveMode ? 'animate-pulse text-emerald-400' : 'text-[#6B7280]'}`} />
          <span>{liveMode ? 'LIVE STREAM' : 'RESUME STREAM'}</span>
        </button>

        {onOpenSituationReport && (
          <button
            onClick={onOpenSituationReport}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1E3A5F] text-white hover:bg-[#162C48] text-xs font-medium rounded transition-colors border border-[#1E3A5F] cursor-pointer"
          >
            <FileText className="w-3.5 h-3.5" />
            <span>SITUATION REPORT</span>
          </button>
        )}

        <button
          onClick={resetFilters}
          title="Clear all filters"
          className="flex items-center gap-1 px-2.5 py-1.5 bg-[#FFFFFF] border border-[#E4E7EC] hover:bg-[#F7F8FA] text-[#6B7280] hover:text-[#14181F] text-xs rounded font-medium transition-colors cursor-pointer"
        >
          <FilterX className="w-3.5 h-3.5" />
          <span>RESET</span>
        </button>
      </div>
    </header>
  );
};
