import React from 'react';
import type { IncidentCluster } from '../../types/incident';
import { DisasterCard } from './DisasterCard';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useDashboardStore } from '../../store/useDashboardStore';

interface DisasterCardGridProps {
  clusters: IncidentCluster[];
  loading?: boolean;
  onCardClick?: (clusterId: string) => void;
}

export const DisasterCardGrid: React.FC<DisasterCardGridProps> = ({
  clusters,
  loading = false,
  onCardClick,
}) => {
  const { resetFilters } = useDashboardStore();

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-5 font-sans-ui max-w-7xl mx-auto">
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <div
            key={n}
            className="bg-white border-2 border-[#E4E7EC] rounded-xl p-6 animate-pulse space-y-4 min-h-[340px] flex flex-col justify-between"
          >
            <div className="flex justify-between items-center">
              <div className="h-6 bg-gray-200 rounded-md w-1/3" />
              <div className="h-4 bg-gray-100 rounded-md w-1/4" />
            </div>
            <div className="h-6 bg-gray-200 rounded-md w-full" />
            <div className="h-16 bg-gray-100 rounded-md w-full" />
            <div className="h-5 bg-gray-200 rounded-md w-1/2" />
          </div>
        ))}
      </div>
    );
  }

  if (clusters.length === 0) {
    return (
      <div className="p-10 text-center font-sans-ui max-w-lg mx-auto my-16 bg-white border-2 border-[#E4E7EC] rounded-xl space-y-4 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-gray-100 text-[#6B7280] flex items-center justify-center mx-auto">
          <AlertCircle className="w-6 h-6" />
        </div>
        <div>
          <h3 className="text-base font-bold text-[#14181F] uppercase">
            NO INCIDENTS MATCH THIS CATEGORY
          </h3>
          <p className="text-sm text-[#6B7280] mt-1 leading-relaxed">
            There are currently no active disaster events matching your selected category or severity filters.
          </p>
        </div>
        <button
          onClick={resetFilters}
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1E3A5F] text-white text-xs font-semibold rounded-md hover:bg-[#152a45] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4" />
          <span>SHOW ALL INCIDENTS</span>
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 p-5 font-sans-ui max-w-7xl mx-auto">
      {clusters.map((cluster) => (
        <DisasterCard
          key={cluster.clusterId}
          cluster={cluster}
          onClick={onCardClick}
        />
      ))}
    </div>
  );
};
