/**
 * Premium Dark Why Choose Us
 * Dark background, metallic accents. Uses a magazine editorial layout
 * with large pull-quote, horizontal stats bar, and card grid.
 * Very different structure from other templates.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Shield, Award, Wrench, Clock, Star, Quote } from 'lucide-react';

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

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Inter', system-ui, sans-serif", background: '#0A0A0A', color: '#E8E8E8' }}
    >
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at bottom left, rgba(180,180,200,0.04) 0%, transparent 60%)' }} />

      {/* Header section */}
      <div className="relative z-10 px-10 pt-12">
        <div className="text-[11px] tracking-[0.5em] text-[#666] uppercase mb-4">Why Choose {companyName}</div>
        <h2 className="text-4xl font-bold leading-tight tracking-tight mb-4 text-white">
          Excellence Is<br />The Standard.
        </h2>
        <div className="w-20 h-[2px] mb-6" style={{ background: 'linear-gradient(90deg, #A0A0A0, #444)' }} />
      </div>

      {/* Two-column: story + pull quote */}
      <div className="relative z-10 px-10 flex gap-8 mb-6">
        <div className="flex-1">
          <p className="text-sm text-[#888] leading-relaxed">{heroBlurb}</p>
          {brandMission && (
            <p className="text-xs text-[#666] mt-3 italic">{brandMission}</p>
          )}
        </div>
        {/* Pull quote box */}
        <div className="w-[240px] shrink-0 p-5 rounded" style={{ background: '#111', border: '1px solid #222' }}>
          <Quote className="w-5 h-5 text-[#555] mb-2" />
          <p className="text-xs text-[#999] italic leading-relaxed">
            "They showed up when they said they would, did exactly what they promised, and the finished product looks incredible."
          </p>
          <div className="flex gap-0.5 mt-3">
            {[0,1,2,3,4].map(i => (
              <Star key={i} className="w-3 h-3" style={{ color: '#A0A0A0', fill: '#A0A0A0' }} />
            ))}
          </div>
          <span className="text-[9px] text-[#555] mt-1 block">— VERIFIED HOMEOWNER</span>
        </div>
      </div>

      {/* Stats — horizontal bar */}
      <div className="relative z-10 mx-10 grid grid-cols-4 border-t border-b border-[#1A1A1A] divide-x divide-[#1A1A1A]">
        {[
          { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years' },
          { value: '5.0', label: 'Rating' },
          { value: '100%', label: 'Licensed' },
          { value: '100%', label: 'Insured' },
        ].map((s, i) => (
          <div key={i} className="py-4 text-center">
            <div className="text-xl font-bold text-white">{s.value}</div>
            <div className="text-[8px] tracking-[0.25em] text-[#555] uppercase mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Promises — 2x2 card grid */}
      <div className="relative z-10 px-10 mt-6 grid grid-cols-2 gap-3">
        {[
          { icon: Shield, title: 'Lifetime Warranty', body: 'Every installation backed by our written lifetime workmanship guarantee.' },
          { icon: Award, title: 'Certified Excellence', body: 'Manufacturer-certified crews using premium methods and materials.' },
          { icon: Wrench, title: 'Meticulous Standards', body: 'Daily cleanups, magnetic sweeps, and a job-site you can live with.' },
          { icon: Clock, title: 'Precision Scheduling', body: 'Fixed timelines, no surprises, and transparent communication.' },
        ].map(p => {
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

      {/* Certifications */}
      {certList.length > 0 && (
        <div className="relative z-10 mx-10 mt-5 px-4 py-3 rounded" style={{ background: '#111', borderLeft: '2px solid #444' }}>
          <div className="text-[9px] tracking-[0.3em] text-[#666] font-bold mb-1.5 uppercase">Certifications</div>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {certList.map((cert, i) => (
              <span key={i} className="text-[10px] text-[#888]">• {cert}</span>
            ))}
          </div>
        </div>
      )}

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
