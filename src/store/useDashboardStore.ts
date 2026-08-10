import { create } from 'zustand';
import type { FilterState, CategoryType, SeverityLevel } from '../types/incident';

interface DashboardStoreState {
  // Filter state
  filters: FilterState;
  
  // Selection state
  selectedIncidentId: string | null;
  selectedClusterId: string | null;
  isDetailOpen: boolean;

  // Live simulation mode
  liveMode: boolean;
  lastUpdated: Date;

  // Actions
  setCategoryFilter: (categories: CategoryType[]) => void;
  toggleCategory: (category: CategoryType) => void;
  setSeverityFilter: (severities: SeverityLevel[]) => void;
  toggleSeverity: (severity: SeverityLevel) => void;
  setVerifiedOnly: (verifiedOnly: boolean) => void;
  setRegion: (region: string) => void;
  setSearchQuery: (query: string) => void;
  setTimeRange: (timeRange: [number, number] | null) => void;
  setSourceType: (sourceType: 'all' | 'official' | 'news' | 'social' | 'sensor' | 'citizen') => void;
  setRecentlyReportedOnly: (recentlyReportedOnly: boolean) => void;
  resetFilters: () => void;

  setSelectedIncident: (id: string | null, clusterId?: string | null) => void;
  closeDetail: () => void;
  toggleLiveMode: () => void;
  triggerRefresh: () => void;
}

const DEFAULT_FILTERS: FilterState = {
  categories: [],
  severities: [],
  verifiedOnly: false,
  recentlyReportedOnly: false,
  region: 'all',
  searchQuery: '',
  timeRange: null,
  sourceType: 'all',
};

export const useDashboardStore = create<DashboardStoreState>((set) => ({
  filters: DEFAULT_FILTERS,
  selectedIncidentId: null,
  selectedClusterId: null,
  isDetailOpen: false,
  liveMode: true,
  lastUpdated: new Date(),

  setCategoryFilter: (categories) =>
    set((state) => ({ filters: { ...state.filters, categories } })),

  toggleCategory: (category) =>
    set((state) => {
      const exists = state.filters.categories.includes(category);
      const newCategories = exists
        ? state.filters.categories.filter((c) => c !== category)
        : [...state.filters.categories, category];
      return { filters: { ...state.filters, categories: newCategories } };
    }),

  setSeverityFilter: (severities) =>
    set((state) => ({ filters: { ...state.filters, severities } })),

  toggleSeverity: (severity) =>
    set((state) => {
      const exists = state.filters.severities.includes(severity);
      const newSeverities = exists
        ? state.filters.severities.filter((s) => s !== severity)
        : [...state.filters.severities, severity];
      return { filters: { ...state.filters, severities: newSeverities } };
    }),

  setVerifiedOnly: (verifiedOnly) =>
    set((state) => ({ filters: { ...state.filters, verifiedOnly } })),

  setRegion: (region) =>
    set((state) => ({ filters: { ...state.filters, region } })),

  setSearchQuery: (searchQuery) =>
    set((state) => ({ filters: { ...state.filters, searchQuery } })),

  setTimeRange: (timeRange) =>
    set((state) => ({ filters: { ...state.filters, timeRange } })),

  setSourceType: (sourceType) =>
    set((state) => ({ filters: { ...state.filters, sourceType } })),

  setRecentlyReportedOnly: (recentlyReportedOnly) =>
    set((state) => ({ filters: { ...state.filters, recentlyReportedOnly } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  setSelectedIncident: (id, clusterId = null) =>
    set({
      selectedIncidentId: id,
      selectedClusterId: clusterId,
      isDetailOpen: id !== null,
    }),

  closeDetail: () => set({ selectedIncidentId: null, isDetailOpen: false }),

  toggleLiveMode: () => set((state) => ({ liveMode: !state.liveMode })),

  triggerRefresh: () => set({ lastUpdated: new Date() }),
}));
