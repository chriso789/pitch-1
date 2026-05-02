/**
 * Modern Minimal Process Timeline
 */
import React from 'react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', title: 'Assessment', body: 'On-site inspection, measurements, and material selection tailored to your home.' },
  { n: '02', title: 'Preparation', body: 'Materials sourced and delivered. Project scheduled around your calendar.' },
  { n: '03', title: 'Installation', body: 'Certified crews execute the build with daily quality checks.' },
  { n: '04', title: 'Completion', body: 'Full walkthrough, signed completion, and your warranty package.' },
];

export const ModernMinimalProcessTimeline: React.FC = () => (
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
      <div className="w-16 h-[1px] bg-black mb-12" />

      <div className="space-y-12">
        {STEPS.map((s, i) => (
          <div key={s.n} className="flex items-start gap-8">
            <div className="text-4xl font-extralight text-gray-300 w-12 text-right shrink-0">{s.n}</div>
            <div className="border-l border-gray-200 pl-8 pb-2">
              <h3 className="text-xl font-light text-gray-900 mb-2">{s.title}</h3>
              <p className="text-sm text-gray-500 font-light leading-relaxed max-w-[440px]">{s.body}</p>
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="absolute bottom-0 left-0 right-0 px-16 py-6 flex justify-between text-xs text-gray-400">
      <span>Next → Your Investment</span>
    </div>
  </div>
);
