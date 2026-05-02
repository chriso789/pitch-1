/**
 * Modern Minimal Process Timeline
 * Large numbers, extreme whitespace, thin horizontal rules between steps.
 * No icons — pure typography driven.
 */
import React from 'react';
import { ProcessTimelineProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', title: 'Assessment', body: 'We visit your property, take precise measurements, document the current condition, and discuss your goals. No pressure — just information.' },
  { n: '02', title: 'Preparation', body: 'Materials are sourced from trusted manufacturers and delivered on schedule. Your project is calendared around your availability.' },
  { n: '03', title: 'Installation', body: 'Our certified crew executes with care — daily quality checks, thorough cleanup, and open communication throughout.' },
  { n: '04', title: 'Completion', body: 'We walk the finished project together, answer every question, and deliver your complete warranty documentation.' },
];

export const ModernMinimalProcessTimeline: React.FC<ProcessTimelineProps> = ({
  companyName,
  companyInfo,
}) => {
  const displayName = companyInfo?.name || companyName || 'Our Team';

  return (
    <div
      data-report-page
      className="relative bg-white text-gray-900 overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="h-[2px] bg-black" />

      <div className="px-16 pt-16">
        <div className="text-[11px] tracking-[0.5em] text-gray-400 uppercase mb-8">The Process</div>
        <h2 className="text-5xl font-extralight text-gray-900 leading-tight tracking-tight mb-4">
          Four simple steps.
        </h2>
        <div className="w-16 h-[1px] bg-black mb-14" />

        <div className="space-y-0">
          {STEPS.map((s, i) => (
            <div key={s.n}>
              <div className="flex items-baseline gap-8 py-8">
                <div className="text-5xl font-extralight text-gray-200 w-16 text-right shrink-0">{s.n}</div>
                <div className="flex-1">
                  <h3 className="text-xl font-light text-gray-900 mb-2">{s.title}</h3>
                  <p className="text-sm text-gray-500 font-light leading-relaxed max-w-[440px]">{s.body}</p>
                </div>
              </div>
              {i < STEPS.length - 1 && <div className="h-[1px] bg-gray-100 ml-24" />}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-16 py-6 flex justify-between text-xs text-gray-400">
        <span>{displayName}</span>
        <span>Next → Your Investment</span>
      </div>
    </div>
  );
};
