import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { IncidentCluster } from '../types/incident';
import { getReports } from '../data/mockApi';
import { useDashboardStore } from '../store/useDashboardStore';
import { TopLiveHeader } from '../components/layout/TopLiveHeader';
import { CategoryFilterBar } from '../components/filters/CategoryFilterBar';
import { DisasterCardGrid } from '../components/dashboard/DisasterCardGrid';
import { IncidentDetailPanel } from '../components/incident/IncidentDetailPanel';
import { performSmartClustering } from '../lib/clustering';

export const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { clusterId: activeClusterId } = useParams<{ clusterId?: string }>();
  const { filters, lastUpdated, triggerRefresh } = useDashboardStore();

  const [clusters, setClusters] = useState<IncidentCluster[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch reports and group into IncidentCluster objects
  useEffect(() => {
    let isMounted = true;
    setLoading(true);

    getReports(filters).then((fetchedReports) => {
      if (!isMounted) return;

      const clusterList = performSmartClustering(fetchedReports);
      setClusters(clusterList);
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
        await fetch('http://127.0.0.1:3001/api/pipeline/run', { method: 'POST' });
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
  }, [clusters, filters, now]);

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
      <TopLiveHeader />

      {/* 2. Horizontal Category Filter Bar */}
      <CategoryFilterBar />

      {/* 3. Main Content Split View (Grid + Docked Right Detail Panel) */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left Side: Card Grid (Smoothly compresses width when panel opens) */}
        <motion.main
          layout
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="flex-1 overflow-y-auto min-w-0"
        >
          <DisasterCardGrid
            clusters={filteredClusters}
            loading={loading}
            onCardClick={handleCardClick}
          />
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
              className="relative shrink-0 w-full md:w-[450px] lg:w-[480px] h-full z-20"
            >
              <IncidentDetailPanel
                cluster={selectedCluster}
                onClose={handleClosePanel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
