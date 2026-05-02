/**
 * Warm Craftsman Why Choose Us
 * Earthy palette, rustic icons, warm amber accents.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Shield, Award, Wrench, Clock, Star } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const PROMISES = [
  { icon: Shield, title: 'Built to Last', body: 'Every project backed by our lifetime workmanship guarantee.' },
  { icon: Award, title: 'Master Craftsmen', body: 'Our crews are manufacturer-certified and trained in premium techniques.' },
  { icon: Wrench, title: 'Respect for Your Home', body: 'Daily cleanups, property protection, and careful material handling.' },
  { icon: Clock, title: 'Reliable Scheduling', body: 'We show up when we say we will, and finish when we promise.' },
];

export const WarmCraftsmanWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || "Quality craftsmanship isn't just what we do — it's who we are. Every project receives the care and attention it deserves.";

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
      <div className="px-12 pt-10 pb-8" style={{ background: 'linear-gradient(135deg, #5C4033, #3D3225)' }}>
        <div className="text-[10px] tracking-[0.4em] text-[#C9956B] mb-3 uppercase">Our Promise to You</div>
        <h2 className="text-4xl font-bold text-[#F5F0E8] mb-3">
          Craftsmanship you<br />can count on.
        </h2>
        <p className="text-sm text-[#F5F0E8]/70 max-w-[480px] leading-relaxed">{heroBlurb}</p>
        <div className="flex gap-1 mt-4">
          {[0,1,2,3,4].map(i => (
            <Star key={i} className="w-4 h-4" style={{ color: '#C9956B', fill: '#C9956B' }} />
          ))}
          <span className="ml-2 text-[10px] tracking-wider text-[#F5F0E8]/60">5-STAR REVIEWS</span>
        </div>
      </div>

      <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

      {/* Stats */}
      <div className="grid grid-cols-4 px-12 py-6 gap-4">
        {[
          { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years' },
          { value: '5,000+', label: 'Projects' },
          { value: '5.0★', label: 'Rating' },
          { value: '100%', label: 'Licensed' },
        ].map((s, i) => (
          <div key={i} className="text-center py-4 rounded-lg" style={{ background: 'rgba(201,149,107,0.1)', border: '1px solid rgba(201,149,107,0.3)' }}>
            <div className="text-2xl font-bold text-[#5C4033]">{s.value}</div>
            <div className="text-[9px] tracking-[0.2em] text-[#8B7D6F] uppercase mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Promises - 2x2 grid with warm cards */}
      <div className="px-12 grid grid-cols-2 gap-4">
        {PROMISES.map(p => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="p-5 rounded-lg flex gap-4" style={{ background: 'rgba(93,64,51,0.06)', border: '1px solid rgba(201,149,107,0.2)' }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ background: '#5C4033' }}>
                <Icon className="w-5 h-5 text-[#C9956B]" />
              </div>
              <div>
                <h3 className="font-bold text-base text-[#3D3225] mb-1">{p.title}</h3>
                <p className="text-xs text-[#6B5D4F] leading-relaxed">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {brandCertifications && (
        <div className="mx-12 mt-6 px-5 py-3 rounded" style={{ background: 'rgba(201,149,107,0.1)', borderLeft: '3px solid #C9956B' }}>
          <div className="text-[9px] tracking-[0.3em] text-[#C9956B] font-bold mb-1 uppercase">Certifications</div>
          <p className="text-xs text-[#6B5D4F]">{brandCertifications}</p>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 px-12 py-4" style={{ background: '#3D3225' }}>
        <div className="flex justify-between text-[10px] text-[#C9956B] tracking-[0.2em]">
          <span>{companyName.toUpperCase()}</span>
          {licenseNumber && <span>LIC #{licenseNumber}</span>}
        </div>
      </div>
    </div>
  );
};
