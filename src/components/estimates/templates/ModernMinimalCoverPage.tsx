/**
 * Modern Minimal Cover Page
 * Whitespace-heavy, thin sans-serif, single accent line, asymmetric layout.
 */
import React from 'react';
import { CoverPageProps } from './types';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

export const ModernMinimalCoverPage: React.FC<CoverPageProps> = ({
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

  return (
    <div
      data-report-page
      className="relative bg-white text-black overflow-hidden"
      style={{ width: PAGE_WIDTH, minHeight: PAGE_HEIGHT, maxHeight: PAGE_HEIGHT, fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif" }}
    >
      {/* Thin top accent */}
      <div className="h-[2px] bg-black" />

      {/* Logo top-left */}
      <div className="px-16 pt-12 flex justify-between items-start">
        <div>
          {logoUrl ? (
            <img src={logoUrl} alt={displayName} className="h-10 object-contain" />
          ) : (
            <span className="text-lg font-light tracking-[0.15em] uppercase">{displayName}</span>
          )}
        </div>
        <div className="text-right text-xs text-gray-400">
          <div>{dateStr}</div>
        </div>
      </div>

      {/* Large vertical space + type */}
      <div className="px-16 pt-24">
        <div className="text-[11px] tracking-[0.5em] text-gray-400 uppercase mb-6">Proposal</div>
        <h1 className="text-6xl font-extralight text-gray-900 leading-tight tracking-tight mb-4">
          {customerName}
        </h1>
        <div className="w-16 h-[1px] bg-black mb-6" />
        <p className="text-base text-gray-500 font-light">{customerAddress}</p>
        {estimateName && <p className="text-sm text-gray-400 font-light mt-2">{estimateName}</p>}
      </div>

      {/* Property photo - right-aligned smaller inset */}
      {propertyPhoto && (
        <div className="absolute right-16 bottom-[200px] w-[340px] h-[220px] overflow-hidden">
          <img src={propertyPhoto} alt="Property" className="w-full h-full object-cover" />
        </div>
      )}

      {/* Bottom strip */}
      <div className="absolute bottom-0 left-0 right-0 px-16 py-8">
        <div className="flex justify-between items-end text-xs text-gray-400">
          <div>
            <span className="text-black font-medium">{estimateNumber}</span>
          </div>
          <div className="text-right space-y-0.5">
            {companyInfo?.phone && <div>{companyInfo.phone}</div>}
            {companyInfo?.email && <div>{companyInfo.email}</div>}
            {companyInfo?.license_number && <div>Lic #{companyInfo.license_number}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
