import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { IncidentCluster } from '../types/incident';
import { getReportsWithStatus, triggerPipelineAndRefresh } from '../data/mockApi';
import { useDashboardStore } from '../store/useDashboardStore';
import { TopLiveHeader } from '../components/layout/TopLiveHeader';
import { ErrorBoundary } from '../components/layout/ErrorBoundary';
import { CategoryFilterBar } from '../components/filters/CategoryFilterBar';
import { DisasterCardGrid } from '../components/dashboard/DisasterCardGrid';
import { IncidentDetailPanel } from '../components/incident/IncidentDetailPanel';
import { performSmartClustering } from '../lib/clustering';
import { Loader2 } from 'lucide-react';

const DisasterMap = lazy(() => import('../components/map/DisasterMap').then((m) => ({ default: m.DisasterMap })));

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { clusterId: activeClusterId } = useParams<{ clusterId?: string }>();
  const { filters, lastUpdated, triggerRefresh, viewMode, setIngestionStatus } = useDashboardStore();

  const [clusters, setClusters] = useState<IncidentCluster[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch reports, cluster them, and record honest live/demo attribution for the status badge
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getReportsWithStatus(filters).then(({ reports: fetchedReports, mode, liveCount }) => {
      if (!isMounted) return;

      setClusters(performSmartClustering(fetchedReports));
      setIngestionStatus(mode, liveCount);
      setLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [filters, lastUpdated]);

  // Auto-classification & telemetry ingestion pass: Once every 3 minutes (180,000 ms)
  useEffect(() => {
    const THREE_MINUTES = 3 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        await triggerPipelineAndRefresh();
      } catch (err) {
        console.warn('Auto-reload pipeline error:', err);
      } finally {
        triggerRefresh();
      }
    }, THREE_MINUTES);

    return () => clearInterval(interval);
  }, [triggerRefresh]);

  // Live relative time ticking timer (Refreshes card time labels & recent window every 30 seconds)
  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);

  const filteredClusters = useMemo(() => {
    let result = [...clusters];

    // 1. Recently reported filter (< 6 hours or newest dispatches)
    if (filters.recentlyReportedOnly) {
      const sixHoursAgo = Date.now() - 6 * 3600 * 1000;
      const recent = result.filter(
        (c) => new Date(c.lastReportedAt || c.firstReportedAt).getTime() >= sixHoursAgo
      );
      result = recent.length > 0 ? recent : result;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusters, filters, now]);

  const filteredReports = useMemo(
    () => filteredClusters.flatMap((c) => c.reports),
    [filteredClusters]
  );

  const selectedCluster = activeClusterId
    ? clusters.find((c) => c.clusterId === activeClusterId) || null
    : null;

  const handleCardClick = (clusterId: string) => {
    navigate(`/incident/${clusterId}`);
  };

  const handleClosePanel = () => {
    navigate('/');
  };

  return (
    <div className="h-screen w-screen bg-[#FFFFFF] flex flex-col font-sans-ui text-[#14181F] overflow-hidden">
      {/* 1. Top Live Status Header */}
      <ErrorBoundary section="Header">
        <TopLiveHeader />
      </ErrorBoundary>

      {/* 2. Horizontal Category Filter Bar */}
      <ErrorBoundary section="Filters">
        <CategoryFilterBar />
      </ErrorBoundary>

      {/* 4. Main Content Split View (Grid/Map + Docked Right Detail Panel) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Side: Card Grid or Map (Smoothly compresses width when panel opens) */}
        <motion.main
          layout
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex-1 overflow-y-auto min-w-0"
        >
          <ErrorBoundary section={viewMode === 'map' ? 'Map view' : 'Incident grid'}>
            {viewMode === 'map' ? (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center text-[#6B7280] text-xs font-mono-data gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Loading map…</span>
                  </div>
                }
              >
                <DisasterMap
                  reports={filteredReports}
                  selectedReportId={selectedCluster?.representativeReportId}
                  onSelectReport={(report) => handleCardClick(report.clusterId)}
                />
              </Suspense>
            ) : (
              <DisasterCardGrid
                clusters={filteredClusters}
                loading={loading}
                onCardClick={handleCardClick}
              />
            )}
          </ErrorBoundary>
        </motion.main>

        {/* Right Side: Docked Detail Panel (Side-by-side flex sibling on desktop, overlay on mobile) */}
        <AnimatePresence>
          {selectedCluster && (
            <motion.div
              key="detail-panel"
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="fixed md:relative inset-0 md:inset-auto shrink-0 w-full md:w-[450px] lg:w-[480px] h-full z-20"
            >
              <ErrorBoundary section="Incident detail">
                <IncidentDetailPanel
                  cluster={selectedCluster}
                  onClose={handleClosePanel}
                />
              </ErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
