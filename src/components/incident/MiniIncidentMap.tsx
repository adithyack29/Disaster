import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { LocationInfo, SeverityLevel } from '../../types/incident';
import { getSeverityColor } from '../../lib/severity';

interface MiniIncidentMapProps {
  location: LocationInfo;
  severity: SeverityLevel;
  title: string;
}

export const MiniIncidentMap: React.FC<MiniIncidentMapProps> = ({
  location,
  severity,
  title,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clean up existing map instance if any
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const { lat, lng } = location;
    const color = getSeverityColor(severity);

    // Initialize Leaflet map
    const map = L.map(containerRef.current, {
      center: [lat, lng],
      zoom: 8,
      minZoom: 4, // Allow zooming out to full India bounds
      maxZoom: 14,
      scrollWheelZoom: true,
      zoomControl: true,
    });

    // Add CartoDB Positron / OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19,
    }).addTo(map);

    // Custom severity-colored SVG pulse marker
    const customIcon = L.divIcon({
      className: 'custom-leaflet-marker',
      html: `
        <div style="
          position: relative;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="
            position: absolute;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            background-color: ${color};
            opacity: 0.4;
            animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;
          "></div>
          <div style="
            position: relative;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background-color: ${color};
            border: 2.5px solid #FFFFFF;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
          "></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    L.marker([lat, lng], { icon: customIcon })
      .addTo(map)
      .bindPopup(
        `<div style="font-family: sans-serif; font-size: 12px; font-weight: bold; color: #14181F;">${title}</div>`
      );

    mapRef.current = map;

    // Trigger map resize check to ensure tile rendering inside animated containers
    const timer = setTimeout(() => {
      map.invalidateSize();
    }, 200);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [location.lat, location.lng, severity, title]);

  return (
    <div className="w-full h-[210px] rounded-lg overflow-hidden border border-[#E4E7EC] relative shadow-2xs">
      <div ref={containerRef} className="w-full h-full z-0" />
      {/* Map Header Overlay */}
      <div className="absolute top-2 left-2 z-10 bg-white/90 backdrop-blur-xs text-[#1E3A5F] text-[11px] font-mono-data font-bold px-2 py-0.5 rounded border border-[#E4E7EC] shadow-2xs">
        📍 {location.placeName}, {location.state} ({location.lat.toFixed(3)}°, {location.lng.toFixed(3)}°)
      </div>
    </div>
  );
};
