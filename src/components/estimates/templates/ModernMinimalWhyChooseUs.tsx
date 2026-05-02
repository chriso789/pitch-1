/**
 * Modern Minimal Why Choose Us
 * Clean whitespace, thin type, subtle accent lines.
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
  brandCertifications,
}) => {
  const yearsInBusiness = establishedYear ? Math.max(1, new Date().getFullYear() - establishedYear) : null;
  const heroBlurb = brandStory || "You're not just hiring a contractor — you're hiring a team obsessed with doing it right the first time.";

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

        <p className="text-base text-gray-500 font-light max-w-[520px] leading-relaxed mb-12">
          {heroBlurb}
        </p>

        {/* Stats - minimal row */}
        <div className="flex gap-16 mb-14">
          {[
            { value: yearsInBusiness ? `${yearsInBusiness}` : '20', label: 'years' },
            { value: '5,000', label: 'projects' },
            { value: '5.0', label: 'rating' },
          ].map((s, i) => (
            <div key={i}>
              <div className="text-4xl font-extralight text-black">{s.value}</div>
              <div className="text-xs text-gray-400 tracking-wider uppercase mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Commitments - simple checklist */}
        <div className="space-y-4">
          {commitments.map((c, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-5 h-5 rounded-full border border-black flex items-center justify-center shrink-0">
                <Check className="w-3 h-3" />
              </div>
              <span className="text-sm text-gray-700 font-light">{c}</span>
            </div>
          ))}
        </div>

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
