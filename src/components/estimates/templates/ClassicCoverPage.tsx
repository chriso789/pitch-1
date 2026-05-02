/**
 * Classic Professional Cover Page
 * Traditional layout: navy header band, centered logo, serif-inspired accents, gold rule.
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
  const yearStr = companyInfo?.established_year || new Date().getFullYear();

  const companyAddr = [
    companyInfo?.address_street,
    [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
    companyInfo?.address_zip,
  ].filter(Boolean).join(' • ');

  return (
    <div
      data-report-page
      className="relative bg-white text-black overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      {/* Navy header bar */}
      <div className="bg-[#1B2A4A] text-white px-12 pt-10 pb-8 text-center">
        {logoUrl ? (
          <img src={logoUrl} alt={displayName} className="h-16 mx-auto mb-4 object-contain" />
        ) : (
          <h1 className="text-3xl font-bold mb-2 tracking-wide">{displayName}</h1>
        )}
        {logoUrl && <h1 className="text-2xl font-bold tracking-wide mb-1">{displayName}</h1>}
        <p className="text-xs tracking-[0.3em] text-white/70 uppercase">
          Established {yearStr}
          {companyInfo?.license_number ? ` · License #${companyInfo.license_number}` : ''}
        </p>
      </div>

      {/* Gold accent line */}
      <div className="h-[4px]" style={{ background: 'linear-gradient(90deg, #C9A96E 0%, #E8D5A3 50%, #C9A96E 100%)' }} />

      {/* Property photo - centered with margin */}
      <div className="px-12 pt-8">
        {propertyPhoto ? (
          <div className="w-full h-[320px] rounded-sm overflow-hidden border border-gray-200">
            <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
          </div>
        ) : (
          <div className="w-full h-[320px] rounded-sm bg-gradient-to-br from-[#1B2A4A] to-[#2D4A7A]" />
        )}
      </div>

      {/* Centered proposal info */}
      <div className="text-center px-12 pt-8">
        <div className="text-[10px] tracking-[0.4em] text-[#C9A96E] font-bold mb-3 uppercase">
          Project Proposal
        </div>
        <h2 className="text-4xl font-bold text-[#1B2A4A] mb-2" style={{ fontFamily: "'Georgia', serif" }}>
          {customerName}
        </h2>
        <p className="text-sm text-gray-600 mb-1">{customerAddress}</p>
        {estimateName && <p className="text-sm text-gray-500 italic mt-1">{estimateName}</p>}
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-0 left-0 right-0 px-12 py-6 border-t-2 border-[#C9A96E]">
        <div className="flex justify-between items-end">
          <div>
            <div className="text-[9px] tracking-[0.3em] text-gray-400 uppercase mb-1">Proposal №</div>
            <div className="text-lg font-bold text-[#1B2A4A]">{estimateNumber}</div>
          </div>
          <div className="text-center">
            <div className="text-[9px] tracking-[0.3em] text-gray-400 uppercase mb-1">Issued</div>
            <div className="text-sm font-semibold text-[#1B2A4A]">{dateStr}</div>
          </div>
          <div className="text-right">
            {companyInfo?.phone && <div className="text-sm text-[#1B2A4A] font-semibold">{companyInfo.phone}</div>}
            {companyInfo?.email && <div className="text-xs text-gray-500">{companyInfo.email}</div>}
            {companyAddr && <div className="text-xs text-gray-400 mt-0.5">{companyAddr}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
