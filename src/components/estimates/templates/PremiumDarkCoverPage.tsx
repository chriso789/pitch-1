/**
 * Premium Dark Cover Page
 * Full dark theme, luxury feel. Split hero: left content, right photo.
 * Metallic silver accents, subtle gradient overlays.
 * Designed for companies that want to communicate premium quality and exclusivity.
 */
import React from 'react';
import { CoverPageProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const PremiumDarkCoverPage: React.FC<CoverPageProps> = ({
  companyInfo,
  companyLogo,
  companyName,
  customerName,
  customerAddress,
  estimateNumber,
  createdAt,
  propertyPhoto,
  estimateName,
}) => {
  const dateStr = createdAt
    ? new Date(createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const logoUrl = companyLogo || companyInfo?.logo_url;
  const displayName = companyInfo?.name || companyName;
  const yearStr = companyInfo?.established_year || '';
  const yearsInBusiness = companyInfo?.established_year
    ? Math.max(1, new Date().getFullYear() - companyInfo.established_year)
    : null;

  return (
    <div
      data-report-page
      className="relative overflow-hidden"
      style={{
        width: PAGE_WIDTH,
        minHeight: PAGE_HEIGHT,
        maxHeight: PAGE_HEIGHT,
        fontFamily: "'Inter', system-ui, sans-serif",
        background: '#0A0A0A',
        color: '#E8E8E8',
      }}
    >
      {/* Subtle gradient overlays */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top right, rgba(180,180,200,0.06) 0%, transparent 60%)' }} />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at bottom left, rgba(140,140,160,0.04) 0%, transparent 50%)' }} />

      {/* Top bar with logo */}
      <div className="relative z-10 px-10 pt-8 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={displayName} className="h-12 object-contain" style={{ filter: 'brightness(2)' }} />
          ) : (
            <span className="text-xl font-bold tracking-[0.1em]">{displayName}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {yearStr && (
            <div className="text-[10px] tracking-[0.3em] text-[#A0A0A0] border border-[#333] px-3 py-1.5">
              EST. {yearStr}
            </div>
          )}
          {yearsInBusiness && (
            <div className="text-[9px] text-[#555]">{yearsInBusiness}+ years</div>
          )}
        </div>
      </div>

      {/* Main split: left text, right photo */}
      <div className="relative z-10 flex h-[520px] mt-8">
        {/* Left — proposal content */}
        <div className="flex-1 px-10 flex flex-col justify-center">
          <div className="text-[11px] tracking-[0.5em] text-[#666] uppercase mb-4">Project Proposal</div>
          <h1 className="text-3xl font-bold leading-tight tracking-tight mb-5" style={{ color: '#FFFFFF' }}>
            {customerName}
          </h1>
          <div className="w-20 h-[2px] mb-5" style={{ background: 'linear-gradient(90deg, #A0A0A0, #444)' }} />
          <p className="text-base text-[#888] mb-2">{customerAddress}</p>
          {estimateName && <p className="text-sm text-[#555] italic mt-1">{estimateName}</p>}

          {/* Company story — premium context */}
          {companyInfo?.brand_story && (
            <div className="mt-6 pt-5 border-t border-[#222]">
              <p className="text-xs text-[#666] leading-relaxed italic max-w-[350px]">
                "{companyInfo.brand_story}"
              </p>
            </div>
          )}
        </div>

        {/* Right — photo with gradient mask */}
        {propertyPhoto && (
          <div className="w-[340px] shrink-0 relative overflow-hidden">
            <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
            {/* Left fade to blend into dark bg */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, #0A0A0A 0%, transparent 30%)' }} />
            {/* Bottom fade */}
            <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, transparent 60%, #0A0A0A 100%)' }} />
          </div>
        )}
      </div>

      {/* Stats strip */}
      <div className="relative z-10 mx-10 mt-6 grid grid-cols-3 border-t border-b border-[#1A1A1A] divide-x divide-[#1A1A1A]">
        <div className="py-5 text-center">
          <div className="text-xl font-bold text-white">{estimateNumber}</div>
          <div className="text-[9px] tracking-[0.3em] text-[#555] mt-1">PROPOSAL №</div>
        </div>
        <div className="py-5 text-center">
          <div className="text-sm font-semibold text-white">{dateStr}</div>
          <div className="text-[9px] tracking-[0.3em] text-[#555] mt-1">ISSUED</div>
        </div>
        <div className="py-5 text-center">
          {companyInfo?.phone && <div className="text-sm font-semibold text-white">{companyInfo.phone}</div>}
          <div className="text-[9px] tracking-[0.3em] text-[#555] mt-1">CONTACT</div>
        </div>
      </div>

      {/* Bottom branding */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-10 py-5 border-t border-[#1A1A1A]">
        <div className="flex justify-between items-end text-xs">
          <div>
            <div className="text-sm font-bold text-white">{displayName}</div>
            {companyInfo?.email && <div className="text-[#555] mt-0.5">{companyInfo.email}</div>}
          </div>
          <div className="text-right text-[#444]">
            {companyInfo?.license_number && <div>License #{companyInfo.license_number}</div>}
            {companyInfo?.brand_certifications && (
              <div className="text-[10px] text-[#444] mt-0.5 max-w-[200px] text-right">{companyInfo.brand_certifications}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
