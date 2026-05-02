/**
 * Classic Professional Process Timeline
 * Vertical numbered timeline with navy circles, gold connector lines, serif type.
 * Includes company contact info and a "what to expect" reassurance block.
 */
import React from 'react';
import { ClipboardCheck, Package, Hammer, ShieldCheck, Phone } from 'lucide-react';
import { ProcessTimelineProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', icon: ClipboardCheck, title: 'Inspection & Assessment', body: 'Thorough on-site evaluation with precision measurements, damage documentation, and a personalized consultation to determine the right approach for your property.' },
  { n: '02', icon: Package, title: 'Materials & Scheduling', body: 'We source premium materials from trusted manufacturers, coordinate delivery logistics, and schedule your project at a time that works best for you.' },
  { n: '03', icon: Hammer, title: 'Expert Installation', body: 'Our certified crews execute every detail with daily quality checks, magnetic nail sweeps, and complete job-site cleanup at the end of each work day.' },
  { n: '04', icon: ShieldCheck, title: 'Final Walkthrough & Warranty', body: 'We conduct a thorough property inspection together, provide signed completion documentation, and deliver your comprehensive warranty package.' },
];

export const ClassicProcessTimeline: React.FC<ProcessTimelineProps> = ({
  companyName,
  companyInfo,
}) => {
  const displayName = companyInfo?.name || companyName || 'Our Team';

  return (
    <div
      data-report-page
      className="relative bg-white text-[#1B2A4A] overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {/* Navy header */}
      <div className="bg-[#1B2A4A] px-10 pt-10 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-[2px] bg-[#C9A96E]" />
          <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] uppercase">Our Process</div>
        </div>
        <h2 className="text-3xl font-bold text-white" style={{ fontFamily: "'Georgia', serif" }}>
          From Consultation to Completion
        </h2>
        <p className="text-sm text-white/60 mt-2 max-w-[480px]">
          Every {displayName} project follows a proven four-step process designed for transparency, quality, and your peace of mind.
        </p>
      </div>
      <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #C9A96E, #E8D5A3, #C9A96E)' }} />

      {/* Timeline */}
      <div className="px-10 pt-8 space-y-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.n} className="flex gap-6 relative">
              <div className="flex flex-col items-center w-14 shrink-0">
                <div className="w-12 h-12 rounded-full bg-[#1B2A4A] flex items-center justify-center text-white text-sm font-bold border-2 border-[#C9A96E]">
                  {s.n}
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-[2px] flex-1 min-h-[30px]" style={{ background: '#C9A96E' }} />
                )}
              </div>
              <div className="pb-6 pt-1.5 flex-1">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon className="w-4 h-4 text-[#C9A96E]" />
                  <h3 className="text-lg font-bold text-[#1B2A4A]">{s.title}</h3>
                </div>
                <p className="text-xs text-gray-600 leading-relaxed pl-6">{s.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Contact / questions block */}
      <div className="mx-10 mt-4 px-6 py-5 bg-[#F8F6F1] border border-[#C9A96E]/20 flex items-center gap-5">
        <div className="w-10 h-10 rounded-full bg-[#1B2A4A] flex items-center justify-center shrink-0">
          <Phone className="w-5 h-5 text-[#C9A96E]" />
        </div>
        <div>
          <h4 className="font-bold text-sm text-[#1B2A4A]">Questions About Our Process?</h4>
          <p className="text-xs text-gray-600">
            Contact us at <span className="font-semibold text-[#1B2A4A]">{companyInfo?.phone || 'our office'}</span>
            {companyInfo?.email && <> or <span className="font-semibold text-[#1B2A4A]">{companyInfo.email}</span></>}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 bg-[#1B2A4A] px-10 py-4 flex justify-between text-[10px] text-[#C9A96E] tracking-[0.3em]">
        <span>{displayName.toUpperCase()}</span>
        <span>NEXT → YOUR INVESTMENT</span>
      </div>
    </div>
  );
};
