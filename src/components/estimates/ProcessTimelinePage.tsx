/**
 * ProcessTimelinePage — bold magazine-style "How it works" page.
 * Renders as a full letter-sized page in the estimate PDF + online viewer.
 *
 * Now fully dynamic — uses brand colors from companyInfo.
 */
import React from 'react';
import {
  ClipboardCheck,
  Package,
  Hammer,
  ShieldCheck,
} from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const STEPS = [
  {
    n: '01',
    icon: ClipboardCheck,
    title: 'Inspection & Design',
    body:
      'On-site assessment, precision measurements, and material selection tailored to your home.',
  },
  {
    n: '02',
    icon: Package,
    title: 'Materials & Scheduling',
    body:
      'Premium materials sourced and delivered. Project scheduled around your calendar.',
  },
  {
    n: '03',
    icon: Hammer,
    title: 'Professional Installation',
    body:
      'Certified crews execute the build with daily clean-up and on-site quality checks.',
  },
  {
    n: '04',
    icon: ShieldCheck,
    title: 'Final Walk & Warranty',
    body:
      'Full property walkthrough, signed completion, and your written warranty package.',
  },
];

interface ProcessTimelinePageProps {
  companyName?: string;
  companyInfo?: {
    brand_primary_color?: string | null;
    brand_accent_color?: string | null;
    [key: string]: unknown;
  };
}

export const ProcessTimelinePage: React.FC<ProcessTimelinePageProps> = ({
  companyInfo,
}) => {
  const primaryColor = companyInfo?.brand_primary_color || 'hsl(var(--primary))';
  const accentColor = companyInfo?.brand_accent_color || '#1a1a2e';

  return (
    <div
      data-report-page
      className="relative bg-white text-gray-900 overflow-hidden"
      style={{
        width: `${PAGE_WIDTH}px`,
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Section eyebrow header */}
      <div className="px-12 pt-14 pb-8">
        <div className="text-[10px] font-bold tracking-[0.4em] text-gray-400 mb-3">
          THE PROCESS
        </div>
        <h2
          className="font-black leading-[0.9] mb-4"
          style={{ fontSize: '64px', letterSpacing: '-0.03em' }}
        >
          From <span style={{ color: primaryColor }}>handshake</span>
          <br />
          to handoff.
        </h2>
        <p className="text-base text-gray-600 max-w-[560px] leading-relaxed">
          A clear, four-stage journey designed to keep you informed, on schedule,
          and confident at every step.
        </p>
      </div>

      {/* Vertical timeline */}
      <div className="px-12 pb-12">
        <div className="relative">
          {/* Spine */}
          <div
            className="absolute left-[34px] top-2 bottom-2 w-[3px] rounded-full"
            style={{
              background:
                `linear-gradient(180deg, ${primaryColor} 0%, ${accentColor} 100%)`,
            }}
          />

          <div className="space-y-6">
            {STEPS.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.n} className="relative pl-24">
                  {/* Number disc */}
                  <div
                    className="absolute left-0 top-0 w-[72px] h-[72px] rounded-full flex flex-col items-center justify-center text-white shadow-lg"
                    style={{
                      background:
                        `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
                    }}
                  >
                    <Icon className="w-5 h-5 mb-0.5" />
                    <div className="text-[10px] font-black tracking-widest">
                      {s.n}
                    </div>
                  </div>

                  {/* Content card */}
                  <div className="bg-gray-50 border-l-4 rounded-r-lg p-5"
                       style={{ borderColor: primaryColor }}>
                    <h3
                      className="font-bold text-gray-900 mb-1.5"
                      style={{ fontSize: '22px', letterSpacing: '-0.01em' }}
                    >
                      {s.title}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed max-w-[540px]">
                      {s.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom accent block */}
      <div
        className="absolute bottom-0 left-0 right-0 px-12 py-5 text-white flex items-center justify-between"
        style={{ background: accentColor }}
      >
        <div className="text-[10px] font-bold tracking-[0.4em] opacity-70">
          QUALITY · TRANSPARENCY · CRAFTSMANSHIP
        </div>
        <div
          className="text-[10px] font-bold tracking-[0.3em]"
          style={{ color: primaryColor }}
        >
          NEXT → YOUR INVESTMENT
        </div>
      </div>
    </div>
  );
};

export default ProcessTimelinePage;
