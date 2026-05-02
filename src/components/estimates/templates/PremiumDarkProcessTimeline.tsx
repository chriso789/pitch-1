/**
 * Premium Dark Process Timeline
 */
import React from 'react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', title: 'Precision Assessment', body: 'Comprehensive on-site evaluation with advanced measurement technology.' },
  { n: '02', title: 'Materials & Coordination', body: 'Premium materials sourced and delivered. Project scheduled at your convenience.' },
  { n: '03', title: 'Expert Execution', body: 'Certified specialists deliver meticulous installation with daily quality assurance.' },
  { n: '04', title: 'Completion & Warranty', body: 'Thorough inspection, signed completion, and comprehensive warranty documentation.' },
];

export const PremiumDarkProcessTimeline: React.FC = () => (
  <div
    data-report-page
    className="relative overflow-hidden"
    style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Inter', system-ui, sans-serif", background: '#0A0A0A', color: '#E8E8E8' }}
  >
    <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top left, rgba(180,180,200,0.04) 0%, transparent 60%)' }} />

    <div className="relative z-10 px-12 pt-14">
      <div className="text-[11px] tracking-[0.5em] text-[#888] uppercase mb-4">The Process</div>
      <h2 className="text-5xl font-bold leading-tight tracking-tight text-white mb-4">
        Engineered for<br />perfection.
      </h2>
      <div className="w-20 h-[2px] mb-12" style={{ background: 'linear-gradient(90deg, #A0A0A0, #555)' }} />

      <div className="space-y-6">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex gap-6">
            <div className="flex flex-col items-center w-14 shrink-0">
              <div className="w-12 h-12 rounded flex items-center justify-center text-lg font-bold text-white" style={{ background: '#111', border: '1px solid #333' }}>
                {s.n}
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-[1px] flex-1 min-h-[20px]" style={{ background: '#333' }} />
              )}
            </div>
            <div className="p-5 flex-1 rounded" style={{ background: '#111', border: '1px solid #1A1A1A' }}>
              <h3 className="font-bold text-lg text-white mb-1">{s.title}</h3>
              <p className="text-sm text-[#777] leading-relaxed">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="absolute bottom-0 left-0 right-0 z-10 px-12 py-4 border-t border-[#1A1A1A]">
      <div className="flex justify-between text-[10px] text-[#555] tracking-[0.3em]">
        <span>PRECISION · EXCELLENCE · INTEGRITY</span>
        <span>NEXT → YOUR INVESTMENT</span>
      </div>
    </div>
  </div>
);
