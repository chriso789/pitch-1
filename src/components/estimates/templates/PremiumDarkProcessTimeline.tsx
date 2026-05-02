/**
 * Premium Dark Process Timeline
 * Full dark background. Horizontal card layout instead of vertical timeline.
 * Each step is a distinct bordered card with number overlay.
 * Very different structure from other templates.
 */
import React from 'react';
import { ProcessTimelineProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', title: 'Precision Assessment', body: 'Comprehensive on-site evaluation with advanced measurement technology. We document everything — current condition, damage areas, and project scope.' },
  { n: '02', title: 'Materials & Coordination', body: 'Premium materials sourced from trusted manufacturers. Your project is scheduled with precision — clear timelines, coordinated deliveries, and no wasted time.' },
  { n: '03', title: 'Expert Execution', body: 'Certified specialists deliver meticulous installation with daily quality assurance checks, thorough cleanup, and continuous communication.' },
  { n: '04', title: 'Completion & Warranty', body: 'Thorough final inspection together, signed completion documentation, and your comprehensive warranty package — backed in writing.' },
];

export const PremiumDarkProcessTimeline: React.FC<ProcessTimelineProps> = ({
  companyName,
  companyInfo,
}) => {
  const displayName = companyInfo?.name || companyName || 'Our Team';

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Inter', system-ui, sans-serif", background: '#0A0A0A', color: '#E8E8E8' }}
    >
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top left, rgba(180,180,200,0.04) 0%, transparent 60%)' }} />

      {/* Header */}
      <div className="relative z-10 px-10 pt-12">
        <div className="text-[11px] tracking-[0.5em] text-[#666] uppercase mb-4">The {displayName} Process</div>
        <h2 className="text-4xl font-bold leading-tight tracking-tight text-white mb-3">
          Engineered for<br />Perfection.
        </h2>
        <div className="w-20 h-[2px] mb-4" style={{ background: 'linear-gradient(90deg, #A0A0A0, #444)' }} />
        <p className="text-sm text-[#666] max-w-[500px]">
          Every {displayName} project follows a proven process designed for precision, transparency, and exceptional results.
        </p>
      </div>

      {/* Steps — large cards with number watermark */}
      <div className="relative z-10 px-10 mt-8 space-y-4">
        {STEPS.map((s) => (
          <div key={s.n} className="relative p-6 rounded overflow-hidden" style={{ background: '#111', border: '1px solid #1A1A1A' }}>
            {/* Large watermark number */}
            <div className="absolute top-2 right-4 text-[72px] font-black leading-none select-none" style={{ color: 'rgba(255,255,255,0.03)' }}>
              {s.n}
            </div>
            <div className="relative z-10 flex items-start gap-5">
              <div className="w-10 h-10 rounded flex items-center justify-center shrink-0 text-sm font-bold text-white" style={{ background: '#1A1A1A', border: '1px solid #333' }}>
                {s.n}
              </div>
              <div>
                <h3 className="font-bold text-lg text-white mb-1.5">{s.title}</h3>
                <p className="text-xs text-[#777] leading-relaxed">{s.body}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-10 py-4 border-t border-[#1A1A1A]">
        <div className="flex justify-between text-[10px] text-[#444] tracking-[0.3em]">
          <span>{displayName.toUpperCase()}</span>
          <span>NEXT → YOUR INVESTMENT</span>
        </div>
      </div>
    </div>
  );
};
