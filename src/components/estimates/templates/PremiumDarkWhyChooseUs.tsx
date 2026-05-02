/**
 * Premium Dark Why Choose Us
 * DARK MAGAZINE EDITORIAL — full dark bg, metallic accent gradients, 2x2 card grid.
 * Structure: header → two-column (story + data card) → horizontal stats bar → 2x2 grid.
 * DISTINCT from Bold-Editorial: no light bg, no large pull-quote testimonial, no star strip below header, no "SATISFACTION GUARANTEE" bar.
 * DISTINCT from Classic: no sidebar layout, no serif fonts, no gold borders.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Shield, Award, Wrench, Clock } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const PremiumDarkWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandMission,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || `${companyName} delivers premium-grade results through meticulous planning, expert execution, and an unwavering commitment to excellence on every project.`;

  const certList = brandCertifications
    ? brandCertifications.split(/[,;·•]/).map(s => s.trim()).filter(Boolean)
    : [];

  // Build dynamic promise cards from company data
  const promises: { icon: typeof Shield; title: string; body: string }[] = [];
  if (brandMission) {
    promises.push({ icon: Award, title: 'Our Standard', body: brandMission });
  }
  if (yearsInBusiness) {
    promises.push({ icon: Clock, title: `${yearsInBusiness}+ Years Strong`, body: `Nearly ${yearsInBusiness === 1 ? 'a year' : `${yearsInBusiness} years`} of delivering results that speak for themselves — project after project.` });
  }
  if (licenseNumber) {
    promises.push({ icon: Shield, title: 'Fully Licensed', body: `Operating under license #${licenseNumber} with full insurance coverage for every project we take on.` });
  }
  if (certList.length > 0) {
    promises.push({ icon: Wrench, title: 'Certified Team', body: certList.join(' · ') });
  }
  // Pad to at least 4 if we don't have enough data
  if (promises.length < 4) {
    const fallbacks = [
      { icon: Shield, title: 'Quality Assurance', body: `Every ${companyName} project meets our rigorous internal quality standards before we consider it complete.` },
      { icon: Clock, title: 'Responsive Service', body: `We respond quickly, communicate proactively, and treat your time with the same respect we treat our own.` },
      { icon: Wrench, title: 'Expert Execution', body: `Our crews bring professional-grade skill and attention to detail to every aspect of your project.` },
      { icon: Award, title: 'Results-Driven', body: `We measure our success by your satisfaction — nothing less than exceptional results.` },
    ];
    while (promises.length < 4) {
      const fb = fallbacks[promises.length];
      if (fb) promises.push(fb);
      else break;
    }
  }

  // Dynamic stats — only show real data
  const stats: { value: string; label: string }[] = [];
  if (yearsInBusiness) stats.push({ value: `${yearsInBusiness}+`, label: 'Years' });
  stats.push({ value: '100%', label: 'Licensed' });
  stats.push({ value: '100%', label: 'Insured' });
  if (certList.length > 0) stats.push({ value: `${certList.length}`, label: 'Credentials' });

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Inter', system-ui, sans-serif", background: '#0A0A0A', color: '#E8E8E8' }}
    >
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at bottom left, rgba(180,180,200,0.04) 0%, transparent 60%)' }} />

      <div className="relative z-10 px-10 pt-12">
        <div className="text-[11px] tracking-[0.5em] text-[#666] uppercase mb-4">Why Choose {companyName}</div>
        <h2 className="text-4xl font-bold leading-tight tracking-tight mb-4 text-white">
          Excellence Is<br />The Standard.
        </h2>
        <div className="w-20 h-[2px] mb-6" style={{ background: 'linear-gradient(90deg, #A0A0A0, #444)' }} />
      </div>

      {/* Story — full width, no fake testimonial */}
      <div className="relative z-10 px-10 mb-6">
        <p className="text-sm text-[#888] leading-relaxed max-w-[600px]">{heroBlurb}</p>
        {brandMission && (
          <p className="text-xs text-[#666] mt-3 italic max-w-[500px]">{brandMission}</p>
        )}
      </div>

      {/* Stats — horizontal bar */}
      <div className="relative z-10 mx-10 grid divide-x divide-[#1A1A1A] border-t border-b border-[#1A1A1A]" style={{ gridTemplateColumns: `repeat(${stats.length}, 1fr)` }}>
        {stats.map((s, i) => (
          <div key={i} className="py-4 text-center">
            <div className="text-xl font-bold text-white">{s.value}</div>
            <div className="text-[8px] tracking-[0.25em] text-[#555] uppercase mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Promises — 2x2 card grid with dynamic content */}
      <div className="relative z-10 px-10 mt-6 grid grid-cols-2 gap-3">
        {promises.slice(0, 4).map(p => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="p-4 rounded flex gap-3" style={{ background: '#111', border: '1px solid #1A1A1A' }}>
              <div className="w-9 h-9 rounded flex items-center justify-center shrink-0" style={{ background: '#1A1A1A', border: '1px solid #333' }}>
                <Icon className="w-4 h-4 text-[#A0A0A0]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white mb-0.5">{p.title}</h3>
                <p className="text-[11px] text-[#666] leading-relaxed">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-10 py-4 border-t border-[#1A1A1A]">
        <div className="flex justify-between text-[10px] text-[#444] tracking-[0.2em]">
          <span>{companyName.toUpperCase()}</span>
          {licenseNumber && <span>LIC #{licenseNumber}</span>}
        </div>
      </div>
    </div>
  );
};
