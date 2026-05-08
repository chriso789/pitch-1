/**
 * Classic Professional Cover Page
 * Formal, traditional layout with navy header, gold accents, serif typography.
 * Designed for established companies that want a prestigious, trustworthy feel.
 * Layout: Top branding bar → full-width photo → centered customer block → bottom info strip.
 */
import React from 'react';
import { CoverPageProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const ClassicCoverPage: React.FC<CoverPageProps> = ({
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

  const companyAddr = [
    companyInfo?.address_street,
    [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
    companyInfo?.address_zip,
  ].filter(Boolean).join(' · ');

  return (
    <div
      data-report-page
      className="relative bg-white text-black overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {/* Navy header bar with gold border */}
      <div className="bg-[#1B2A4A] text-white px-10 pt-8 pb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {logoUrl && (
              <img src={logoUrl} alt={displayName} className="h-16 object-contain" />
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-wide">{displayName}</h1>
              {companyInfo?.brand_mission && (
                <p className="text-[10px] text-white/60 italic mt-0.5 max-w-[300px]">{companyInfo.brand_mission}</p>
              )}
            </div>
          </div>
          <div className="text-right space-y-1">
            {yearStr && (
              <div className="text-[10px] tracking-[0.3em] text-[#C9A96E] font-bold">
                ESTABLISHED {yearStr}
              </div>
            )}
            {companyInfo?.license_number && (
              <div className="text-[9px] text-white/50">License #{companyInfo.license_number}</div>
            )}
            {companyInfo?.brand_certifications && (
              <div className="text-[9px] text-[#C9A96E]/80 max-w-[200px] text-right">{companyInfo.brand_certifications}</div>
            )}
          </div>
        </div>
      </div>

      {/* Gold accent line */}
      <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #C9A96E 0%, #E8D5A3 50%, #C9A96E 100%)' }} />

      {/* Property photo */}
      <div className="px-10 pt-6">
        {propertyPhoto ? (
          <div className="w-full h-[300px] overflow-hidden border-2 border-[#1B2A4A]/10">
            <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-full h-[300px] bg-gradient-to-br from-[#1B2A4A] to-[#2D4A7A]" />
        )}
      </div>

      {/* Decorative divider */}
      <div className="flex items-center gap-4 px-10 py-5">
        <div className="flex-1 h-[1px] bg-[#C9A96E]/40" />
        <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] font-bold">PROJECT PROPOSAL</div>
        <div className="flex-1 h-[1px] bg-[#C9A96E]/40" />
      </div>

      {/* Customer info — formal centered layout */}
      <div className="text-center px-10">
        <h2 className="text-2xl font-bold text-[#1B2A4A] mb-2" style={{ fontFamily: "'Georgia', serif" }}>
          {customerName}
        </h2>
        <p className="text-sm text-gray-600">{customerAddress}</p>
        {estimateName && <p className="text-sm text-[#C9A96E] italic mt-2">{estimateName}</p>}
      </div>

      {/* Experience / About strip */}
      {(companyInfo?.brand_story || yearsInBusiness) && (
        <div className="mx-10 mt-6 px-6 py-4 bg-[#F8F6F1] border border-[#C9A96E]/20 text-center">
          <p className="text-xs text-gray-600 leading-relaxed italic max-w-[500px] mx-auto">
            {companyInfo?.brand_story || `With ${yearsInBusiness}+ years of industry experience, ${displayName} delivers premium craftsmanship backed by integrity and attention to detail.`}
          </p>
        </div>
      )}

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 border-t-2 border-[#C9A96E]">
        <div className="px-10 py-5 flex justify-between items-end">
          <div>
            <div className="text-[9px] tracking-[0.3em] text-gray-400 uppercase mb-1">Proposal №</div>
            <div className="text-lg font-bold text-[#1B2A4A]">{estimateNumber}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] tracking-[0.3em] text-gray-400 uppercase mb-1">Issued</div>
            <div className="text-sm font-semibold text-[#1B2A4A]">{dateStr}</div>
          </div>
          <div className="text-right text-xs">
            {companyInfo?.phone && <div className="text-[#1B2A4A] font-semibold">{companyInfo.phone}</div>}
            {companyInfo?.email && <div className="text-gray-500">{companyInfo.email}</div>}
            {companyAddr && <div className="text-gray-400 mt-0.5 text-[10px]">{companyAddr}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
