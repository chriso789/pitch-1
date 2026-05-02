/**
 * Warm Craftsman Cover Page
 * Earthy tones, rustic warmth, textured backgrounds, badge-style branding.
 * Layout: Full-width header band → split layout (left text + right photo) → bottom bar.
 * Designed for companies that emphasize hands-on craftsmanship and personal touch.
 */
import React from 'react';
import { CoverPageProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const WarmCraftsmanCoverPage: React.FC<CoverPageProps> = ({
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
        fontFamily: "'Georgia', 'Palatino', serif",
        background: 'linear-gradient(180deg, #F5F0E8 0%, #EDE6D6 100%)',
        color: '#3D3225',
      }}
    >
      {/* Header band with logo badge */}
      <div className="px-10 pt-8 pb-6" style={{ background: 'linear-gradient(135deg, #5C4033 0%, #3D3225 100%)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <div className="w-16 h-16 rounded-full bg-[#F5F0E8]/10 flex items-center justify-center p-1.5 border-2 border-[#C9956B]">
                <img src={logoUrl} alt={displayName} className="h-full w-full object-contain" style={{ filter: 'brightness(10)' }} />
              </div>
            ) : null}
            <div>
              <h1 className="text-2xl font-bold text-[#F5F0E8] tracking-wide">{displayName}</h1>
              {companyInfo?.brand_mission && (
                <p className="text-[10px] text-[#C9956B] italic mt-0.5 max-w-[280px]">{companyInfo.brand_mission}</p>
              )}
            </div>
          </div>
          <div className="text-right">
            {yearStr && (
              <div className="px-4 py-2 border-2 border-[#C9956B]/60 rounded-full text-[#C9956B] text-[10px] font-bold tracking-[0.3em]">
                EST. {yearStr}
              </div>
            )}
            {yearsInBusiness && (
              <div className="text-[9px] text-[#F5F0E8]/40 mt-1.5 text-center">
                {yearsInBusiness}+ Years of Service
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Amber accent strip */}
      <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

      {/* Split layout: text left, photo right */}
      <div className="flex gap-0 px-0 pt-0">
        {/* Left side — proposal info */}
        <div className="flex-1 px-10 pt-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-[2px] bg-[#C9956B]" />
            <div className="text-[10px] font-bold tracking-[0.4em] text-[#C9956B] uppercase">Project Proposal</div>
          </div>
          
          <h2 className="text-3xl font-bold text-[#3D3225] mb-3 leading-tight">{customerName}</h2>
          <p className="text-sm text-[#6B5D4F] mb-2">{customerAddress}</p>
          {estimateName && <p className="text-sm text-[#C9956B] italic mt-3">{estimateName}</p>}

          {/* Company story block */}
          {companyInfo?.brand_story && (
            <div className="mt-8 px-5 py-4 rounded-lg" style={{ background: 'rgba(201,149,107,0.08)', borderLeft: '3px solid #C9956B' }}>
              <p className="text-xs text-[#6B5D4F] leading-relaxed italic">{companyInfo.brand_story}</p>
            </div>
          )}

          {/* Proposal details */}
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div>
              <div className="text-[9px] tracking-[0.3em] text-[#8B7D6F] uppercase mb-1">Proposal №</div>
              <div className="text-lg font-bold text-[#3D3225]">{estimateNumber}</div>
            </div>
            <div>
              <div className="text-[9px] tracking-[0.3em] text-[#8B7D6F] uppercase mb-1">Date</div>
              <div className="text-sm font-semibold text-[#3D3225]">{dateStr}</div>
            </div>
          </div>
        </div>

        {/* Right side — full-height photo */}
        <div className="w-[340px] shrink-0">
          {propertyPhoto ? (
            <div className="w-full h-[460px] overflow-hidden" style={{ borderLeft: '5px solid #C9956B' }}>
              <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
            </div>
          ) : (
            <div className="w-full h-[460px]" style={{ background: 'linear-gradient(180deg, #5C4033, #3D3225)', borderLeft: '5px solid #C9956B' }} />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 px-10 py-5" style={{ background: '#3D3225' }}>
        <div className="flex justify-between items-center text-[#F5F0E8]">
          <div className="text-sm font-bold">{displayName}</div>
          <div className="flex gap-6 text-xs">
            {companyInfo?.phone && <span className="text-[#C9956B]">{companyInfo.phone}</span>}
            {companyInfo?.email && <span className="text-[#F5F0E8]/60">{companyInfo.email}</span>}
            {companyInfo?.license_number && <span className="text-[#F5F0E8]/40">Lic #{companyInfo.license_number}</span>}
          </div>
        </div>
      </div>
    </div>
  );
};
