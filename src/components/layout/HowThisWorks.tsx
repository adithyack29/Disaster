import React, { useState, useRef, useEffect } from 'react';
import { Info, X } from 'lucide-react';

/**
 * A single, unobtrusive affordance so a judge unfamiliar with this specific system can orient
 * in seconds without permanent UI real estate — closed by default, opens a short explainer.
 */
export const HowThisWorks: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative shrink-0" ref={popoverRef}>
      <button
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label="How this dashboard works"
        title="How this dashboard works"
        className="p-2 rounded-full border border-[#E4E7EC] bg-[#F7F8FA] text-[#6B7280] hover:text-[#1E3A5F] hover:bg-gray-100 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[#1E3A5F]"
      >
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="How this dashboard works"
          className="absolute right-0 top-full mt-1.5 z-50 bg-[#FFFFFF] border border-[#E4E7EC] rounded-lg shadow-lg p-4 w-72 sm:w-80 font-sans-ui text-xs animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between mb-2.5">
            <span className="font-bold text-[#1E3A5F] uppercase text-[11px] tracking-wider">How this works</span>
            <button
              onClick={() => setIsOpen(false)}
              aria-label="Close"
              className="text-[#6B7280] hover:text-[#14181F] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <ul className="space-y-2 text-[#14181F] leading-snug">
            <li>
              <strong>Sources:</strong> News RSS, GNews, NewsAPI, Reddit, Mastodon, Bluesky, USGS, NASA EONET, GDACS,
              and ReliefWeb — aggregated automatically, no manual monitoring.
            </li>
            <li>
              <strong>AI explains, rules decide:</strong> Gemini extracts category and entities from raw text;
              severity, credibility, and escalation are governed by fixed rules — never a black box.
            </li>
            <li>
              <strong>Every headline is real</strong> — verbatim from its source, never AI-rephrased.
            </li>
            <li>
              <strong>Related reports cluster</strong> into one incident, with a visible history of what changed and why.
            </li>
            <li>
              <strong>Score</strong> = algorithmic credibility (source type + verification), not a popularity metric.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
};
