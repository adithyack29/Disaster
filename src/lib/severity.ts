import type { SeverityLevel, CategoryType } from '../types/incident';

export interface SeverityConfig {
  level: SeverityLevel;
  label: string;
  color: string; // Hex color
  bgSubtle: string;
  borderHex: string;
  badgeBg: string;
  badgeText: string;
  description: string;
  priorityOrder: number;
}

export const SEVERITY_CONFIG: Record<SeverityLevel, SeverityConfig> = {
  critical: {
    level: 'critical',
    label: 'CRITICAL',
    color: '#DC2626',
    bgSubtle: 'rgba(220, 38, 38, 0.08)',
    borderHex: '#FCA5A5',
    badgeBg: '#FEF2F2',
    badgeText: '#991B1B',
    description: 'Immediate threat to life or major structural failure. Priority dispatch.',
    priorityOrder: 1,
  },
  high: {
    level: 'high',
    label: 'HIGH',
    color: '#EA580C',
    bgSubtle: 'rgba(234, 88, 12, 0.08)',
    borderHex: '#FDBA74',
    badgeBg: '#FFF7ED',
    badgeText: '#C2410C',
    description: 'Significant disruption, expanding area, potential casualties.',
    priorityOrder: 2,
  },
  moderate: {
    level: 'moderate',
    label: 'MODERATE',
    color: '#D97706',
    bgSubtle: 'rgba(217, 119, 6, 0.08)',
    borderHex: '#FDE68A',
    badgeBg: '#FFFBEB',
    badgeText: '#B45309',
    description: 'Local impact, non-life-threatening damage, monitoring required.',
    priorityOrder: 3,
  },
  low: {
    level: 'low',
    label: 'LOW / INFO',
    color: '#2563EB',
    bgSubtle: 'rgba(37, 99, 235, 0.08)',
    borderHex: '#93C5FD',
    badgeBg: '#EFF6FF',
    badgeText: '#1D4ED8',
    description: 'Advisory, preliminary social report, or minor localized event.',
    priorityOrder: 4,
  },
};

export const CATEGORY_CONFIG: Record<CategoryType, { label: string; iconName: string }> = {
  flood: { label: 'Flood / Inundation', iconName: 'Waves' },
  fire: { label: 'Fire Outbreak', iconName: 'Flame' },
  earthquake: { label: 'Earthquake / Tremor', iconName: 'Activity' },
  cyclone: { label: 'Cyclone / Storm', iconName: 'Wind' },
  building_collapse: { label: 'Building Collapse', iconName: 'Building2' },
  medical: { label: 'Medical Emergency', iconName: 'Cross' },
  landslide: { label: 'Landslide', iconName: 'Mountain' },
};

export function getSeverityColor(severity: SeverityLevel): string {
  return SEVERITY_CONFIG[severity]?.color || '#2563EB';
}

export function getSeverityConfig(severity: SeverityLevel): SeverityConfig {
  return SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.low;
}

export function getCategoryLabel(category: CategoryType): string {
  return CATEGORY_CONFIG[category]?.label || category;
}
