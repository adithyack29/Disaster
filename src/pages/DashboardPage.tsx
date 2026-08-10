import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDashboardStore } from '../store/useDashboardStore';
import type { IncidentCluster, DashboardStats, PulseBucket, DisasterReport } from '../types/incident';
import { getReports, getStats, getPulseTimeline, injectLiveSimulatedDispatch } from '../data/mockApi';
import { performSmartClustering } from '../lib/clustering';
import { TopLiveHeader } from '../components/layout/TopLiveHeader';
import { CategoryFilterBar } from '../components/filters/CategoryFilterBar';
import { StatsBar } from '../components/dashboard/StatsBar';
import { PulseTimeline } from '../components/dashboard/PulseTimeline';
import { DisasterCardGrid } from '../components/dashboard/DisasterCardGrid';
import { DisasterMap } from '../components/map/DisasterMap';
import { IncidentDetailPanel } from '../components/incident/IncidentDetailPanel';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { clusterId: activeClusterId } = useParams<{ clusterId?: string }>();
  const { filters, lastUpdated, triggerRefresh } = useDashboardStore();

  const [clusters, setClusters] = useState<IncidentCluster[]>([]);
  const [stats, setStats] = useState<DashboardStats>({
    activeIncidents: 0,
    criticalCount: 0,
    highCount: 0,
    reportsLastHour: 0,
    verifiedPercentage: 0,
    monitoredSourcesCount: 0,
  });
  const [buckets, setBuckets] = useState<PulseBucket[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch reports, stats, and pulse buckets
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    Promise.all([
      getReports(filters),
      getStats(filters),
      getPulseTimeline(filters),
    ]).then(([fetchedReports, fetchedStats, fetchedBuckets]) => {
      if (!isMounted) return;

      const clusterList = performSmartClustering(fetchedReports);
      setClusters(clusterList);
      setStats(fetchedStats);
      setBuckets(fetchedBuckets);
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [filters, lastUpdated]);

  // High-Frequency Real-Time Telemetry Ticker (ticks every 15 seconds for live dynamic updates)
  useEffect(() => {
    const TICK_INTERVAL = 15 * 1000;
    const ticker = setInterval(() => {
      injectLiveSimulatedDispatch();
      triggerRefresh();
    }, TICK_INTERVAL);

    return () => clearInterval(ticker);
  }, [triggerRefresh]);

  // Auto-classification & telemetry ingestion pass: Once every 3 minutes (180,000 ms)
  useEffect(() => {
    const THREE_MINUTES = 3 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        await fetch('http://127.0.0.1:3001/api/pipeline/run', { method: 'POST' });
      } catch (err) {
        console.warn('Auto-reload pipeline error:', err);
      } finally {
        injectLiveSimulatedDispatch();
        triggerRefresh();
      }
    }, THREE_MINUTES);

    return () => clearInterval(interval);
  }, [triggerRefresh]);

  const filteredClusters = useMemo(() => {
    let result = [...clusters];

    // 1. Recently reported filter (Strictly updated within the last 60 minutes)
    if (filters.recentlyReportedOnly) {
      const RECENT_WINDOW_MS = 60 * 60 * 1000;
      const now = Date.now();
      result = result.filter(
        (c) => (now - new Date(c.lastReportedAt || c.firstReportedAt).getTime()) <= RECENT_WINDOW_MS
      );
    }

    // 2. Categories filter
    if (filters.categories.length > 0) {
      result = result.filter((c) => filters.categories.includes(c.category));
    }

    // 3. Severities filter
    if (filters.severities.length > 0) {
      result = result.filter((c) => filters.severities.includes(c.highestSeverity));
    }

    // 4. Verified only filter
    if (filters.verifiedOnly) {
      result = result.filter((c) => c.reports.some((r) => r.source.verified));
    }

    // 5. Source type filter
    if (filters.sourceType !== 'all') {
      result = result.filter((c) => c.reports.some((r) => r.source.type === filters.sourceType));
    }

    // Always enforce strict Chronological Time Order: Newest reported first (lastReportedAt descending)
    result.sort(
      (a, b) => new Date(b.lastReportedAt || b.firstReportedAt).getTime() - new Date(a.lastReportedAt || a.firstReportedAt).getTime()
    );

    return result;
  }, [clusters, filters]);

  // Extract all individual reports for Leaflet Disaster Map
  const mapReports = useMemo(() => {
    const reports: DisasterReport[] = [];
    filteredClusters.forEach((c) => {
      c.reports.forEach((r) => reports.push(r));
    });
    return reports;
  }, [filteredClusters]);

  const selectedCluster = activeClusterId
    ? clusters.find((c) => c.clusterId === activeClusterId) || null
    : null;

  const handleCardClick = (clusterId: string) => {
    navigate(`/incident/${clusterId}`);
  };

  const handleSelectReport = (report: DisasterReport) => {
    if (report.clusterId) {
      navigate(`/incident/${report.clusterId}`);
    }
  };

  const handleClosePanel = () => {
    navigate('/');
  };

  return (
    <div className="h-screen w-screen bg-[#FFFFFF] flex flex-col font-sans-ui text-[#14181F] overflow-hidden">
      {/* 1. Top Live Status Header */}
      <TopLiveHeader />

      {/* 2. Horizontal Category Filter Bar */}
      <CategoryFilterBar />

      {/* 3. Executive Stats Bar */}
      <StatsBar stats={stats} loading={loading} />

      {/* Main Content Area: Split View Grid + Map + Sliding Detail Panel */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left / Main Workspace */}
        <div className="flex-1 flex flex-col overflow-hidden bg-[#F7F8FA]">
          {/* Top 24-Hour Severity Trend Bar */}
          <PulseTimeline buckets={buckets} />

          {/* Interactive Split View: Left Card Grid (7/12) | Right Live Map (5/12) */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-0 overflow-hidden border-t border-[#E4E7EC]">
            {/* Incident Cards Column */}
            <div className="lg:col-span-7 h-full overflow-y-auto p-4 border-r border-[#E4E7EC] bg-[#FFFFFF]">
              <DisasterCardGrid
                clusters={filteredClusters}
                loading={loading}
                onCardClick={handleCardClick}
              />
            </div>

            {/* Live Interactive Map Column */}
            <div className="hidden lg:block lg:col-span-5 h-full relative bg-[#F7F8FA]">
              <DisasterMap
                reports={mapReports}
                onSelectReport={handleSelectReport}
              />
            </div>
          </div>
        </div>

        {/* Right Side Incident Detail Dossier Panel */}
        {selectedCluster && (
          <aside className="w-full md:w-[480px] lg:w-[520px] h-full absolute right-0 top-0 z-40 animate-in slide-in-from-right duration-200">
            <IncidentDetailPanel cluster={selectedCluster} onClose={handleClosePanel} />
          </aside>
        )}
      </div>
    </div>
  );
};
