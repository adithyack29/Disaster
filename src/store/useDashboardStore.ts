import { create } from 'zustand';
import type { FilterState, CategoryType, SeverityLevel } from '../types/incident';

interface DashboardStoreState {
  // Filter state
  filters: FilterState;

  lastUpdated: Date;

  // Data ingestion status: whether the current report set is genuinely live or the demo-safety
  // fallback snapshot, plus how many real live reports actually came through this fetch cycle.
  ingestionMode: 'live' | 'demo' | null;
  ingestionLiveCount: number;

  // Dashboard view mode: card grid (default) or full incident map
  viewMode: 'cards' | 'map';

  // Actions
  toggleCategory: (category: CategoryType) => void;
  toggleSeverity: (severity: SeverityLevel) => void;
  setVerifiedOnly: (verifiedOnly: boolean) => void;
  setSourceType: (sourceType: 'all' | 'official' | 'news' | 'social' | 'sensor' | 'citizen') => void;
  setRecentlyReportedOnly: (recentlyReportedOnly: boolean) => void;
  resetFilters: () => void;

  triggerRefresh: () => void;
  setIngestionStatus: (mode: 'live' | 'demo', liveCount: number) => void;
  setViewMode: (mode: 'cards' | 'map') => void;
}

const DEFAULT_FILTERS: FilterState = {
  categories: [],
  severities: [],
  verifiedOnly: false,
  recentlyReportedOnly: false,
  sourceType: 'all',
};

export const useDashboardStore = create<DashboardStoreState>((set) => ({
  filters: DEFAULT_FILTERS,
  lastUpdated: new Date(),
  ingestionMode: null,
  ingestionLiveCount: 0,
  viewMode: 'cards',

  toggleCategory: (category) =>
    set((state) => {
      const exists = state.filters.categories.includes(category);
      const newCategories = exists
        ? state.filters.categories.filter((c) => c !== category)
        : [...state.filters.categories, category];
      return { filters: { ...state.filters, categories: newCategories } };
    }),

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

  setSourceType: (sourceType) =>
    set((state) => ({ filters: { ...state.filters, sourceType } })),

  setRecentlyReportedOnly: (recentlyReportedOnly) =>
    set((state) => ({ filters: { ...state.filters, recentlyReportedOnly } })),

  resetFilters: () => set({ filters: DEFAULT_FILTERS }),

  triggerRefresh: () => set({ lastUpdated: new Date() }),

  setIngestionStatus: (mode, liveCount) => set({ ingestionMode: mode, ingestionLiveCount: liveCount }),

  setViewMode: (viewMode) => set({ viewMode }),
}));
