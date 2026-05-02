/**
 * Classic Professional Process Timeline
 */
import React from 'react';
import { ClipboardCheck, Package, Hammer, ShieldCheck } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', icon: ClipboardCheck, title: 'Inspection & Assessment', body: 'Thorough on-site evaluation with precision measurements and material consultation.' },
  { n: '02', icon: Package, title: 'Materials & Scheduling', body: 'Premium materials sourced and delivered. Project scheduled at your convenience.' },
  { n: '03', icon: Hammer, title: 'Expert Installation', body: 'Certified crews execute with daily quality checks and clean-up standards.' },
  { n: '04', icon: ShieldCheck, title: 'Final Walkthrough & Warranty', body: 'Complete property inspection, signed completion certificate, and warranty documentation.' },
];

export const ClassicProcessTimeline: React.FC = () => (
  <div
    data-report-page
    className="relative bg-white text-[#1B2A4A] overflow-hidden"
    style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
  >
    <div className="bg-[#1B2A4A] px-12 pt-10 pb-8 text-center text-white">
      <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] mb-3 uppercase">Our Process</div>
      <h2 className="text-4xl font-bold" style={{ fontFamily: "'Georgia', serif" }}>
        From Consultation<br />to Completion
      </h2>
    </div>
    <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #C9A96E, #E8D5A3, #C9A96E)' }} />

    <div className="px-12 pt-10 space-y-0">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        return (
          <div key={s.n} className="flex gap-6 relative">
            {/* Left column: number + line */}
            <div className="flex flex-col items-center w-16 shrink-0">
              <div className="w-14 h-14 rounded-full bg-[#1B2A4A] flex items-center justify-center text-white text-lg font-bold">
                {s.n}
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-[2px] flex-1 min-h-[40px]" style={{ background: '#C9A96E' }} />
              )}
            </div>
            {/* Content */}
            <div className="pb-8 pt-2 flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Icon className="w-5 h-5 text-[#C9A96E]" />
                <h3 className="text-xl font-bold text-[#1B2A4A]">{s.title}</h3>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed pl-7">{s.body}</p>
            </div>
          </div>
        );
      })}
    </div>

    <div className="absolute bottom-0 left-0 right-0 bg-[#1B2A4A] px-12 py-4 flex justify-between text-[10px] text-[#C9A96E] tracking-[0.3em]">
      <span>QUALITY · INTEGRITY · CRAFTSMANSHIP</span>
      <span>NEXT → YOUR INVESTMENT</span>
    </div>
  </div>
);
