/**
 * Warm Craftsman Cover Page
 * Earthy tones, stone/wood texture feel, warm amber accents, rustic badge.
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
      {/* Warm textured header band */}
      <div
        className="px-12 pt-10 pb-8"
        style={{ background: 'linear-gradient(135deg, #5C4033 0%, #3D3225 100%)' }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            {logoUrl ? (
              <img src={logoUrl} alt={displayName} className="h-14 object-contain" style={{ filter: 'brightness(10)' }} />
            ) : (
              <div className="text-2xl font-bold text-[#F5F0E8] tracking-wide">{displayName}</div>
            )}
          </div>
          {yearStr && (
            <div className="text-right">
              <div className="px-4 py-2 border-2 border-[#C9956B]/60 rounded-full text-[#C9956B] text-[10px] font-bold tracking-[0.3em]">
                EST. {yearStr}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Amber accent strip */}
      <div className="h-[5px]" style={{ background: 'linear-gradient(90deg, #C9956B, #D4A574, #C9956B)' }} />

      {/* Property photo with warm border */}
      <div className="px-12 pt-8">
        {propertyPhoto ? (
          <div className="w-full h-[300px] rounded-lg overflow-hidden shadow-lg" style={{ border: '3px solid #C9956B' }}>
            <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-full h-[300px] rounded-lg" style={{ background: 'linear-gradient(135deg, #5C4033, #3D3225)', border: '3px solid #C9956B' }} />
        )}
      </div>

      {/* Customer info with decorative elements */}
      <div className="px-12 pt-8">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-[2px] bg-[#C9956B]" />
          <div className="text-[10px] font-bold tracking-[0.4em] text-[#C9956B] uppercase">
            Project Proposal
          </div>
          <div className="flex-1 h-[1px] bg-[#C9956B]/30" />
        </div>
        <h2 className="text-4xl font-bold text-[#3D3225] mb-2">{customerName}</h2>
        <p className="text-base text-[#6B5D4F]">{customerAddress}</p>
        {estimateName && <p className="text-sm text-[#8B7D6F] italic mt-2">{estimateName}</p>}
      </div>

      {/* Bottom bar */}
      <div className="absolute bottom-0 left-0 right-0 px-12 py-6" style={{ background: '#3D3225' }}>
        <div className="flex justify-between items-end text-[#F5F0E8]">
          <div>
            <div className="text-[9px] tracking-[0.3em] text-[#C9956B] uppercase mb-1">Proposal №</div>
            <div className="text-xl font-bold">{estimateNumber}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] tracking-[0.3em] text-[#C9956B] uppercase mb-1">Date</div>
            <div className="text-sm">{dateStr}</div>
          </div>
          <div className="text-right text-xs">
            {companyInfo?.phone && <div className="font-semibold">{companyInfo.phone}</div>}
            {companyInfo?.email && <div className="text-[#C9956B]">{companyInfo.email}</div>}
            {companyInfo?.license_number && <div className="text-[#F5F0E8]/50 mt-0.5">Lic #{companyInfo.license_number}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
