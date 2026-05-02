/**
 * Premium Dark Cover Page
 * Full dark theme, luxury feel, metallic silver/platinum accents.
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
      {/* Subtle gradient overlay */}
      <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at top right, rgba(180,180,200,0.06) 0%, transparent 60%)' }} />

      {/* Top bar */}
      <div className="relative z-10 px-12 pt-10 flex items-start justify-between">
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <img src={logoUrl} alt={displayName} className="h-12 object-contain" style={{ filter: 'brightness(2)' }} />
          ) : (
            <span className="text-xl font-bold tracking-[0.1em]">{displayName}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {yearStr && (
            <div className="text-[10px] tracking-[0.3em] text-[#A0A0A0] border border-[#333] px-3 py-1">
              EST. {yearStr}
            </div>
          )}
        </div>
      </div>

      {/* Center content — photo floats right */}
      <div className="relative z-10 px-12 pt-20 flex gap-10">
        <div className="flex-1">
          <div className="text-[11px] tracking-[0.5em] text-[#888] uppercase mb-6">Project Proposal</div>
          <h1 className="text-5xl font-bold leading-tight tracking-tight mb-6" style={{ color: '#FFFFFF' }}>
            {customerName}
          </h1>
          {/* Metallic accent line */}
          <div className="w-20 h-[2px] mb-6" style={{ background: 'linear-gradient(90deg, #A0A0A0, #666)' }} />
          <p className="text-base text-[#999] mb-2">{customerAddress}</p>
          {estimateName && <p className="text-sm text-[#666] italic">{estimateName}</p>}
        </div>
        {propertyPhoto && (
          <div className="w-[300px] h-[280px] shrink-0 overflow-hidden rounded" style={{ border: '1px solid #333' }}>
            <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
          </div>
        )}
      </div>

      {/* Stats strip */}
      <div className="relative z-10 mx-12 mt-16 grid grid-cols-3 border-t border-b border-[#222] divide-x divide-[#222]">
        <div className="py-5 text-center">
          <div className="text-2xl font-bold text-white">{estimateNumber}</div>
          <div className="text-[9px] tracking-[0.3em] text-[#666] mt-1">PROPOSAL №</div>
        </div>
        <div className="py-5 text-center">
          <div className="text-lg font-semibold text-white">{dateStr}</div>
          <div className="text-[9px] tracking-[0.3em] text-[#666] mt-1">ISSUED</div>
        </div>
        <div className="py-5 text-center">
          {companyInfo?.phone && <div className="text-lg font-semibold text-white">{companyInfo.phone}</div>}
          <div className="text-[9px] tracking-[0.3em] text-[#666] mt-1">CONTACT</div>
        </div>
      </div>

      {/* Bottom branding */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-12 py-6 border-t border-[#1A1A1A]">
        <div className="flex justify-between items-end text-xs">
          <div>
            <div className="text-sm font-bold text-white">{displayName}</div>
            {companyInfo?.email && <div className="text-[#666] mt-0.5">{companyInfo.email}</div>}
          </div>
          <div className="text-right text-[#555]">
            {companyInfo?.license_number && <div>License #{companyInfo.license_number}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
