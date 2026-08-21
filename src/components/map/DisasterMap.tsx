import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { DisasterReport } from '../../types/incident';
import { getSeverityColor, getSeverityConfig } from '../../lib/severity';
import { useDashboardStore } from '../../store/useDashboardStore';
import { formatCoordinates, formatTimeAgo } from '../../lib/utils';
import { MapPin, ShieldCheck, ChevronRight, Eye } from 'lucide-react';

interface DisasterMapProps {
  reports: DisasterReport[];
  selectedReportId?: string | null;
  onSelectReport: (report: DisasterReport) => void;
}

// Controller component to listen to map zoom changes and fly to selected report
const MapZoomAndFlyController: React.FC<{
  selectedReport?: DisasterReport | null;
  onZoomChange: (zoom: number) => void;
}> = ({ selectedReport, onZoomChange }) => {
  const map = useMapEvents({
    zoomend() {
      onZoomChange(map.getZoom());
    },
  });

  useEffect(() => {
    if (selectedReport && selectedReport.location) {
      map.flyTo([selectedReport.location.lat, selectedReport.location.lng], 9, {
        duration: 1.2,
      });
    }
  }, [selectedReport, map]);

  return null;
};

function createMarkerIcon(report: DisasterReport, clusterCount: number, isSelected: boolean) {
  const color = getSeverityColor(report.severity);
  const size = isSelected ? 34 : 26;

  const clusterBadgeHtml = clusterCount > 1
    ? `<span style="position: absolute; top: -6px; right: -6px; background: #14181F; color: #FFFFFF; font-size: 10px; font-family: 'IBM Plex Mono', monospace; font-weight: 700; border-radius: 9999px; padding: 1px 5px; border: 1.5px solid #FFFFFF;">${clusterCount}</span>`
    : '';

  const pulseRingHtml = report.severity === 'critical'
    ? `<div class="disaster-marker-pulse" style="background-color: ${color};"></div>`
    : '';

  return L.divIcon({
    className: 'custom-disaster-marker',
    html: `
      <div style="position: relative; width: ${size}px; height: ${size}px;">
        ${pulseRingHtml}
        <div class="disaster-marker-pin" style="width: ${size}px; height: ${size}px; background-color: ${color}; border: ${isSelected ? '3px solid #14181F' : '2px solid #FFFFFF'};">
          <svg width="${size * 0.5}" height="${size * 0.5}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>
        ${clusterBadgeHtml}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

export const DisasterMap: React.FC<DisasterMapProps> = ({
  reports,
  selectedReportId,
  onSelectReport,
}) => {
  const { filters } = useDashboardStore();
  const [currentZoom, setCurrentZoom] = useState<number>(5);

  const selectedReport = reports.find((r) => r.id === selectedReportId);

  // Part 1 Step 4: Filter visible map pins based on zoom level.
  // At zoom <= 6 and when no explicit severity filter is set, show only HIGH & CRITICAL severity pins by default.
  const hasExplicitSeverityFilter = filters.severities.length > 0;
  const visibleReports = reports.filter((r) => {
    if (r.id === selectedReportId) return true; // Always show selected report
    if (hasExplicitSeverityFilter || currentZoom > 6) return true;
    return r.severity === 'critical' || r.severity === 'high';
  });

  const clusterCounts: Record<string, number> = {};
  reports.forEach((r) => {
    if (r.clusterId) {
      clusterCounts[r.clusterId] = (clusterCounts[r.clusterId] || 0) + 1;
    }
  });

  return (
    <div className="w-full h-full relative border-r border-[#E4E7EC] bg-[#EBF0F5] font-sans-ui">
      {/* Map Legend & Density Indicator Overlay */}
      <div className="absolute top-3 left-3 z-[400] bg-[#FFFFFF] border border-[#E4E7EC] p-2.5 rounded shadow-sm text-xs font-sans-ui">
        <div className="text-[10px] font-bold text-[#6B7280] uppercase tracking-wider mb-1.5 flex items-center gap-1">
          <MapPin className="w-3.5 h-3.5 text-[#1E3A5F]" />
          MAP SEVERITY PINS ({visibleReports.length}/{reports.length})
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#DC2626]" />
            <span className="text-[#14181F] font-medium">CRITICAL</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#EA580C]" />
            <span className="text-[#14181F] font-medium">HIGH</span>
          </div>
          {currentZoom > 6 || hasExplicitSeverityFilter ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#D97706]" />
                <span className="text-[#14181F] font-medium">MODERATE</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#2563EB]" />
                <span className="text-[#14181F] font-medium">LOW / INFO</span>
              </div>
            </>
          ) : (
            <div className="text-[10px] text-[#6B7280] pt-1 border-t border-[#E4E7EC] flex items-center gap-1">
              <Eye className="w-3 h-3 text-[#1E3A5F]" />
              <span>Zoom in to reveal Moderate/Low</span>
            </div>
          )}
        </div>
      </div>

      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={5}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        <MapZoomAndFlyController
          selectedReport={selectedReport}
          onZoomChange={(z) => setCurrentZoom(z)}
        />

        {visibleReports.map((report) => {
          const isSelected = report.id === selectedReportId;
          const clusterCount = clusterCounts[report.clusterId] || 1;
          const icon = createMarkerIcon(report, clusterCount, isSelected);
          const sevCfg = getSeverityConfig(report.severity);

          return (
            <Marker
              key={report.id}
              position={[report.location.lat, report.location.lng]}
              icon={icon}
              eventHandlers={{
                click: () => onSelectReport(report),
              }}
            >
              <Popup>
                <div className="p-3 max-w-[280px] font-sans-ui">
                  <div className="flex items-center justify-between mb-2">
                    <span
                      className="text-[11px] font-sans-ui font-bold px-2 py-0.5 rounded text-white"
                      style={{ backgroundColor: sevCfg.color }}
                    >
                      {sevCfg.label}
                    </span>
                    <span className="text-[11px] font-mono-data tabular-nums text-[#6B7280]">
                      {formatTimeAgo(report.timestamp)}
                    </span>
                  </div>

                  <h4 className="text-xs font-semibold text-[#14181F] leading-tight mb-1 font-sans-ui">
                    {report.headline}
                  </h4>

                  <div className="text-xs text-[#6B7280] mb-2 font-sans-ui">
                    <div>📍 {report.location.placeName}, {report.location.state}</div>
                    <div className="text-[10px] font-mono-data tabular-nums text-[#94A3B8]">
                      {formatCoordinates(report.location.lat, report.location.lng)}
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-[#F7F8FA] p-1.5 rounded border border-[#E4E7EC] mb-2.5">
                    <div className="flex items-center gap-1 text-[11px] text-[#14181F] font-sans-ui">
                      {report.source.verified && <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />}
                      <span className="font-medium">{report.source.name}</span>
                    </div>
                    <span className="text-[10px] font-mono-data tabular-nums font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                      SCORE: {report.credibilityScore}
                    </span>
                  </div>

                  <button
                    onClick={() => onSelectReport(report)}
                    className="w-full flex items-center justify-center gap-1 text-xs font-semibold text-white bg-[#1E3A5F] hover:bg-[#152a45] py-1.5 rounded transition-colors cursor-pointer font-sans-ui"
                  >
                    <span>INSPECT INCIDENT DOSSIER</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
    </div>
  );
};
