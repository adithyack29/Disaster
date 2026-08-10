import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { IncidentCluster } from '../types/incident';
import { getClusterById, getIncidentById } from '../data/mockApi';
import { IncidentDetailPanel } from '../components/incident/IncidentDetailPanel';
import { ShieldAlert } from 'lucide-react';

export const IncidentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [cluster, setCluster] = useState<IncidentCluster | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);

    getClusterById(id).then(async (c) => {
      if (c) {
        setCluster(c);
        setLoading(false);
      } else {
        // Try fetching by single report ID
        const rep = await getIncidentById(id);
        if (rep && rep.clusterId) {
          const fetchedCluster = await getClusterById(rep.clusterId);
          setCluster(fetchedCluster);
        }
        setLoading(false);
      }
    });
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-center font-mono-data text-xs text-[#1E3A5F]">
        <ShieldAlert className="w-8 h-8 text-[#1E3A5F] animate-bounce mb-3" />
        <div>LOADING INCIDENT DOSSIER // ID: {id}</div>
      </div>
    );
  }

  if (!cluster) {
    return (
      <div className="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-center p-6 text-center">
        <h2 className="text-sm font-bold font-mono-data text-[#DC2626] mb-2 uppercase">
          INCIDENT RECORD NOT FOUND
        </h2>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-[#1E3A5F] text-white text-xs font-mono-data rounded font-semibold cursor-pointer"
        >
          RETURN TO COMMAND DASHBOARD
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFFFF] flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-xl h-[90vh]">
        <IncidentDetailPanel cluster={cluster} onClose={() => navigate('/')} />
      </div>
    </div>
  );
};
