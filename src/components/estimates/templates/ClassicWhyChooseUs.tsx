/**
 * Classic Professional Why Choose Us
 * Two-column editorial layout with navy sidebar credentials + main content area.
 * Features a formal letter-style introduction from the company.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Award, ShieldCheck, Wrench, Clock, Star, CheckCircle2 } from 'lucide-react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const ClassicWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandMission,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || `${companyName} has built a reputation on quality workmanship, transparent communication, and an unwavering commitment to doing things right — every time.`;

  const certList = brandCertifications
    ? brandCertifications.split(/[,;·•]/).map(s => s.trim()).filter(Boolean)
    : [];

  return (
    <div
      data-report-page
      className="relative bg-white text-[#1B2A4A] overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {/* Two-column layout */}
      <div className="flex h-full">
        {/* Left navy sidebar — credentials column */}
        <div className="w-[260px] shrink-0 bg-[#1B2A4A] text-white px-6 pt-10 pb-6 flex flex-col">
          <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] mb-6 uppercase">At a Glance</div>
          
          {/* Stats stacked vertically */}
          <div className="space-y-5 mb-8">
            {[
              { value: yearsInBusiness ? `${yearsInBusiness}+` : '20+', label: 'Years in Business' },
              { value: '5-Star', label: 'Customer Rating' },
              { value: '100%', label: 'Licensed & Insured' },
            ].map((s, i) => (
              <div key={i} className="border-b border-white/10 pb-4">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-[9px] tracking-[0.15em] text-[#C9A96E] uppercase mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Certifications */}
          {certList.length > 0 && (
            <div className="mb-6">
              <div className="text-[9px] tracking-[0.3em] text-[#C9A96E] font-bold mb-3 uppercase">Certifications</div>
              <div className="space-y-2">
                {certList.map((cert, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#C9A96E] mt-0.5 shrink-0" />
                    <span className="text-[10px] text-white/80 leading-snug">{cert}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* License */}
          {licenseNumber && (
            <div className="mt-auto pt-4 border-t border-white/10">
              <div className="text-[8px] tracking-[0.2em] text-white/40 uppercase">License</div>
              <div className="text-xs text-[#C9A96E] font-bold mt-0.5">#{licenseNumber}</div>
            </div>
          )}
        </div>

        {/* Right main content */}
        <div className="flex-1 px-10 pt-10 pb-6 flex flex-col">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-[2px] bg-[#C9A96E]" />
              <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] font-bold uppercase">
                Why Choose {companyName}
              </div>
            </div>
            <h2 className="text-3xl font-bold text-[#1B2A4A] leading-tight mb-4">
              Trusted by Homeowners.<br />Proven by Results.
            </h2>
          </div>

          {/* Company story as formal letter-style text */}
          <div className="mb-6">
            <p className="text-sm text-gray-700 leading-relaxed">{heroBlurb}</p>
            {brandMission && (
              <p className="text-sm text-gray-500 leading-relaxed mt-3 italic border-l-2 border-[#C9A96E] pl-4">
                Our Mission: {brandMission}
              </p>
            )}
          </div>

          {/* Stars */}
          <div className="flex items-center gap-1 mb-8">
            {[0,1,2,3,4].map(i => (
              <Star key={i} className="w-4 h-4" style={{ color: '#C9A96E', fill: '#C9A96E' }} />
            ))}
            <span className="ml-2 text-[10px] tracking-wider text-gray-500">CONSISTENTLY 5-STAR REVIEWED</span>
          </div>

          {/* Commitments — vertical list with gold left border */}
          <div className="space-y-4 flex-1">
            {[
              { icon: ShieldCheck, title: 'Lifetime Workmanship Warranty', body: 'Every install is backed in writing — long after the trucks pull away.' },
              { icon: Award, title: 'Manufacturer-Certified Crews', body: 'Factory-trained installers using OEM-approved methods and materials.' },
              { icon: Wrench, title: 'Daily Clean-Up Standard', body: 'Magnetic nail sweeps, debris removal, and a job-site you can live with.' },
              { icon: Clock, title: 'On-Time, On-Budget', body: 'Clear schedules, fixed pricing, no surprise change-orders.' },
            ].map(p => {
              const Icon = p.icon;
              return (
                <div key={p.title} className="flex gap-3 items-start pl-4" style={{ borderLeft: '3px solid #C9A96E' }}>
                  <Icon className="w-5 h-5 shrink-0 text-[#1B2A4A] mt-0.5" />
                  <div>
                    <h3 className="font-bold text-sm text-[#1B2A4A]">{p.title}</h3>
                    <p className="text-xs text-gray-600 leading-relaxed">{p.body}</p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom tagline */}
          <div className="mt-auto pt-4 border-t border-gray-200 text-center">
            <span className="text-[10px] tracking-[0.3em] text-gray-400 uppercase">
              Quality · Integrity · Craftsmanship
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
