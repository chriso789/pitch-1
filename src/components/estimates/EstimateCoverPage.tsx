/**
 * EstimateCoverPage — Bold, magazine-style cover page for estimate PDFs.
 *
 * Visual style: full-bleed property hero, oversized editorial typography,
 * brand color blocks, asymmetric layout. Designed for "wow" first impression
 * on both the printed PDF and the embedded online quote viewer.
 */
import React from 'react';

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

interface CompanyInfo {
  name: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
  established_year?: number | null;
  brand_story?: string | null;
  brand_mission?: string | null;
  brand_certifications?: string | null;
  brand_headline?: string | null;
  brand_tagline?: string | null;
  brand_primary_color?: string | null;
  brand_accent_color?: string | null;
}

interface EstimateCoverPageProps {
  companyInfo?: CompanyInfo;
  companyLogo?: string;
  companyName: string;
  customerName: string;
  customerAddress: string;
  estimateNumber: string;
  createdAt?: string;
  propertyPhoto?: string;
  estimateName?: string;
}

export const EstimateCoverPage: React.FC<EstimateCoverPageProps> = ({
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

  // Show the company's actual founding year if known. Fall back to the
  // estimate/issue year only when the tenant hasn't configured one.
  const yearStr = companyInfo?.established_year
    ? companyInfo.established_year
    : (createdAt ? new Date(createdAt) : new Date()).getFullYear();

  const companyAddressParts = [
    companyInfo?.address_street,
    [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
    companyInfo?.address_zip,
  ].filter(Boolean);
  const companyAddressStr = companyAddressParts.join(' • ');

  const logoUrl = companyLogo || companyInfo?.logo_url;
  const displayCompanyName = companyInfo?.name || companyName;
  const primaryColor = companyInfo?.brand_primary_color || 'hsl(var(--primary))';
  const accentColor = companyInfo?.brand_accent_color || '#1a1a2e';
  const eyebrow = companyInfo?.brand_tagline || 'PROJECT PROPOSAL';

  // Parse headline: use pipe-separated parts "LINE1|ACCENT|LINE2"
  const headlineParts = companyInfo?.brand_headline
    ? companyInfo.brand_headline.split('|').map(s => s.trim())
    : ['YOUR', 'HOME.', 'REIMAGINED.'];

  return (
    <div
      data-report-page
      className="relative bg-white text-black overflow-hidden"
      style={{
        width: `${PAGE_WIDTH}px`,
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* HERO IMAGE — top 60% of the page, full-bleed */}
      <div className="absolute top-0 left-0 right-0" style={{ height: '60%' }}>
        {propertyPhoto ? (
          <img
            src={propertyPhoto}
            alt="Property"
            className="w-full h-full object-cover"
          />
        ) : (
          <div
            className="w-full h-full"
            style={{
              background:
                `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)`,
            }}
          />
        )}

        {/* Dark gradient scrim for text legibility */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.15) 35%, rgba(0,0,0,0.05) 60%, rgba(0,0,0,0.85) 100%)',
          }}
        />

        {/* Top bar — logo + year tag */}
        <div className="absolute top-0 left-0 right-0 flex items-start justify-between p-8">
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={displayCompanyName}
                className="h-14 object-contain drop-shadow-lg"
                style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))' }}
              />
            ) : (
              <div className="text-white text-xl font-bold tracking-tight drop-shadow-lg">
                {displayCompanyName}
              </div>
            )}
          </div>
          <div className="text-right">
            <div
              className="inline-block px-3 py-1 text-[10px] font-bold tracking-[0.3em] text-white border border-white/60 rounded-sm backdrop-blur-sm"
              style={{ background: 'rgba(255,255,255,0.08)' }}
            >
              EST. {yearStr}
            </div>
          </div>
        </div>

        {/* Bottom of hero — oversized PROPOSAL wordmark */}
        <div className="absolute bottom-0 left-0 right-0 px-10 pb-10">
          <div className="text-white">
            <div className="text-[11px] font-semibold tracking-[0.4em] opacity-80 mb-2">
              PROJECT PROPOSAL
            </div>
            <h1
              className="font-black leading-[0.85] tracking-tight drop-shadow-xl"
              style={{
                fontSize: '92px',
                letterSpacing: '-0.04em',
                lineHeight: 0.85,
              }}
            >
              YOUR
              <br />
              <span style={{ color: 'hsl(var(--primary))' }}>HOME.</span>{' '}
              REIMAGINED.
            </h1>
          </div>
        </div>
      </div>

      {/* WHITE LOWER PANEL — 40% of the page */}
      <div
        className="absolute bottom-0 left-0 right-0 bg-white"
        style={{ height: '40%' }}
      >
        {/* Brand color slash */}
        <div
          className="absolute top-0 left-0 right-0"
          style={{
            height: '10px',
            background:
              'linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary)) 65%, #1a1a2e 65%, #1a1a2e 100%)',
          }}
        />

        <div className="px-10 pt-10 pb-8 h-full flex flex-col justify-between">
          {/* Two-column block: PREPARED FOR | PROJECT META */}
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-7">
              <div className="text-[10px] font-bold tracking-[0.3em] text-gray-400 mb-3">
                PREPARED EXCLUSIVELY FOR
              </div>
              <h2
                className="font-bold text-gray-900 leading-tight mb-2"
                style={{ fontSize: '34px', letterSpacing: '-0.02em' }}
              >
                {customerName}
              </h2>
              <p className="text-gray-600 text-base leading-snug max-w-[320px]">
                {customerAddress}
              </p>
            </div>

            <div className="col-span-5 border-l-2 border-gray-100 pl-6">
              <div className="space-y-4">
                <div>
                  <div className="text-[9px] font-bold tracking-[0.25em] text-gray-400 mb-1">
                    PROPOSAL №
                  </div>
                  <div className="text-2xl font-bold text-gray-900 tracking-tight">
                    {estimateNumber}
                  </div>
                </div>
                <div>
                  <div className="text-[9px] font-bold tracking-[0.25em] text-gray-400 mb-1">
                    ISSUED
                  </div>
                  <div className="text-base font-semibold text-gray-900">
                    {dateStr}
                  </div>
                </div>
                {estimateName && (
                  <div>
                    <div className="text-[9px] font-bold tracking-[0.25em] text-gray-400 mb-1">
                      SCOPE
                    </div>
                    <div className="text-sm font-medium text-gray-700 leading-tight">
                      {estimateName}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* PREPARED BY — bottom strip */}
          <div className="border-t border-gray-200 pt-5 mt-4">
            <div className="flex items-end justify-between gap-6">
              <div className="flex-1 min-w-0">
                <div className="text-[10px] font-bold tracking-[0.3em] text-gray-400 mb-1.5">
                  PREPARED BY
                </div>
                <div
                  className="font-bold text-gray-900 leading-tight"
                  style={{ fontSize: '20px', letterSpacing: '-0.01em' }}
                >
                  {displayCompanyName}
                </div>
                {companyAddressStr && (
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    {companyAddressStr}
                  </p>
                )}
              </div>
              <div className="text-right shrink-0 space-y-0.5">
                {companyInfo?.phone && (
                  <div className="text-sm font-semibold text-gray-800">
                    {companyInfo.phone}
                  </div>
                )}
                {companyInfo?.email && (
                  <div className="text-xs text-gray-600">
                    {companyInfo.email}
                  </div>
                )}
                {companyInfo?.license_number && (
                  <div className="text-[10px] text-gray-400 tracking-wider">
                    LIC #{companyInfo.license_number}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EstimateCoverPage;
