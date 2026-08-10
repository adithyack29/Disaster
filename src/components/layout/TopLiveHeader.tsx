import React, { useState } from 'react';
import { RefreshCw, ShieldAlert, Loader2 } from 'lucide-react';
import { useDashboardStore } from '../../store/useDashboardStore';
import { injectLiveSimulatedDispatch } from '../../data/mockApi';

export const TopLiveHeader: React.FC = () => {
  const { triggerRefresh } = useDashboardStore();
  const [isReloading, setIsReloading] = useState(false);

  const handleManualReload = async () => {
    setIsReloading(true);
    try {
      // 1. Try Backend Ingestion Pass
      await fetch('http://127.0.0.1:3001/api/pipeline/run', { method: 'POST' });
    } catch (err) {
      console.warn('Backend reload warning:', err);
    } finally {
      // 2. Inject fresh live dispatch for instant visual feedback on frontend
      injectLiveSimulatedDispatch();
      triggerRefresh();
      setTimeout(() => setIsReloading(false), 600);
    }
  };

  return (
    <header className="bg-[#FFFFFF] border-b border-[#E4E7EC] py-2.5 px-4 flex flex-wrap items-center justify-between gap-3 relative font-sans-ui">
      {/* Brand Badge (Top Left) */}
      <div className="flex items-center gap-2">
        <div className="bg-[#1E3A5F] text-white p-1.5 rounded flex items-center justify-center shadow-2xs">
          <ShieldAlert className="w-4.5 h-4.5 text-amber-400" />
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-bold text-[#14181F] tracking-tight uppercase flex items-center gap-1.5">
            <span>NDRF COMMAND CENTER</span>
            <span className="text-[10px] font-mono-data bg-red-100 text-red-700 px-1.5 py-0.2 rounded font-bold border border-red-200">
              LIVE TELEMETRY
            </span>
          </span>
          <span className="text-[10px] text-[#6B7280]">
            National Disaster Response & Action Portal
          </span>
        </div>
      </div>

      {/* Auto-Classification Status & Manual Reload Controls */}
      <div className="flex items-center gap-2.5">
        {/* Auto-Classification 3-Min Pill Indicator */}
        <div className="flex items-center gap-2 bg-slate-950 text-white px-3 py-1.5 rounded-full border border-slate-800 shadow-2xs text-xs font-mono-data">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="font-semibold text-slate-300">Auto-Classification:</span>
          <span className="text-amber-400 font-bold">Every 3 Min</span>
        </div>

        {/* Manual Reload Button (Directly Next to Auto Classification) */}
        <button
          onClick={handleManualReload}
          disabled={isReloading}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold bg-[#1E3A5F] hover:bg-[#152a45] text-white shadow-2xs transition-all cursor-pointer disabled:opacity-75 hover:scale-105 active:scale-95"
          title="Manual reload & re-run AI ingestion pipeline"
        >
          {isReloading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
          ) : (
            <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
          )}
          <span>{isReloading ? 'RELOADING...' : 'MANUAL RELOAD'}</span>
        </button>
      </div>
    </header>
  );
};
