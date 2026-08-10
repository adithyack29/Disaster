import React, { useState, useEffect } from 'react';
import type { IncidentCluster } from '../../types/incident';
import { getSeverityConfig, getCategoryLabel } from '../../lib/severity';
import { formatTimeAgo, cleanHeadline, cleanText, formatExactTime } from '../../lib/utils';
import { MiniIncidentMap } from './MiniIncidentMap';
import { generateAISummary } from '../../lib/gemini';
import { 
  X, 
  MapPin, 
  Layers, 
  ShieldCheck, 
  Newspaper, 
  Share2, 
  Cpu, 
  UserCheck,
  Users,
  Award,
  Sparkles,
  Bot,
  Loader2,
  History,
  Zap,
  Clock,
  AlertCircle
} from 'lucide-react';

interface IncidentDetailPanelProps {
  cluster: IncidentCluster;
  onClose: () => void;
}

interface BriefMeta {
  brief: string;
  generatedAt: string;
  reportCount: number;
  source: 'gemini' | 'local_engine';
  isError?: boolean;
}

export const IncidentDetailPanel: React.FC<IncidentDetailPanelProps> = ({ cluster, onClose }) => {
  const [briefMeta, setBriefMeta] = useState<BriefMeta | null>(null);
  const [loadingAi, setLoadingAi] = useState<boolean>(false);

  useEffect(() => {
    // Reset AI brief state when switching active cluster
    setBriefMeta(null);
    setLoadingAi(false);
  }, [cluster.clusterId]);

  const handleGenerateAiSummary = async () => {
    setLoadingAi(true);

    try {
      // 1. Try Backend Server API Endpoint first
      const res = await fetch(`http://127.0.0.1:3001/api/clusters/${cluster.clusterId}/brief`, {
        method: 'POST',
      });

      if (res.ok) {
        const data = await res.json();
        setBriefMeta({
          brief: data.brief,
          generatedAt: data.generatedAt || new Date().toISOString(),
          reportCount: data.reportCount || cluster.reports.length,
          source: data.source || 'gemini',
        });
        return;
      }
    } catch (err) {
      console.warn('[IncidentDetailPanel] Backend brief endpoint unreachable. Using client AI engine...');
    }

    // 2. Client Fallback AI Engine
    try {
      const { brief, source } = await generateAISummary(cluster);
      setBriefMeta({
        brief,
        generatedAt: new Date().toISOString(),
        reportCount: cluster.reports.length,
        source: source === 'gemini' ? 'gemini' : 'local_engine',
      });
    } catch (err) {
      console.error('[IncidentDetailPanel] Failed to generate AI summary:', err);
      setBriefMeta({
        brief: 'Summary unavailable right now.',
        generatedAt: new Date().toISOString(),
        reportCount: cluster.reports.length,
        source: 'local_engine',
        isError: true,
      });
    } finally {
      setLoadingAi(false);
    }
  };

  const sevCfg = getSeverityConfig(cluster.highestSeverity);
  const categoryLabel = getCategoryLabel(cluster.category);

  // Representative Report lookup
  const representativeReport =
    cluster.reports.find((r) => r.id === cluster.representativeReportId) ||
    cluster.reports[0];

  const renderSourceTypeIcon = (type: string) => {
    switch (type) {
      case 'official': return <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />;
      case 'news': return <Newspaper className="w-3.5 h-3.5 text-[#1E3A5F]" />;
      case 'social': return <Share2 className="w-3.5 h-3.5 text-purple-600" />;
      case 'sensor': return <Cpu className="w-3.5 h-3.5 text-emerald-600" />;
      case 'citizen': return <UserCheck className="w-3.5 h-3.5 text-amber-600" />;
      default: return <ShieldCheck className="w-3.5 h-3.5 text-[#2563EB]" />;
    }
  };

  return (
    <div className="h-full bg-[#FFFFFF] border-l border-[#E4E7EC] shadow-xl flex flex-col font-sans-ui text-[#14181F] overflow-hidden">
      {/* 1. Panel Header */}
      <div className="py-3 px-4 border-b border-[#E4E7EC] flex items-center justify-between bg-[#F7F8FA]">
        <div className="flex items-center gap-2 truncate">
          <span className="w-2.5 h-2.5 rounded-full animate-pulse shrink-0" style={{ backgroundColor: sevCfg.color }} />
          <span className="font-mono-data text-xs font-bold uppercase tracking-wider text-[#14181F] truncate">
            INCIDENT DOSSIER #{cluster.clusterId.replace(/[^a-zA-Z0-9]/g, '-').toUpperCase().slice(0, 16)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-[#6B7280] hover:text-[#14181F] hover:bg-gray-200 transition-colors cursor-pointer"
          title="Close panel"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Map Header Component */}
        <div className="rounded-xl overflow-hidden border border-[#E4E7EC]">
          <MiniIncidentMap
            location={cluster.centerLocation}
            severity={cluster.highestSeverity}
            title={cleanHeadline(representativeReport?.headline || cluster.title)}
          />
        </div>

        {/* 2. Main Dossier Headline & Location */}
        <div className="space-y-2">
          <h2 className="text-xl font-extrabold text-[#14181F] leading-tight tracking-tight">
            {cleanHeadline(representativeReport?.headline || cluster.title)}
          </h2>

          <div className="flex items-center gap-1.5 text-xs text-[#6B7280] font-sans-ui font-semibold">
            <MapPin className="w-4 h-4 text-[#1E3A5F] shrink-0" />
            <span>
              {cluster.centerLocation.placeName}, {cluster.centerLocation.state} — India
            </span>
          </div>

          {/* Badges & Explicit Timestamp Labels Row */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span
              className="inline-flex items-center gap-1.5 text-xs font-bold px-2.5 py-0.5 rounded text-white uppercase shadow-2xs"
              style={{ backgroundColor: sevCfg.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              <span>{sevCfg.label}</span>
            </span>

            <span className="text-xs font-semibold text-[#1E3A5F] bg-[#F7F8FA] px-2.5 py-0.5 rounded border border-[#E4E7EC]">
              {categoryLabel}
            </span>

            {/* Explicit Timestamp Labels (Requirement #4) */}
            <div className="flex items-center gap-2 text-xs font-mono-data text-[#6B7280]">
              <span title={`First reported: ${cluster.firstReportedAt}`}>
                First reported {formatTimeAgo(cluster.firstReportedAt)}
              </span>
              <span>•</span>
              <span className="font-semibold text-[#1E3A5F]" title={`Latest update: ${cluster.lastReportedAt || cluster.firstReportedAt}`}>
                Latest update {formatTimeAgo(cluster.lastReportedAt || cluster.firstReportedAt)}
              </span>
            </div>
          </div>
        </div>

        {/* 3. On-Demand AI Situation Brief Section */}
        <div className="pt-2 border-t border-[#E4E7EC]">
          {!briefMeta ? (
            <button
              onClick={handleGenerateAiSummary}
              disabled={loadingAi}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-slate-900 to-[#1E3A5F] hover:from-slate-800 hover:to-[#152a45] text-amber-400 font-bold text-xs rounded-xl shadow-xs border border-slate-800 transition-all cursor-pointer group disabled:opacity-75"
            >
              {loadingAi ? (
                <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
              ) : (
                <Sparkles className="w-4 h-4 text-amber-400 group-hover:scale-110 transition-transform" />
              )}
              <span>{loadingAi ? 'SYNTHESIZING BRIEF...' : 'VIEW AI SITUATION BRIEF'}</span>
            </button>
          ) : (
            <div className="bg-slate-950 text-white rounded-xl p-4 space-y-2.5 shadow-md border border-slate-800">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
                    AI Incident Situation Brief
                  </h3>
                </div>
                <span className="inline-flex items-center gap-1 text-[10px] font-mono-data font-semibold text-slate-300 bg-slate-900 px-2 py-0.5 rounded border border-slate-700">
                  <Bot className="w-3 h-3 text-amber-400" />
                  <span>{briefMeta.source === 'gemini' ? 'Google Gemini 1.5' : 'AI Intel Engine'}</span>
                </span>
              </div>

              {briefMeta.isError ? (
                <div className="flex items-center gap-2 py-2 text-xs text-red-400 font-semibold font-mono-data">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>Summary unavailable right now.</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-slate-200 leading-relaxed font-sans-ui whitespace-pre-line">
                    {briefMeta.brief}
                  </p>

                  {/* Persistent Traceability Label (Requirement #3) */}
                  <div className="pt-2 border-t border-slate-800 text-[10px] font-mono-data text-amber-400/90 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-amber-400 shrink-0" />
                    <span>
                      AI-generated summary — synthesized from {briefMeta.reportCount} source reports, generated at {formatExactTime(briefMeta.generatedAt)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3.5 Status Changes & Audit Log */}
        {cluster.history && cluster.history.length > 0 && (
          <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 space-y-2 text-xs">
            <div className="flex items-center gap-1.5 font-bold text-amber-900 uppercase tracking-wider text-[11px]">
              <History className="w-3.5 h-3.5 text-amber-700" />
              <span>Status Changes & System Audit Log</span>
            </div>

            <div className="space-y-2 max-h-[150px] overflow-y-auto pr-1">
              {cluster.history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 bg-white/80 border border-amber-200/80 p-2 rounded-lg text-amber-950 font-sans-ui shadow-2xs"
                >
                  <Zap className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-amber-900">
                        {entry.field === 'severity' ? 'Severity Shift' : 'Headline Selected'}
                      </span>
                      <span className="text-[10px] font-mono-data text-amber-700">
                        {formatTimeAgo(entry.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-800 leading-snug">
                      {entry.reason || `${entry.previousValue} → ${entry.newValue}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 4. Aggregated Report Timeline Stream */}
        <div className="space-y-3 pt-2 border-t border-[#E4E7EC]">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#1E3A5F] flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-[#1E3A5F]" />
              <span>Aggregated Telemetry Stream ({cluster.reports.length})</span>
            </h3>
            <span className="text-[11px] font-mono-data font-semibold text-[#6B7280]">
              Newest first
            </span>
          </div>

          {/* Vertical Timeline Container */}
          <div className="space-y-3 max-h-[340px] overflow-y-auto pr-1.5 py-1 scrollbar-thin">
            {[...cluster.reports]
              .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
              .map((rep, idx) => (
              <div
                key={rep.id || idx}
                className={`border rounded-lg p-3 space-y-2 text-xs relative shrink-0 ${
                  rep.id === cluster.representativeReportId
                    ? 'bg-blue-50/70 border-blue-200'
                    : 'bg-[#F7F8FA] border-[#E4E7EC]'
                }`}
              >
                {/* Timeline Header Row */}
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 truncate">
                    {renderSourceTypeIcon(rep.source.type)}
                    <span className="font-bold text-[#14181F] truncate">{rep.source.name}</span>
                    {rep.id === cluster.representativeReportId && (
                      <span className="text-[9px] font-mono-data font-bold text-blue-700 bg-blue-100 px-1 py-0.2 rounded">
                        LEAD HEADLINE
                      </span>
                    )}
                    {rep.classificationMethod === 'ai' && (
                      <span className="text-[9px] font-mono-data font-bold text-indigo-700 bg-indigo-100 px-1 py-0.2 rounded flex items-center gap-0.5">
                        <Sparkles className="w-2.5 h-2.5 text-indigo-600 shrink-0" />
                        AI-ASSISTED
                      </span>
                    )}
                  </div>

                  <span className="font-mono-data tabular-nums text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 shrink-0">
                    SCORE: {rep.credibilityScore}%
                  </span>
                </div>

                {/* Report Text Snippet */}
                <p className="text-[#6B7280] leading-relaxed font-sans-ui">
                  {cleanText(rep.description || rep.headline)}
                </p>

                {/* Report Footer Time */}
                <div className="text-[10px] font-mono-data text-[#6B7280] text-right">
                  {formatTimeAgo(rep.timestamp)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Incident Telemetry Summary Metrics Box */}
        <div className="bg-[#F7F8FA] border border-[#E4E7EC] rounded-xl p-3.5 space-y-2 text-xs font-sans-ui">
          <h4 className="font-bold text-[#1E3A5F] uppercase text-[11px] tracking-wider">
            Incident Telemetry Summary
          </h4>
          <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
            <div className="flex items-center gap-1.5 text-[#6B7280]">
              <Users className="w-3.5 h-3.5 text-[#1E3A5F]" />
              <span>
                Affected Pop:{' '}
                <strong className="text-[#14181F]">
                  {cluster.totalAffectedEstimate > 0
                    ? cluster.totalAffectedEstimate.toLocaleString('en-IN')
                    : 'Estimating'}
                </strong>
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[#6B7280]">
              <Award className="w-3.5 h-3.5 text-[#1E3A5F]" />
              <span>
                Cluster Credibility:{' '}
                <strong className="text-emerald-700 font-mono-data">
                  {Math.round(
                    cluster.reports.reduce((acc, r) => acc + r.credibilityScore, 0) /
                      (cluster.reports.length || 1)
                  )}
                  %
                </strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
