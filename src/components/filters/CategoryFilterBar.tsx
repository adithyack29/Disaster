import React, { useState, useRef, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import type { CategoryType, SeverityLevel } from '../../types/incident';
import { CATEGORY_CONFIG, SEVERITY_CONFIG } from '../../lib/severity';
import { 
  Waves, 
  Flame, 
  Activity, 
  Wind, 
  Building2, 
  Cross, 
  Mountain,
  Filter,
  CheckCircle2,
  X,
  Zap
} from 'lucide-react';

const CATEGORIES: CategoryType[] = [
  'flood',
  'fire',
  'earthquake',
  'cyclone',
  'building_collapse',
  'medical',
  'landslide',
];

const SEVERITIES: SeverityLevel[] = ['critical', 'high', 'moderate', 'low'];

export const CategoryFilterBar: React.FC = () => {
  const { filters, toggleCategory, toggleSeverity, setVerifiedOnly, setSourceType, setRecentlyReportedOnly } = useDashboardStore();
  const [isSeverityOpen, setIsSeverityOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsSeverityOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getCategoryIcon = (cat: CategoryType) => {
    switch (cat) {
      case 'flood': return <Waves className="w-3.5 h-3.5 shrink-0" />;
      case 'fire': return <Flame className="w-3.5 h-3.5 shrink-0" />;
      case 'earthquake': return <Activity className="w-3.5 h-3.5 shrink-0" />;
      case 'cyclone': return <Wind className="w-3.5 h-3.5 shrink-0" />;
      case 'building_collapse': return <Building2 className="w-3.5 h-3.5 shrink-0" />;
      case 'medical': return <Cross className="w-3.5 h-3.5 shrink-0" />;
      case 'landslide': return <Mountain className="w-3.5 h-3.5 shrink-0" />;
    }
  };

  const isRecentlyReportedSelected = !!filters.recentlyReportedOnly;
  const isAllSelected = filters.categories.length === 0 && !isRecentlyReportedSelected;

  const handleAllClick = () => {
    useDashboardStore.setState((state) => ({
      filters: { ...state.filters, categories: [], recentlyReportedOnly: false },
    }));
  };

  const handleRecentlyReportedClick = () => {
    setRecentlyReportedOnly(!isRecentlyReportedSelected);
  };

  return (
    <div className="bg-[#FFFFFF] border-b border-[#E4E7EC] px-4 py-2 flex items-center justify-between gap-3 relative font-sans-ui">
      {/* Horizontal Scrolling One-Line Category Chips Row */}
      <div className="flex items-center gap-1.5 overflow-x-auto whitespace-nowrap scrollbar-none py-1 flex-1">
        {/* "All" Chip */}
        <button
          onClick={handleAllClick}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-all cursor-pointer shrink-0 ${
            isAllSelected
              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] shadow-2xs'
              : 'bg-[#F7F8FA] text-[#6B7280] border-[#E4E7EC] hover:text-[#14181F] hover:bg-gray-100'
          }`}
        >
          All Incidents
        </button>

        {/* "Recently Reported" Chip (Directly next to All Incidents) */}
        <button
          onClick={handleRecentlyReportedClick}
          className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
            isRecentlyReportedSelected
              ? 'bg-amber-500 text-white border-amber-600 shadow-2xs font-bold'
              : 'bg-[#F7F8FA] text-[#6B7280] border-[#E4E7EC] hover:text-[#14181F] hover:bg-gray-100'
          }`}
        >
          <Zap className={`w-3.5 h-3.5 ${isRecentlyReportedSelected ? 'text-white animate-bounce' : 'text-amber-500'}`} />
          <span>Recently Reported</span>
        </button>

        {/* Category Chips */}
        {CATEGORIES.map((cat) => {
          const isSelected = filters.categories.includes(cat);
          const label = CATEGORY_CONFIG[cat]?.label || cat;
          return (
            <button
              key={cat}
              onClick={() => toggleCategory(cat)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 transition-all cursor-pointer shrink-0 ${
                isSelected
                  ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] shadow-2xs'
                  : 'bg-[#F7F8FA] text-[#6B7280] border-[#E4E7EC] hover:text-[#14181F] hover:bg-gray-100'
              }`}
            >
              {getCategoryIcon(cat)}
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {/* Compact Icon-Only Severity Filter Toggle at the end of the row */}
      <div className="relative shrink-0" ref={dropdownRef}>
        <button
          onClick={() => setIsSeverityOpen(!isSeverityOpen)}
          title="Filter by severity level"
          aria-label="Filter by severity level"
          aria-expanded={isSeverityOpen}
          className={`p-2 rounded-full border transition-all cursor-pointer flex items-center gap-1 ${
            filters.severities.length > 0 || filters.verifiedOnly
              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
              : 'bg-[#F7F8FA] text-[#6B7280] border-[#E4E7EC] hover:text-[#14181F] hover:bg-gray-100'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {(filters.severities.length > 0 || filters.verifiedOnly) && (
            <span className="bg-emerald-500 text-white font-mono-data text-[10px] font-bold px-1.5 rounded-full">
              {filters.severities.length + (filters.verifiedOnly ? 1 : 0)}
            </span>
          )}
        </button>

        {/* Compact Severity Popover */}
        {isSeverityOpen && (
          <div className="absolute right-0 top-full mt-1.5 z-50 bg-[#FFFFFF] border border-[#E4E7EC] rounded-lg shadow-lg p-3 w-56 space-y-3 font-sans-ui text-xs animate-in fade-in duration-150">
            <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-1.5">
              <span className="font-bold text-[#1E3A5F] uppercase text-[11px]">Severity Filter</span>
              {(filters.severities.length > 0 || filters.verifiedOnly) && (
                <button
                  onClick={() => {
                    useDashboardStore.setState((state) => ({
                      filters: { ...state.filters, severities: [], verifiedOnly: false },
                    }));
                  }}
                  className="text-[10px] text-[#DC2626] hover:underline font-semibold"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Severity Level Buttons */}
            <div className="space-y-1">
              {SEVERITIES.map((sev) => {
                const cfg = SEVERITY_CONFIG[sev];
                const isSelected = filters.severities.includes(sev);
                return (
                  <button
                    key={sev}
                    onClick={() => toggleSeverity(sev)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs font-semibold transition-all cursor-pointer ${
                      isSelected
                        ? 'text-white'
                        : 'bg-[#F7F8FA] text-[#6B7280] hover:text-[#14181F]'
                    }`}
                    style={{
                      backgroundColor: isSelected ? cfg.color : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: isSelected ? '#FFFFFF' : cfg.color }}
                      />
                      <span>{cfg.label}</span>
                    </div>
                    {isSelected && <X className="w-3.5 h-3.5 text-white" />}
                  </button>
                );
              })}
            </div>

            {/* Source Type Selector */}
            <div className="pt-2 border-t border-[#E4E7EC]">
              <span className="font-bold text-[#1E3A5F] uppercase text-[10px] block mb-1">Source Type:</span>
              <div className="flex flex-wrap gap-1 text-[10px]">
                {(['all', 'official', 'news', 'social', 'sensor', 'citizen'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setSourceType(st)}
                    className={`px-2 py-0.5 rounded font-semibold capitalize transition-colors cursor-pointer ${
                      filters.sourceType === st
                        ? 'bg-[#1E3A5F] text-white'
                        : 'bg-[#F7F8FA] text-[#6B7280] hover:text-[#14181F]'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Verified Only Switch */}
            <div className="pt-2 border-t border-[#E4E7EC]">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#6B7280] hover:text-[#14181F]">
                <input
                  type="checkbox"
                  checked={filters.verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="sr-only"
                />
                <CheckCircle2
                  className={`w-4 h-4 ${
                    filters.verifiedOnly ? 'text-[#2563EB] fill-blue-50' : 'text-[#6B7280]'
                  }`}
                />
                <span className="font-semibold text-[11px]">Verified Sources Only</span>
              </label>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
