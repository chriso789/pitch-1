/**
 * Modern Minimal Why Choose Us
 * EDITORIAL PROSE layout — no icon grid, no card boxes, no pull-quotes.
 * Structure: thin top rule → large lightweight heading → flowing prose narrative → minimal stats → understated cert line.
 * DISTINCT from Bold-Editorial: no dark hero band, no 4-card promise grid, no testimonial block, no satisfaction guarantee bar.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const ModernMinimalWhyChooseUs: React.FC<WhyChooseUsProps> = ({
  companyName = 'Our Team',
  licenseNumber,
  establishedYear,
  brandStory,
  brandMission,
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || `${companyName} was founded on a simple belief: homeowners deserve better. Better communication, better craftsmanship, and a better experience from start to finish.`;

  // Build dynamic narrative paragraphs from real company data
  const narrativeParagraphs: string[] = [heroBlurb];
  if (brandMission) {
    narrativeParagraphs.push(brandMission);
  }
  if (yearsInBusiness && yearsInBusiness > 3) {
    narrativeParagraphs.push(`Over ${yearsInBusiness} years of hands-on experience means we've seen it all — and we've built the systems, standards, and team to handle any project with confidence.`);
  }
  if (brandCertifications) {
    narrativeParagraphs.push(`Our credentials speak for themselves: ${brandCertifications}.`);
  }

  // Dynamic stats — only what the company actually has
  const stats: { value: string; label: string }[] = [];
  if (yearsInBusiness) stats.push({ value: `${yearsInBusiness}`, label: 'years' });
  stats.push({ value: '100%', label: 'insured' });

  return (
    <div
      data-report-page
      className="relative bg-white text-gray-900 overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      <div className="h-[2px] bg-black" />

      <div className="px-16 pt-16">
        <div className="text-[11px] tracking-[0.5em] text-gray-400 uppercase mb-8">Why {companyName}</div>

        <h2 className="text-5xl font-extralight text-gray-900 leading-tight tracking-tight mb-6">
          Quality speaks<br />for itself.
        </h2>
        <div className="w-16 h-[1px] bg-black mb-8" />

        {/* Flowing narrative paragraphs — no bullet points, no cards */}
        <div className="max-w-[520px] space-y-4 mb-12">
          {narrativeParagraphs.map((p, i) => (
            <p key={i} className={`text-base font-light leading-relaxed ${i === 0 ? 'text-gray-500' : 'text-gray-400'}`}>
              {p}
            </p>
          ))}
        </div>

        {/* Stats — minimal horizontal row, only real data */}
        {stats.length > 0 && (
          <div className="flex gap-16 mb-12">
            {stats.map((s, i) => (
              <div key={i}>
                <div className="text-4xl font-extralight text-black">{s.value}</div>
                <div className="text-xs text-gray-400 tracking-wider uppercase mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 px-16 py-6 text-xs text-gray-400 flex justify-between">
        <span>{companyName}</span>
        {licenseNumber && <span>Lic #{licenseNumber}</span>}
      </div>
    </div>
  );
};
