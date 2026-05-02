/**
 * Classic Professional Why Choose Us
 * Navy/gold, traditional layout, centered, serif accents.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Award, ShieldCheck, Wrench, Clock, Star } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

const PROMISES = [
  { icon: ShieldCheck, title: 'Lifetime Workmanship Warranty', body: 'Every install is backed in writing — long after the trucks pull away.' },
  { icon: Award, title: 'Manufacturer-Certified Crews', body: 'Factory-trained installers using OEM-approved methods and materials.' },
  { icon: Wrench, title: 'Daily Clean-Up Standard', body: 'Magnetic nail sweeps, debris removal, and a job-site you can live with.' },
  { icon: Clock, title: 'On-Time, On-Budget', body: 'Clear schedules, fixed pricing, no surprise change-orders.' },
];

export const ClassicWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || "You're not just hiring a contractor — you're hiring a team obsessed with doing it right the first time.";

  return (
    <div
      data-report-page
      className="relative bg-white text-[#1B2A4A] overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {/* Header with navy bg */}
      <div className="bg-[#1B2A4A] text-white px-12 pt-10 pb-8 text-center">
        <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] mb-3 uppercase">
          Why Choose {companyName}
        </div>
        <h2 className="text-4xl font-bold mb-4" style={{ fontFamily: "'Georgia', serif" }}>
          Trusted by Homeowners
        </h2>
        <p className="text-sm text-white/70 max-w-[500px] mx-auto leading-relaxed">{heroBlurb}</p>
        <div className="flex justify-center gap-1 mt-5">
          {[0,1,2,3,4].map(i => (
            <Star key={i} className="w-4 h-4" style={{ color: '#C9A96E', fill: '#C9A96E' }} />
          ))}
        </div>
      </div>

      {/* Gold accent */}
      <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #C9A96E, #E8D5A3, #C9A96E)' }} />

      {/* Stats in elegant boxes */}
      <div className="grid grid-cols-4 gap-4 px-12 py-8">
        {[
          { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years in Business' },
          { value: '5,000+', label: 'Projects Completed' },
          { value: '5.0', label: 'Customer Rating' },
          { value: '100%', label: 'Licensed & Insured' },
        ].map((s, i) => (
          <div key={i} className="text-center py-5 border border-[#1B2A4A]/10 rounded">
            <div className="text-3xl font-bold text-[#1B2A4A] mb-1">{s.value}</div>
            <div className="text-[10px] tracking-[0.15em] text-gray-500 uppercase">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Promises - stacked list */}
      <div className="px-12 space-y-4">
        {PROMISES.map(p => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="flex gap-4 items-start border-l-3 pl-5 py-3" style={{ borderLeftColor: '#C9A96E', borderLeftWidth: '3px' }}>
              <Icon className="w-6 h-6 shrink-0 text-[#1B2A4A] mt-0.5" />
              <div>
                <h3 className="font-bold text-base text-[#1B2A4A]">{p.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{p.body}</p>
              </div>
            </div>
          );
        })}
      </div>

      {brandCertifications && (
        <div className="mx-12 mt-6 px-5 py-3 bg-[#F8F6F1] border border-[#C9A96E]/30 rounded text-center">
          <div className="text-[9px] tracking-[0.3em] text-[#C9A96E] font-bold mb-1 uppercase">Certifications</div>
          <p className="text-xs text-gray-600">{brandCertifications}</p>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 bg-[#1B2A4A] px-12 py-4 text-center">
        <span className="text-[10px] tracking-[0.3em] text-[#C9A96E]">
          {companyName.toUpperCase()}{licenseNumber ? ` · LIC #${licenseNumber}` : ''}
        </span>
      </div>
    </div>
  );
};
