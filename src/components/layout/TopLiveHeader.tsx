import React, { useState } from 'react';
import { RefreshCw, ShieldAlert, Loader2, LayoutGrid, Map as MapIcon } from 'lucide-react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { triggerPipelineAndRefresh } from '../../data/mockApi';

export const TopLiveHeader: React.FC = () => {
  const { triggerRefresh, ingestionMode, ingestionLiveCount, viewMode, setViewMode } = useDashboardStore();
  const [isReloading, setIsReloading] = useState(false);

  const handleManualReload = async () => {
    setIsReloading(true);
    try {
      await triggerPipelineAndRefresh();
    } catch (err) {
      console.warn('Backend reload warning:', err);
    } finally {
      triggerRefresh();
      setTimeout(() => setIsReloading(false), 800);
    }
  };

  // Honest data-source badge: never claims "LIVE" when the demo-safety fallback is what's
  // actually being shown (triggered automatically because every live source failed/returned
  // nothing). See CLAUDE.md "Demo-safety mode".
  const isDemo = ingestionMode === 'demo';
  const badgeLabel = ingestionMode === 'demo'
    ? 'DEMO SNAPSHOT'
    : ingestionMode === 'live'
    ? `LIVE (${ingestionLiveCount})`
    : 'CONNECTING…';

  return (
    <header className="bg-[#FFFFFF] border-b border-[#E4E7EC] py-2.5 px-4 flex flex-wrap items-center justify-between gap-3 relative font-sans-ui">
      {/* Brand Badge (Top Left) */}
      <div className="flex items-center gap-2">
        <div className="bg-[#1E3A5F] text-white p-1.5 rounded flex items-center justify-center shadow-2xs">
          <ShieldAlert className="w-4.5 h-4.5 text-amber-400" aria-hidden="true" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold text-[#14181F] tracking-tight uppercase flex items-center gap-1.5 flex-wrap">
            <span>NDRF COMMAND CENTER</span>
            <span
              className={`text-[10px] font-mono-data px-1.5 py-0.2 rounded font-bold border ${
                isDemo
                  ? 'bg-amber-100 text-amber-800 border-amber-200'
                  : 'bg-red-100 text-red-700 border-red-200'
              }`}
              title={isDemo ? 'Serving the curated demo-safety snapshot, not live data' : `${ingestionLiveCount} live reports currently ingested`}
            >
              {badgeLabel}
            </span>
          </span>
          <span className="text-[10px] text-[#6B7280] hidden sm:block">
            National Disaster Response & Action Portal
          </span>
        </div>
      </div>

      {/* Auto-Classification Status, View Toggle & Manual Reload Controls */}
      <div className="flex items-center gap-2 sm:gap-2.5 flex-wrap">
        {/* Auto-Classification 3-Min Pill Indicator */}
        <div className="hidden md:flex items-center gap-2 bg-slate-950 text-white px-3 py-1.5 rounded-full border border-slate-800 shadow-2xs text-xs font-mono-data">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-slate-300">Auto-Classification:</span>
          <span className="text-amber-400 font-bold">Every 3 Min</span>
        </div>

        {/* Cards / Map View Toggle */}
        <div className="flex items-center bg-[#F7F8FA] border border-[#E4E7EC] rounded-full p-0.5" role="tablist" aria-label="Dashboard view">
          <button
            role="tab"
            aria-selected={viewMode === 'cards'}
            onClick={() => setViewMode('cards')}
            title="Card grid view"
            className={`p-1.5 rounded-full transition-colors cursor-pointer ${viewMode === 'cards' ? 'bg-[#1E3A5F] text-white' : 'text-[#6B7280] hover:text-[#14181F]'}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            role="tab"
            aria-selected={viewMode === 'map'}
            onClick={() => setViewMode('map')}
            title="Map view"
            className={`p-1.5 rounded-full transition-colors cursor-pointer ${viewMode === 'map' ? 'bg-[#1E3A5F] text-white' : 'text-[#6B7280] hover:text-[#14181F]'}`}
          >
            <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Manual Reload Button */}
        <button
          onClick={handleManualReload}
          disabled={isReloading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#1E3A5F] hover:bg-[#152a45] text-white shadow-2xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Manual reload & re-run AI ingestion pipeline"
        >
          {isReloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" aria-hidden="true" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">{isReloading ? 'RELOADING...' : 'MANUAL RELOAD'}</span>
        </button>
      </div>
    </header>
  );
};
