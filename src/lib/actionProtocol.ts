import type { CategoryType, SeverityLevel } from '../types/incident';

/**
 * Deterministic, rule-based dispatch guidance — category × severity lookup, not AI-generated
 * free text. Keeps to the project's "AI explains, rules decide" principle: Gemini classifies
 * and summarizes, but the actual action recommendation is a fixed table an operator can audit,
 * not a synthesized sentence that could hallucinate a resource that doesn't exist.
 *
 * This is explicitly labeled "Suggested Response Protocol" wherever it's shown — it is standard
 * NDRF-style doctrine for a category/severity combination, not a claim that a real agency issued
 * this specific order for this specific incident (only `report.actionRequired`, when a source
 * literally states one, gets attributed to that source).
 */
const PROTOCOL_TABLE: Record<CategoryType, Partial<Record<SeverityLevel, string>>> = {
  flood: {
    critical: 'Deploy NDRF water rescue teams with boats; evacuate low-lying areas; alert downstream districts.',
    high: 'Pre-position rescue boats and pumps; issue evacuation advisory for flood-prone zones.',
    moderate: 'Monitor water levels; alert local disaster management authority.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
  fire: {
    critical: 'Dispatch fire tenders and hazmat units; evacuate surrounding structures; establish exclusion perimeter.',
    high: 'Dispatch fire tenders; alert nearby hospitals for potential burn/smoke-inhalation casualties.',
    moderate: 'Notify local fire station; monitor for escalation.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
  earthquake: {
    critical: 'Deploy NDRF search-and-rescue with heavy cutting/rescue equipment; assess structural damage citywide.',
    high: 'Dispatch structural assessment teams; open emergency shelters near epicenter.',
    moderate: 'Alert regional disaster cells; monitor for aftershocks.',
    low: 'Log for seismic monitoring; no immediate dispatch required.',
  },
  cyclone: {
    critical: 'Activate coastal evacuation protocol; deploy NDRF battalions to landfall zone; suspend transport.',
    high: 'Pre-position relief teams near projected landfall; issue coastal advisory.',
    moderate: 'Monitor IMD track updates; alert fishing communities.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
  building_collapse: {
    critical: 'Deploy NDRF heavy rescue with sniffer dogs and acoustic sensors; establish medical triage on-site.',
    high: 'Dispatch rescue team and ambulances; cordon off structurally unsafe area.',
    moderate: 'Notify municipal building safety authority for inspection.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
  medical: {
    critical: 'Deploy mobile medical units and ambulances; activate nearest trauma center surge protocol.',
    high: 'Alert district hospitals; dispatch ambulance backup to affected area.',
    moderate: 'Notify local health authority for monitoring.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
  landslide: {
    critical: 'Deploy NDRF rescue with earthmovers; evacuate downhill settlements; close affected roads.',
    high: 'Dispatch road-clearance teams; issue advisory for nearby slopes.',
    moderate: 'Monitor slope stability; alert local authority.',
    low: 'Log for situational awareness; no immediate dispatch required.',
  },
};

export function getSuggestedProtocol(category: CategoryType, severity: SeverityLevel): string {
  return PROTOCOL_TABLE[category]?.[severity] || 'Monitor and log; escalate if new reports confirm severity.';
}
