/**
 * Warm Craftsman Process Timeline
 * Vertical timeline with earthy circle badges, amber connector lines.
 * Includes a personal note / "what to expect" section.
 */
import React from 'react';
import { ClipboardCheck, Package, Hammer, ShieldCheck, MessageCircle } from 'lucide-react';
import { ProcessTimelineProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', icon: ClipboardCheck, title: 'Inspection & Design', body: 'We start with a thorough on-site assessment — precise measurements, damage documentation, and a personalized consultation about materials and design options for your home.' },
  { n: '02', icon: Package, title: 'Materials & Scheduling', body: 'Premium materials are sourced from manufacturers we trust. Your project is scheduled around your calendar, with clear timelines and no guesswork.' },
  { n: '03', icon: Hammer, title: 'Expert Installation', body: 'Our master craftsmen execute the build with daily quality checks, clean-up standards, and property protection throughout the entire process.' },
  { n: '04', icon: ShieldCheck, title: 'Handoff & Warranty', body: 'We walk the finished project together, address every detail, and deliver your signed completion certificate and written warranty package.' },
];

export const WarmCraftsmanProcessTimeline: React.FC<ProcessTimelineProps> = ({
  companyName,
  companyInfo,
}) => {
  const displayName = companyInfo?.name || companyName || 'Our Team';

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{
        width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT,
        fontFamily: "'Georgia', 'Palatino', serif",
        background: 'linear-gradient(180deg, #F5F0E8 0%, #EDE6D6 100%)',
        color: '#3D3225',
      }}
    >
      {/* Header */}
      <div className="px-10 pt-10 pb-7" style={{ background: 'linear-gradient(135deg, #5C4033, #3D3225)' }}>
        <div className="text-[10px] tracking-[0.4em] text-[#C9956B] mb-3 uppercase">The {displayName} Process</div>
        <h2 className="text-3xl font-bold text-[#F5F0E8] leading-tight">
          From First Handshake<br />to Final Walkthrough
        </h2>
        <p className="text-xs text-[#F5F0E8]/50 mt-2">Every project follows our proven four-step process.</p>
      </div>
      <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

      {/* Timeline */}
      <div className="px-10 pt-8 space-y-0">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={s.n} className="flex gap-5">
              <div className="flex flex-col items-center w-14 shrink-0">
                <div className="w-12 h-12 rounded-full flex flex-col items-center justify-center text-[#F5F0E8] shadow" style={{ background: '#5C4033', border: '2px solid #C9956B' }}>
                  <Icon className="w-4 h-4 text-[#C9956B] mb-0.5" />
                  <span className="text-[8px] font-bold tracking-wider">{s.n}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="w-[3px] flex-1 min-h-[16px] rounded-full" style={{ background: '#C9956B' }} />
                )}
              </div>
              <div className="pb-5 pt-1 flex-1">
                <h3 className="text-base font-bold text-[#3D3225] mb-1">{s.title}</h3>
                <p className="text-xs text-[#6B5D4F] leading-relaxed">{s.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Personal note */}
      <div className="mx-10 mt-4 px-5 py-4 rounded-lg flex gap-4 items-start" style={{ background: 'rgba(201,149,107,0.08)', borderLeft: '3px solid #C9956B' }}>
        <MessageCircle className="w-5 h-5 text-[#C9956B] shrink-0 mt-0.5" />
        <div>
          <h4 className="font-bold text-sm text-[#3D3225] mb-1">A Note from {displayName}</h4>
          <p className="text-xs text-[#6B5D4F] leading-relaxed">
            We know inviting a contractor into your home is a big decision. 
            That's why we keep you informed at every step, answer every question, and treat your property with the same care we'd give our own.
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 px-10 py-4" style={{ background: '#3D3225' }}>
        <div className="flex justify-between text-[10px] tracking-[0.3em]">
          <span className="text-[#C9956B]">{displayName.toUpperCase()}</span>
          <span className="text-[#C9956B]">NEXT → YOUR INVESTMENT</span>
        </div>
      </div>
    </div>
  );
};
