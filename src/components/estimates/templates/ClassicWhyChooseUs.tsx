/**
 * Classic Professional Why Choose Us
 * TWO-COLUMN: Navy sidebar with credentials → main content with formal letter-style narrative.
 * Structure: sidebar stats + certs | letter-tone narrative + vertical promise list with gold left borders.
 * DISTINCT from Bold-Editorial: no hero header band, no stats grid row, no pull-quote testimonial, no satisfaction guarantee bar.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { CheckCircle2 } from 'lucide-react';

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

  // Dynamic stats — only show what the company actually has
  const stats: { value: string; label: string }[] = [];
  if (yearsInBusiness) stats.push({ value: `${yearsInBusiness}+`, label: 'Years in Business' });
  if (certList.length > 0) stats.push({ value: `${certList.length}`, label: 'Certifications' });
  stats.push({ value: '100%', label: 'Licensed & Insured' });

  // Dynamic commitments based on company brand data
  const commitments: { title: string; body: string }[] = [];
  if (brandMission) {
    commitments.push({ title: 'Our Mission', body: brandMission });
  }
  if (brandCertifications) {
    commitments.push({ title: 'Professional Standards', body: `Our team carries active credentials: ${brandCertifications}.` });
  }
  if (yearsInBusiness && yearsInBusiness > 5) {
    commitments.push({ title: 'Proven Track Record', body: `With ${yearsInBusiness}+ years serving our community, we\'ve refined every step of the process to deliver consistent, high-quality results.` });
  }
  commitments.push({ title: 'Transparent Communication', body: `From your first call to final walkthrough, ${companyName} keeps you informed with clear timelines, honest pricing, and proactive updates.` });
  if (licenseNumber) {
    commitments.push({ title: 'Licensed & Verified', body: `We operate under license #${licenseNumber} — fully licensed, bonded, and insured for your protection.` });
  }

  return (
    <div
      data-report-page
      className="relative bg-white text-[#1B2A4A] overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      <div className="flex h-full">
        {/* Left navy sidebar — credentials column */}
        <div className="w-[260px] shrink-0 bg-[#1B2A4A] text-white px-6 pt-10 pb-6 flex flex-col">
          <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] mb-6 uppercase">At a Glance</div>
          
          <div className="space-y-5 mb-8">
            {stats.map((s, i) => (
              <div key={i} className="border-b border-white/10 pb-4">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-[9px] tracking-[0.15em] text-[#C9A96E] uppercase mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

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

          {licenseNumber && (
            <div className="mt-auto pt-4 border-t border-white/10">
              <div className="text-[8px] tracking-[0.2em] text-white/40 uppercase">License</div>
              <div className="text-xs text-[#C9A96E] font-bold mt-0.5">#{licenseNumber}</div>
            </div>
          )}
        </div>

        {/* Right main content */}
        <div className="flex-1 px-10 pt-10 pb-6 flex flex-col">
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-[2px] bg-[#C9A96E]" />
              <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] font-bold uppercase">
                Why Choose {companyName}
              </div>
            </div>
            <h2 className="text-3xl font-bold text-[#1B2A4A] leading-tight mb-4">
              The Right Team<br />Makes All the Difference.
            </h2>
          </div>

          {/* Company story */}
          <div className="mb-8">
            <p className="text-sm text-gray-700 leading-relaxed">{heroBlurb}</p>
          </div>

          {/* Dynamic commitments */}
          <div className="space-y-4 flex-1">
            {commitments.slice(0, 4).map(p => (
              <div key={p.title} className="flex gap-3 items-start pl-4" style={{ borderLeft: '3px solid #C9A96E' }}>
                <div>
                  <h3 className="font-bold text-sm text-[#1B2A4A]">{p.title}</h3>
                  <p className="text-xs text-gray-600 leading-relaxed">{p.body}</p>
                </div>
              </div>
            ))}
          </div>

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
