/**
 * Warm Craftsman Process Timeline
 */
import React from 'react';
import { ClipboardCheck, Package, Hammer, ShieldCheck } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  { n: '01', icon: ClipboardCheck, title: 'Inspection & Design', body: 'On-site assessment with precision measurements and material selection tailored to your home.' },
  { n: '02', icon: Package, title: 'Materials & Scheduling', body: 'Premium materials sourced and delivered. Project scheduled around your calendar.' },
  { n: '03', icon: Hammer, title: 'Expert Installation', body: 'Master craftsmen execute the build with daily clean-up and quality checks.' },
  { n: '04', icon: ShieldCheck, title: 'Handoff & Warranty', body: 'Complete walkthrough, signed completion, and your written warranty package.' },
];

export const WarmCraftsmanProcessTimeline: React.FC = () => (
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
    <div className="px-12 pt-10 pb-8" style={{ background: 'linear-gradient(135deg, #5C4033, #3D3225)' }}>
      <div className="text-[10px] tracking-[0.4em] text-[#C9956B] mb-3 uppercase">The Process</div>
      <h2 className="text-4xl font-bold text-[#F5F0E8]">
        From first handshake<br />to final walkthrough.
      </h2>
    </div>
    <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

    <div className="px-12 pt-10 space-y-6">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        return (
          <div key={s.n} className="flex gap-5">
            <div className="flex flex-col items-center w-16 shrink-0">
              <div className="w-14 h-14 rounded-full flex flex-col items-center justify-center text-[#F5F0E8] shadow" style={{ background: '#5C4033' }}>
                <Icon className="w-5 h-5 text-[#C9956B] mb-0.5" />
                <span className="text-[9px] font-bold tracking-wider">{s.n}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="w-[3px] flex-1 min-h-[20px] rounded-full" style={{ background: '#C9956B' }} />
              )}
            </div>
            <div className="p-5 flex-1 rounded-lg" style={{ background: 'rgba(93,64,51,0.06)', borderLeft: '3px solid #C9956B' }}>
              <h3 className="text-lg font-bold text-[#3D3225] mb-1">{s.title}</h3>
              <p className="text-sm text-[#6B5D4F] leading-relaxed">{s.body}</p>
            </div>
          </div>
        );
      })}
    </div>

    <div className="absolute bottom-0 left-0 right-0 px-12 py-4" style={{ background: '#3D3225' }}>
      <div className="flex justify-between text-[10px] tracking-[0.3em]">
        <span className="text-[#C9956B]">QUALITY · CRAFTSMANSHIP · TRUST</span>
        <span className="text-[#C9956B]">NEXT → YOUR INVESTMENT</span>
      </div>
    </div>
  </div>
);
