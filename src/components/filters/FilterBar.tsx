import React, { useState, useRef, useEffect } from 'react';
import { useDashboardStore } from '../../store/useDashboardStore';
import type { CategoryType, SeverityLevel } from '../../types/incident';
import { CATEGORY_CONFIG, SEVERITY_CONFIG } from '../../lib/severity';
import { 
  Search, 
  SlidersHorizontal,
  CheckCircle2, 
  FilterX, 
  X,
  ChevronDown,
  Waves, 
  Flame, 
  Activity, 
  Wind, 
  Building2, 
  Cross, 
  Mountain 
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

const STATES = [
  { value: 'all', label: 'All Regions (India)' },
  { value: 'Kerala', label: 'Kerala' },
  { value: 'Assam', label: 'Assam' },
  { value: 'Odisha', label: 'Odisha' },
  { value: 'Uttarakhand', label: 'Uttarakhand' },
  { value: 'Gujarat', label: 'Gujarat' },
  { value: 'Tamil Nadu', label: 'Tamil Nadu' },
  { value: 'Maharashtra', label: 'Maharashtra' },
  { value: 'Himachal Pradesh', label: 'Himachal Pradesh' },
  { value: 'West Bengal', label: 'West Bengal' },
];

export const FilterBar: React.FC = () => {
  const {
    filters,
    toggleCategory,
    toggleSeverity,
    setVerifiedOnly,
    setRegion,
    setSearchQuery,
    setSourceType,
    resetFilters,
  } = useDashboardStore();

  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close popover when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const getCategoryIcon = (cat: CategoryType) => {
    switch (cat) {
      case 'flood': return <Waves className="w-3.5 h-3.5" />;
      case 'fire': return <Flame className="w-3.5 h-3.5" />;
      case 'earthquake': return <Activity className="w-3.5 h-3.5" />;
      case 'cyclone': return <Wind className="w-3.5 h-3.5" />;
      case 'building_collapse': return <Building2 className="w-3.5 h-3.5" />;
      case 'medical': return <Cross className="w-3.5 h-3.5" />;
      case 'landslide': return <Mountain className="w-3.5 h-3.5" />;
    }
  };

  // Count active filter parameters
  const activeCount =
    filters.categories.length +
    filters.severities.length +
    (filters.verifiedOnly ? 1 : 0) +
    (filters.region !== 'all' ? 1 : 0) +
    (filters.sourceType !== 'all' ? 1 : 0) +
    (filters.timeRange !== null ? 1 : 0);

  return (
    <div className="bg-[#FFFFFF] border-b border-[#E4E7EC] px-4 py-2.5 relative font-sans-ui" ref={panelRef}>
      {/* Single Collapsed Row: Search Box + Filters Popover Button + Quick Clear */}
      <div className="flex items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[#6B7280]" />
          <input
            type="text"
            value={filters.searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search disaster reports by keyword, region, or source..."
            className="w-full bg-[#F7F8FA] border border-[#E4E7EC] text-[#14181F] text-xs pl-9 pr-8 py-2 rounded focus:outline-hidden focus:border-[#1E3A5F] focus:bg-white placeholder:text-[#6B7280] font-sans-ui"
          />
          {filters.searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6B7280] hover:text-[#14181F] p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Popover Toggle Button */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-semibold border transition-all cursor-pointer ${
            activeCount > 0 || isOpen
              ? 'bg-[#1E3A5F] text-white border-[#1E3A5F]'
              : 'bg-[#F7F8FA] text-[#14181F] border-[#E4E7EC] hover:bg-gray-100'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>FILTERS</span>
          {activeCount > 0 && (
            <span className="bg-emerald-500 text-white font-mono-data text-[10px] font-bold px-1.5 py-0.2 rounded-full">
              {activeCount}
            </span>
          )}
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Reset Button if active */}
        {activeCount > 0 && (
          <button
            onClick={resetFilters}
            className="flex items-center gap-1 text-xs text-[#DC2626] bg-red-50 hover:bg-red-100 border border-red-200 px-2.5 py-2 rounded font-sans-ui font-semibold transition-colors cursor-pointer shrink-0"
          >
            <FilterX className="w-3.5 h-3.5" />
            <span>RESET ({activeCount})</span>
          </button>
        )}
      </div>

      {/* Popover Filter Drawer (Opens cleanly below single row) */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 z-[600] bg-[#FFFFFF] border-b border-[#E4E7EC] shadow-xl p-4 space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="flex items-center justify-between border-b border-[#E4E7EC] pb-2">
            <h3 className="text-xs font-bold text-[#1E3A5F] uppercase tracking-wider">
              FILTER DISASTER FEED & MAP TELEMETRY
            </h3>
            {activeCount > 0 && (
              <button
                onClick={resetFilters}
                className="text-xs text-[#DC2626] hover:underline font-semibold"
              >
                Clear all active filters ({activeCount})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Severity Selection */}
            <div>
              <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider block mb-2">
                SEVERITY THREAT LEVEL:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {SEVERITIES.map((sev) => {
                  const cfg = SEVERITY_CONFIG[sev];
                  const isSelected = filters.severities.includes(sev);
                  return (
                    <button
                      key={sev}
                      onClick={() => toggleSeverity(sev)}
                      className={`text-xs font-semibold px-2.5 py-1 rounded border transition-all cursor-pointer ${
                        isSelected
                          ? 'text-white shadow-xs'
                          : 'bg-white text-[#6B7280] border-[#E4E7EC] hover:border-gray-400'
                      }`}
                      style={{
                        backgroundColor: isSelected ? cfg.color : undefined,
                        borderColor: isSelected ? cfg.color : undefined,
                      }}
                    >
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Region & Source Filter */}
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1.5">
                  GEOGRAPHIC REGION:
                </span>
                <select
                  value={filters.region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full bg-[#F7F8FA] border border-[#E4E7EC] text-[#14181F] text-xs px-2.5 py-1.5 rounded focus:outline-hidden focus:border-[#1E3A5F] cursor-pointer"
                >
                  {STATES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1.5">
                  FEED SOURCE TYPE:
                </span>
                <div className="flex items-center bg-[#F7F8FA] border border-[#E4E7EC] p-0.5 rounded text-xs">
                  {(['all', 'official', 'news', 'social'] as const).map((st) => (
                    <button
                      key={st}
                      onClick={() => setSourceType(st)}
                      className={`flex-1 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer capitalize text-center ${
                        filters.sourceType === st
                          ? 'bg-[#1E3A5F] text-white'
                          : 'text-[#6B7280] hover:text-[#14181F]'
                      }`}
                    >
                      {st}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 3. Verified Switch & Category Multi-Select */}
            <div className="space-y-3">
              <div>
                <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1.5">
                  VERIFICATION STATUS:
                </span>
                <label className="flex items-center gap-2 cursor-pointer bg-[#F7F8FA] border border-[#E4E7EC] p-2 rounded hover:bg-gray-100 transition-colors">
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
                  <span
                    className={`text-xs font-semibold ${
                      filters.verifiedOnly ? 'text-[#2563EB]' : 'text-[#6B7280]'
                    }`}
                  >
                    SHOW VERIFIED OFFICIAL & NEWS SOURCES ONLY
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* 4. Category Pills Row */}
          <div>
            <span className="text-[11px] font-bold text-[#6B7280] uppercase tracking-wider block mb-1.5">
              DISASTER CATEGORIES:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {CATEGORIES.map((cat) => {
                const isSelected = filters.categories.includes(cat);
                const label = CATEGORY_CONFIG[cat]?.label || cat;
                return (
                  <button
                    key={cat}
                    onClick={() => toggleCategory(cat)}
                    className={`text-xs px-3 py-1 rounded-full border flex items-center gap-1.5 transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-[#1E3A5F] text-white border-[#1E3A5F] font-semibold'
                        : 'bg-[#F7F8FA] text-[#6B7280] border-[#E4E7EC] hover:text-[#14181F] hover:bg-gray-100'
                    }`}
                  >
                    {getCategoryIcon(cat)}
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
