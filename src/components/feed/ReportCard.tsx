import React, { useState, useEffect } from 'react';
import type { DisasterReport } from '../../types/incident';
import { getSeverityConfig, getCategoryLabel } from '../../lib/severity';
import { formatTimeAgo } from '../../lib/utils';
import { 
  ShieldCheck, 
  Newspaper, 
  Share2, 
  AlertTriangle, 
  MapPin, 
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface ReportCardProps {
  report: DisasterReport;
  clusterReports?: DisasterReport[];
  isSelected?: boolean;
  onClick?: () => void;
}

export const ReportCard: React.FC<ReportCardProps> = ({
  report,
  clusterReports = [],
  isSelected = false,
  onClick,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Live relative time ticking timer: Re-calculates formatTimeAgo every 30 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const sevCfg = getSeverityConfig(report.severity);
  const categoryLabel = getCategoryLabel(report.category);

  const clusterCount = clusterReports.length > 0 ? clusterReports.length : 1;

  // Source icon & badge style using Inter (font-sans-ui)
  const renderSourceBadge = () => {
    switch (report.source.type) {
      case 'official':
        return (
          <span className="flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-[#2563EB] bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />
            <span>OFFICIAL ({report.source.name})</span>
          </span>
        );
      case 'news':
        return (
          <span className="flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-[#1E3A5F] bg-gray-100 px-2 py-0.5 rounded border border-gray-200">
            <Newspaper className="w-3.5 h-3.5 text-[#1E3A5F]" />
            <span>NEWS ({report.source.name})</span>
          </span>
        );
      case 'social':
        return (
          <span className="flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-[#6B7280] bg-gray-50 px-2 py-0.5 rounded border border-gray-200">
            <Share2 className="w-3.5 h-3.5 text-[#6B7280]" />
            <span>SOCIAL ({report.source.name})</span>
          </span>
        );
    }
  };

  const getCredibilityColor = (score: number) => {
    if (score >= 90) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (score >= 75) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  return (
    <article
      tabIndex={0}
      role="button"
      onClick={onClick}
      className={`group relative bg-[#FFFFFF] border rounded p-3.5 transition-all cursor-pointer outline-hidden ${
        isSelected
          ? 'border-[#1E3A5F] ring-2 ring-[#1E3A5F] shadow-sm bg-white'
          : 'border-[#E4E7EC] hover:border-[#1E3A5F] hover:shadow-xs'
      }`}
    >
      {/* Functional Left Edge Severity Bar */}
      <div
        className="absolute top-0 left-0 bottom-0 w-1.5 rounded-l"
        style={{ backgroundColor: sevCfg.color }}
      />

      <div className="pl-2">
        {/* Top Metadata Row: Severity Badge + Category Tag + Relative Time */}
        <div className="flex flex-wrap items-center justify-between gap-1.5 mb-2">
          <div className="flex items-center gap-1.5">
            {/* Severity Pill (Inter font) */}
            <span
              className="text-xs font-sans-ui font-bold px-2 py-0.5 rounded text-white flex items-center gap-1"
              style={{ backgroundColor: sevCfg.color }}
            >
              {report.severity === 'critical' && <AlertTriangle className="w-3 h-3 text-white" />}
              <span>{sevCfg.label}</span>
            </span>

            {/* Category Tag (Inter font) */}
            <span className="text-xs font-sans-ui font-medium text-[#1E3A5F] bg-[#F7F8FA] px-2 py-0.5 rounded border border-[#E4E7EC]">
              {categoryLabel}
            </span>

            {/* Language Tag if not English */}
            {report.language !== 'en' && (
              <span className="text-[10px] font-sans-ui font-bold text-[#6B7280] bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200 uppercase">
                {report.language}
              </span>
            )}

            {/* Deduplicated Cluster count badge if multiple reports */}
            {clusterCount > 1 && (
              <span className="flex items-center gap-1 text-[11px] font-sans-ui font-bold text-[#1E3A5F] bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                <Layers className="w-3.5 h-3.5 text-[#1E3A5F]" />
                <span className="font-mono-data tabular-nums">{clusterCount}</span>
                <span>REPORTS IN EVENT</span>
              </span>
            )}
          </div>

          {/* Timestamp (IBM Plex Mono font with tabular-nums to prevent reflow) */}
          <time className="text-[11px] font-mono-data tabular-nums text-[#6B7280] font-medium shrink-0 min-w-[70px] text-right">
            {formatTimeAgo(report.timestamp)}
          </time>
        </div>

        {/* Headline */}
        <h3 className="text-sm font-semibold text-[#14181F] leading-snug mb-1 font-sans-ui group-hover:text-[#1E3A5F] transition-colors">
          {report.headline}
        </h3>

        {/* Description snippet */}
        <p className="text-xs text-[#6B7280] leading-relaxed line-clamp-2 mb-2.5 font-sans-ui">
          {report.description}
        </p>

        {/* Action Required Banner if specified */}
        {report.actionRequired && (
          <div className="bg-red-50 border border-red-200 text-[#DC2626] text-xs font-sans-ui font-semibold p-2 rounded mb-2.5 flex items-start gap-1.5">
            <span className="font-bold uppercase shrink-0 font-sans-ui">DISPATCH REQ:</span>
            <span>{report.actionRequired}</span>
          </div>
        )}

        {/* Bottom Row: Location + Source + Credibility Score */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E4E7EC]">
          {/* Location */}
          <div className="flex items-center gap-1 text-xs font-sans-ui text-[#6B7280]">
            <MapPin className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
            <span className="font-medium text-[#14181F]">{report.location.placeName}</span>
            <span>({report.location.state})</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Source Tag */}
            {renderSourceBadge()}

            {/* Credibility Badge (IBM Plex Mono score) */}
            <span
              className={`text-[10px] font-mono-data tabular-nums font-bold px-1.5 py-0.5 rounded border ${getCredibilityColor(
                report.credibilityScore
              )}`}
              title="Calculated source credibility score (0-100)"
            >
              SCORE: {report.credibilityScore}
            </span>

            {/* Toggle expandable cluster list button if multiple reports */}
            {clusterCount > 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsExpanded(!isExpanded);
                }}
                className="flex items-center gap-0.5 text-xs text-[#1E3A5F] hover:underline font-semibold font-sans-ui p-0.5"
              >
                <span>{isExpanded ? 'Hide' : 'Expand'} ({clusterCount})</span>
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
        </div>

        {/* Expanded Clustered Sub-reports Timeline */}
        {isExpanded && clusterReports.length > 1 && (
          <div
            className="mt-3 pt-3 border-t border-dashed border-[#E4E7EC] space-y-2 bg-[#F7F8FA] p-2.5 rounded"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[10px] font-sans-ui font-bold text-[#6B7280] uppercase tracking-wider mb-1">
              CORROBORATING REPORTS FOR THIS EVENT ({clusterReports.length}):
            </div>
            {clusterReports.map((subRep) => (
              <div
                key={subRep.id}
                className="bg-white p-2 rounded border border-[#E4E7EC] text-xs font-sans-ui space-y-1"
              >
                <div className="flex items-center justify-between text-[10px]">
                  <span className="font-semibold text-[#1E3A5F]">{subRep.source.name}</span>
                  <span className="font-mono-data tabular-nums text-[#6B7280]">
                    {formatTimeAgo(subRep.timestamp)}
                  </span>
                </div>
                <div className="font-medium text-[#14181F]">{subRep.headline}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
};
