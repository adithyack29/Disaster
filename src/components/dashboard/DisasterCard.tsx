import React from 'react';
import { motion } from 'framer-motion';
import type { IncidentCluster } from '../../types/incident';
import { getSeverityConfig, getCategoryLabel } from '../../lib/severity';
import { formatTimeAgo, cleanHeadline, cleanText } from '../../lib/utils';
import { 
  Waves, 
  Flame, 
  Activity, 
  Wind, 
  Building2, 
  Cross, 
  Mountain,
  Layers,
  MapPin,
  ShieldCheck,
  Newspaper,
  Share2,
  Cpu,
  UserCheck,
  ArrowRight,
  Zap,
  Sparkles
} from 'lucide-react';

interface DisasterCardProps {
  cluster: IncidentCluster;
  onClick?: (clusterId: string) => void;
}

export const DisasterCard: React.FC<DisasterCardProps> = ({ cluster, onClick }) => {
  // Live relative time ticking timer: Re-calculates formatTimeAgo every 30 seconds
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, []);

  const sevCfg = getSeverityConfig(cluster.highestSeverity);
  const categoryLabel = getCategoryLabel(cluster.category);

  // Safeguard: Always look up the live-selected representative report backing this headline
  const representativeReport = 
    cluster.reports.find((r) => r.id === cluster.representativeReportId) || 
    cluster.reports[0];

  const leadReport = representativeReport;

  // Format State Name cleanly (e.g., "Madhya Pradesh", "Kerala", "Assam")
  const stateName = cluster.centerLocation.state
    ? cluster.centerLocation.state
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    : 'India';

  // Category Icon helper
  const renderCategoryIcon = (className = 'w-3.5 h-3.5') => {
    switch (cluster.category) {
      case 'flood': return <Waves className={className} />;
      case 'fire': return <Flame className={className} />;
      case 'earthquake': return <Activity className={className} />;
      case 'cyclone': return <Wind className={className} />;
      case 'building_collapse': return <Building2 className={className} />;
      case 'medical': return <Cross className={className} />;
      case 'landslide': return <Mountain className={className} />;
    }
  };

  // Visually distinct Source Type badge
  const renderSourceBadge = () => {
    const sourceType = leadReport?.source?.type || 'official';
    const sourceName = leadReport?.source?.name || 'NDRF Telemetry';

    switch (sourceType) {
      case 'official':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-[#2563EB] bg-blue-50 px-2 py-0.5 rounded border border-blue-200 truncate">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB] shrink-0" />
            <span className="truncate">OFFICIAL ({sourceName})</span>
          </span>
        );
      case 'news':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-[#1E3A5F] bg-gray-100 px-2 py-0.5 rounded border border-gray-200 truncate">
            <Newspaper className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
            <span className="truncate">NEWS ({sourceName})</span>
          </span>
        );
      case 'social':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200 truncate">
            <Share2 className="w-3.5 h-3.5 text-purple-600 shrink-0" />
            <span className="truncate">SOCIAL ({sourceName})</span>
          </span>
        );
      case 'sensor':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 truncate">
            <Cpu className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span className="truncate">SENSOR ({sourceName})</span>
          </span>
        );
      case 'citizen':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-sans-ui font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 truncate">
            <UserCheck className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">CITIZEN ({sourceName})</span>
          </span>
        );
    }
  };

  // Credibility score color style
  const score = leadReport?.credibilityScore || 95;
  const getCredibilityStyle = (s: number) => {
    if (s >= 90) return 'text-emerald-700 bg-emerald-50 border-emerald-200';
    if (s >= 75) return 'text-amber-700 bg-amber-50 border-amber-200';
    return 'text-red-700 bg-red-50 border-red-200';
  };

  const handleClick = () => {
    console.log(`[DisasterCard] Clicked incident cluster ID: ${cluster.clusterId}`);
    if (onClick) {
      onClick(cluster.clusterId);
    }
  };

  const isRecentlyUpdated = cluster.hasRecentUpdate || (cluster.history && cluster.history.length > 0);

  return (
    <article
      onClick={handleClick}
      tabIndex={0}
      role="button"
      className="group relative bg-[#FFFFFF] border-2 border-[#E4E7EC] hover:border-[#1E3A5F] rounded-xl px-5 py-5 transition-all hover:shadow-md cursor-pointer flex flex-col justify-between font-sans-ui outline-hidden min-h-[340px] space-y-3.5 overflow-hidden"
    >
      {/* Functional Left Edge Severity Bar */}
      <div
        className="absolute top-0 left-0 bottom-0 w-2.5 rounded-l-xl"
        style={{ backgroundColor: sevCfg.color }}
      />

      <div className="pl-3 flex-1 flex flex-col justify-between space-y-3.5">
        {/* Top Metadata Row: Severity Badge + Category Tag + Updated Badge + Time Badge */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5">
              {/* Severity Badge with Motion Soft Flash */}
              <motion.span
                animate={isRecentlyUpdated ? { scale: [1, 1.05, 1] } : {}}
                transition={{ duration: 1.2, ease: 'easeInOut' }}
                className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-md text-white shadow-2xs"
                style={{ backgroundColor: sevCfg.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                <span>{sevCfg.label}</span>
              </motion.span>

              {/* Category Tag */}
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1E3A5F] bg-[#F7F8FA] px-2.5 py-1 rounded-md border border-[#E4E7EC]">
                {renderCategoryIcon('w-3.5 h-3.5 text-[#1E3A5F]')}
                <span>{categoryLabel}</span>
              </span>

              {/* Updated Badge */}
              {isRecentlyUpdated && (
                <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded border border-amber-300 shadow-2xs">
                  <Zap className="w-3 h-3 text-amber-600 animate-pulse shrink-0" />
                  <span>UPDATED</span>
                </span>
              )}
            </div>

            {/* Primary Timestamp explicitly labeled as Updated */}
            <span className="text-xs font-mono-data tabular-nums font-semibold text-[#6B7280] shrink-0" title={`Last updated: ${cluster.lastReportedAt || cluster.firstReportedAt}`}>
              Updated {formatTimeAgo(cluster.lastReportedAt || cluster.firstReportedAt)}
            </span>
          </div>

          {/* Visually Distinct Source Tag + AI-Assisted Tag + Credibility Score Badge */}
          <div className="flex items-center gap-2 max-w-full truncate">
            {renderSourceBadge()}

            {leadReport?.classificationMethod === 'ai' && (
              <span
                className="text-[10px] font-mono-data font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded shrink-0 flex items-center gap-1"
                title="Structured entities & signal extracted via Google Gemini AI"
              >
                <Sparkles className="w-3 h-3 text-indigo-600 shrink-0" />
                <span>AI-ASSISTED</span>
              </span>
            )}

            <span
              className={`text-[11px] font-mono-data tabular-nums font-bold px-2 py-0.5 rounded border shrink-0 ${getCredibilityStyle(score)}`}
              title="Algorithmic Credibility Score (0-100)"
            >
              SCORE: {score}%
            </span>
          </div>
        </div>

        {/* Title Line: Headline Spans Full Width Cleanly (No State Badge Next to Title) */}
        <div className="w-full leading-snug">
          <motion.h3
            animate={isRecentlyUpdated ? { opacity: [0.8, 1] } : {}}
            transition={{ duration: 0.8 }}
            className="font-bold text-[#14181F] group-hover:text-[#1E3A5F] transition-colors line-clamp-2 w-full tracking-tight text-base md:text-lg"
          >
            {cleanHeadline(representativeReport.headline)}
          </motion.h3>
        </div>

        {/* Detailed Description Body */}
        {representativeReport.description && (
          <p className="text-xs md:text-sm text-[#6B7280] leading-relaxed line-clamp-2 md:line-clamp-3 font-sans-ui overflow-hidden text-ellipsis my-1">
            {cleanText(representativeReport.description)}
          </p>
        )}

        {/* Bottom Row: State Name ONLY (No full location string) + Report Count + Action Affordance */}
        <div className="flex items-center justify-between gap-2 pt-3 border-t border-[#E4E7EC] shrink-0">
          <div className="text-[#6B7280] truncate flex-1 min-w-0 font-sans-ui text-xs md:text-sm flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-[#1E3A5F] shrink-0" />
            <span className="font-bold text-[#14181F] truncate">{stateName}</span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <span className="inline-flex items-center gap-1 text-xs font-mono-data tabular-nums font-bold text-[#1E3A5F] bg-indigo-50 px-2.5 py-1 rounded-md border border-indigo-200">
              <Layers className="w-3.5 h-3.5 text-[#1E3A5F]" />
              <span>{cluster.reportCount} {cluster.reportCount === 1 ? 'report' : 'reports'}</span>
            </span>

            {/* Action Affordance */}
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1E3A5F] group-hover:underline">
              <span>View Details</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#1E3A5F] group-hover:translate-x-0.5 transition-transform" />
            </span>
          </div>
        </div>
      </div>
    </article>
  );
};
