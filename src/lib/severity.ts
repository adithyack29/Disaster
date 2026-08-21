import type { SeverityLevel, CategoryType } from '../types/incident';

export interface SeverityConfig {
  label: string;
  color: string; // Hex color
}

export const SEVERITY_CONFIG: Record<SeverityLevel, SeverityConfig> = {
  critical: { label: 'CRITICAL', color: '#DC2626' },
  high: { label: 'HIGH', color: '#EA580C' },
  moderate: { label: 'MODERATE', color: '#D97706' },
  low: { label: 'LOW / INFO', color: '#2563EB' },
};

export const CATEGORY_CONFIG: Record<CategoryType, { label: string }> = {
  flood: { label: 'Flood / Inundation' },
  fire: { label: 'Fire Outbreak' },
  earthquake: { label: 'Earthquake / Tremor' },
  cyclone: { label: 'Cyclone / Storm' },
  building_collapse: { label: 'Building Collapse' },
  medical: { label: 'Medical Emergency' },
  landslide: { label: 'Landslide' },
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
