/**
 * Premium Dark Why Choose Us
 * Dark background, metallic accents, luxury feel.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Shield, Award, Wrench, Clock, Star } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const PROMISES = [
  { icon: Shield, title: 'Lifetime Warranty', body: 'Every installation backed by our written lifetime workmanship guarantee.' },
  { icon: Award, title: 'Certified Excellence', body: 'Manufacturer-certified crews using premium methods and materials.' },
  { icon: Wrench, title: 'Meticulous Standards', body: 'Daily cleanups, magnetic sweeps, and job-site you can live with.' },
  { icon: Clock, title: 'Precision Scheduling', body: 'Fixed timelines, no surprises, and transparent communication throughout.' },
];

export const PremiumDarkWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || "You're not just hiring a contractor — you're hiring a team that delivers excellence on every project.";

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Inter', system-ui, sans-serif", background: '#0A0A0A', color: '#E8E8E8' }}
    >
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at bottom left, rgba(180,180,200,0.04) 0%, transparent 60%)' }} />

      <div className="relative z-10 px-12 pt-14">
        <div className="text-[11px] tracking-[0.5em] text-[#888] uppercase mb-4">Why Choose {companyName}</div>
        <h2 className="text-5xl font-bold leading-tight tracking-tight mb-4 text-white">
          Excellence is<br />the standard.
        </h2>
        <div className="w-20 h-[2px] mb-6" style={{ background: 'linear-gradient(90deg, #A0A0A0, #555)' }} />
        <p className="text-sm text-[#888] max-w-[500px] leading-relaxed">{heroBlurb}</p>

        {/* Stars */}
        <div className="flex gap-1 mt-5">
          {[0,1,2,3,4].map(i => (
            <Star key={i} className="w-4 h-4" style={{ color: '#A0A0A0', fill: '#A0A0A0' }} />
          ))}
          <span className="ml-2 text-[10px] tracking-wider text-[#666]">CONSISTENTLY 5-STAR REVIEWED</span>
        </div>
      </div>

      {/* Stats */}
      <div className="relative z-10 mx-12 mt-8 grid grid-cols-4 border-t border-b border-[#222] divide-x divide-[#222]">
        {[
          { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years' },
          { value: '5,000+', label: 'Projects' },
          { value: '5.0', label: 'Rating' },
          { value: '100%', label: 'Licensed' },
        ].map((s, i) => (
          <div key={i} className="py-5 text-center">
            <div className="text-2xl font-bold text-white">{s.value}</div>
            <div className="text-[9px] tracking-[0.25em] text-[#666] uppercase mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Promises */}
      <div className="relative z-10 px-12 mt-8 grid grid-cols-2 gap-4">
        {PROMISES.map(p => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="p-5 rounded flex gap-4" style={{ background: '#111', border: '1px solid #222' }}>
              <div className="w-10 h-10 rounded flex items-center justify-center shrink-0" style={{ background: '#1A1A1A', border: '1px solid #333' }}>
                <Icon className="w-5 h-5 text-[#A0A0A0]" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white mb-1">{p.title}</h3>
                <p className="text-xs text-[#777] leading-relaxed">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {brandCertifications && (
        <div className="relative z-10 mx-12 mt-6 px-5 py-3 rounded" style={{ background: '#111', borderLeft: '2px solid #555' }}>
          <div className="text-[9px] tracking-[0.3em] text-[#888] font-bold mb-1 uppercase">Certifications</div>
          <p className="text-xs text-[#666]">{brandCertifications}</p>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 z-10 px-12 py-4 border-t border-[#1A1A1A]">
        <div className="flex justify-between text-[10px] text-[#555] tracking-[0.2em]">
          <span>{companyName.toUpperCase()}</span>
          {licenseNumber && <span>LIC #{licenseNumber}</span>}
        </div>
      </div>
    </div>
  );
};
