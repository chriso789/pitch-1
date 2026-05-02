/**
 * Modern Minimal Why Choose Us
 * Clean, editorial, whitespace-driven. Uses numbered list instead of icon grid.
 * Focuses on the company narrative and commitments in flowing prose.
 */
import React from 'react';
import { WhyChooseUsProps } from './types';
import { Check } from 'lucide-react';

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

  const commitments = [
    'Lifetime workmanship warranty on every project',
    'Factory-certified installation crews',
    'Daily job-site cleanup with magnetic nail sweeps',
    'Fixed pricing — no surprise change orders',
    'Manufacturer-backed material warranties',
    'Licensed, bonded, and fully insured',
  ];

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

        {/* Company narrative — prose style, not bullet points */}
        <p className="text-base text-gray-500 font-light max-w-[520px] leading-relaxed mb-4">
          {heroBlurb}
        </p>
        {brandMission && (
          <p className="text-sm text-gray-400 font-light max-w-[480px] leading-relaxed mb-10 italic">
            {brandMission}
          </p>
        )}

        {/* Stats — minimal horizontal row */}
        <div className="flex gap-16 mb-12">
          {[
            { value: yearsInBusiness ? `${yearsInBusiness}` : '—', label: 'years' },
            { value: '5.0', label: 'rating' },
            { value: '100%', label: 'insured' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-4xl font-extralight text-black">{s.value}</div>
              <div className="text-xs text-gray-400 tracking-wider uppercase mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Commitments — simple checklist */}
        <div className="space-y-3.5">
          {commitments.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border border-black flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </div>
              <span className="text-sm text-gray-700 font-light">{c}</span>
            </div>
          ))}
        </div>

        {/* Certifications — understated */}
        {brandCertifications && (
          <div className="mt-10 pt-6 border-t border-gray-100">
            <div className="text-[10px] tracking-[0.3em] text-gray-400 uppercase mb-2">Certifications</div>
            <p className="text-xs text-gray-500 font-light">{brandCertifications}</p>
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
