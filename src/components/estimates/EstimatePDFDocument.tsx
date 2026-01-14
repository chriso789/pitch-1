/**
 * EstimatePDFDocument - Multi-page PDF document with proper page breaks
 * 
 * This component renders the estimate as explicit letter-sized pages,
 * ensuring text/rows are never cut mid-page and footer is always at bottom.
 */
import React, { useMemo } from 'react';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { type PDFComponentOptions, getDefaultOptions } from './PDFComponentOptions';

// Letter size: 8.5" x 11" at 96 DPI = 816 x 1056 pixels
const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const HEADER_HEIGHT = 140;
const FOOTER_HEIGHT = 160;
const PAGE_PADDING = 48; // 24px on each side
const CONTENT_HEIGHT = PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - PAGE_PADDING;

// Approximate row height for table items
const ROW_HEIGHT = 36;
const TABLE_HEADER_HEIGHT = 40;
const SECTION_HEADER_HEIGHT = 48;

// Max rows per page (conservative to prevent overflow)
const MAX_ROWS_FIRST_PAGE = 12;
const MAX_ROWS_CONTINUATION = 16;

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
}

interface CompanyLocation {
  id: string;
  name: string;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  phone?: string | null;
  email?: string | null;
  is_primary?: boolean | null;
  logo_url?: string | null;
}

interface MeasurementSummary {
  totalSquares: number;
  totalSqFt: number;
  eaveLength: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  rakeLength: number;
  wastePercent: number;
}

interface JobPhoto {
  id: string;
  file_url: string;
  description?: string | null;
  category?: string | null;
}

interface EstimatePDFDocumentProps {
  estimateNumber: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  companyName?: string;
  companyLogo?: string;
  companyInfo?: CompanyInfo;
  companyLocations?: CompanyLocation[];
  materialItems: LineItem[];
  laborItems: LineItem[];
  breakdown: {
    materialsTotal: number;
    laborTotal: number;
    directCost: number;
    overheadAmount: number;
    totalCost: number;
    profitAmount: number;
    repCommissionAmount: number;
    sellingPrice: number;
    actualProfitMargin: number;
  };
  config: {
    overheadPercent: number;
    profitMarginPercent: number;
    repCommissionPercent: number;
  };
  createdAt?: string;
  finePrintContent?: string;
  options?: Partial<PDFComponentOptions>;
  measurementSummary?: MeasurementSummary;
  jobPhotos?: JobPhoto[];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Chunk items into pages
function chunkItems<T>(items: T[], firstPageMax: number, continuationMax: number): T[][] {
  if (items.length === 0) return [];
  
  const chunks: T[][] = [];
  let remaining = [...items];
  
  // First chunk
  chunks.push(remaining.slice(0, firstPageMax));
  remaining = remaining.slice(firstPageMax);
  
  // Continuation chunks
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, continuationMax));
    remaining = remaining.slice(continuationMax);
  }
  
  return chunks;
}

// Page Header Component
const PageHeader: React.FC<{
  companyLogo?: string;
  companyInfo?: CompanyInfo;
  companyName: string;
  estimateNumber: string;
  dateStr: string;
  opts: PDFComponentOptions;
  isFirstPage?: boolean;
}> = ({ companyLogo, companyInfo, companyName, estimateNumber, dateStr, opts, isFirstPage = false }) => {
  const companyAddressParts = [
    companyInfo?.address_street,
    [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
    companyInfo?.address_zip
  ].filter(Boolean);
  const companyAddressStr = companyAddressParts.join(' ');

  return (
    <div className="flex justify-between items-start pb-3 border-b border-gray-200">
      <div className="flex items-start gap-3">
        {opts.showCompanyLogo && (companyLogo || companyInfo?.logo_url) && (
          <img 
            src={companyLogo || companyInfo?.logo_url || ''} 
            alt={companyInfo?.name || 'Company Logo'} 
            className="h-12 object-contain" 
          />
        )}
        {opts.showCompanyInfo && (
          <div>
            <h1 className="text-lg font-bold text-gray-900">
              {companyInfo?.name || companyName}
            </h1>
            {companyAddressStr && (
              <p className="text-xs text-gray-600">{companyAddressStr}</p>
            )}
            <div className="text-xs text-gray-600">
              {companyInfo?.phone && <span>{companyInfo.phone}</span>}
              {companyInfo?.phone && companyInfo?.email && <span> • </span>}
              {companyInfo?.email && <span>{companyInfo.email}</span>}
            </div>
          </div>
        )}
      </div>
      
      <div className="text-right">
        <p className="text-[10px] text-gray-500 uppercase tracking-wide">Estimate</p>
        {opts.showEstimateNumber && (
          <h2 className="text-base font-bold text-gray-900">{estimateNumber}</h2>
        )}
        {opts.showDate && (
          <p className="text-xs text-gray-500">{dateStr}</p>
        )}
      </div>
    </div>
  );
};

// Page Footer Component
const PageFooter: React.FC<{
  companyLogo?: string;
  companyInfo?: CompanyInfo;
  companyName: string;
  companyLocations?: CompanyLocation[];
  pageNumber: number;
  totalPages: number;
}> = ({ companyLogo, companyInfo, companyName, companyLocations, pageNumber, totalPages }) => {
  const currentYear = new Date().getFullYear();
  
  const locations = companyLocations && companyLocations.length > 0 
    ? companyLocations 
    : [{ 
        id: 'main',
        name: 'Main Office',
        address_street: companyInfo?.address_street,
        address_city: companyInfo?.address_city,
        address_state: companyInfo?.address_state,
        address_zip: companyInfo?.address_zip,
        phone: companyInfo?.phone,
        email: companyInfo?.email
      }];

  return (
    <div className="border-t-2 border-gray-300 bg-gray-50 px-4 py-3">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 min-w-[100px]">
          {(companyLogo || companyInfo?.logo_url) && (
            <img 
              src={companyLogo || companyInfo?.logo_url || ''} 
              alt={companyInfo?.name || 'Company Logo'} 
              className="h-8 object-contain mb-1" 
            />
          )}
          <p className="font-bold text-gray-900 text-xs">
            {companyInfo?.name || companyName}
          </p>
          {companyInfo?.license_number && (
            <p className="text-[10px] text-gray-500">License #{companyInfo.license_number}</p>
          )}
        </div>
        
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2">
          {locations.slice(0, 4).map((location, idx) => (
            <div key={location.id || idx} className="text-[10px]">
              <p className="font-semibold text-gray-800">{location.name}</p>
              {location.address_street && (
                <p className="text-gray-600 leading-tight">{location.address_street}</p>
              )}
              {(location.address_city || location.address_state) && (
                <p className="text-gray-600 leading-tight">
                  {[location.address_city, location.address_state].filter(Boolean).join(', ')}
                  {location.address_zip && ` ${location.address_zip}`}
                </p>
              )}
              {location.phone && (
                <p className="text-gray-600">{location.phone}</p>
              )}
            </div>
          ))}
        </div>
      </div>
      
      <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between items-center text-[10px] text-gray-400">
        <span>© {currentYear} {companyInfo?.name || companyName}. All rights reserved.</span>
        <span>Page {pageNumber} of {totalPages}</span>
      </div>
    </div>
  );
};

// Page Shell - wraps content with header/footer
const PageShell: React.FC<{
  children: React.ReactNode;
  companyLogo?: string;
  companyInfo?: CompanyInfo;
  companyName: string;
  companyLocations?: CompanyLocation[];
  estimateNumber: string;
  dateStr: string;
  opts: PDFComponentOptions;
  pageNumber: number;
  totalPages: number;
  showHeader?: boolean;
}> = ({
  children,
  companyLogo,
  companyInfo,
  companyName,
  companyLocations,
  estimateNumber,
  dateStr,
  opts,
  pageNumber,
  totalPages,
  showHeader = true,
}) => {
  return (
    <div 
      data-report-page
      className="bg-white text-black flex flex-col"
      style={{ 
        width: `${PAGE_WIDTH}px`, 
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
        fontFamily: 'Inter, system-ui, sans-serif',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      {showHeader && opts.showPageHeader && (
        <div className="px-6 pt-4 pb-2">
          <PageHeader
            companyLogo={companyLogo}
            companyInfo={companyInfo}
            companyName={companyName}
            estimateNumber={estimateNumber}
            dateStr={dateStr}
            opts={opts}
            isFirstPage={pageNumber === 1}
          />
        </div>
      )}
      
      {/* Content */}
      <div className="flex-1 px-6 py-3 overflow-hidden">
        {children}
      </div>
      
      {/* Footer */}
      {opts.showPageFooter && (
        <div className="mt-auto">
          <PageFooter
            companyLogo={companyLogo}
            companyInfo={companyInfo}
            companyName={companyName}
            companyLocations={companyLocations}
            pageNumber={pageNumber}
            totalPages={totalPages}
          />
        </div>
      )}
    </div>
  );
};

// Main Document Component
export const EstimatePDFDocument: React.FC<EstimatePDFDocumentProps> = ({
  estimateNumber,
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  companyName = 'PITCH CRM',
  companyLogo,
  companyInfo,
  companyLocations,
  materialItems,
  laborItems,
  breakdown,
  config,
  createdAt,
  finePrintContent,
  options: partialOptions,
  measurementSummary,
  jobPhotos,
}) => {
  const opts: PDFComponentOptions = { ...getDefaultOptions('customer'), ...partialOptions };

  const dateStr = createdAt 
    ? new Date(createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      })
    : new Date().toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

  // Build pages
  const pages = useMemo(() => {
    const pageList: React.ReactNode[] = [];
    
    // Chunk material items for pagination
    const itemChunks = chunkItems(materialItems, MAX_ROWS_FIRST_PAGE, MAX_ROWS_CONTINUATION);
    
    // Count total pages for page numbering
    let totalPageCount = itemChunks.length || 1; // At least 1 for main content
    if (opts.showWarrantyInfo) totalPageCount++;
    if (opts.showMeasurementDetails && measurementSummary) totalPageCount++;
    if (opts.showJobPhotos && jobPhotos && jobPhotos.length > 0) totalPageCount++;
    
    let currentPage = 0;

    // Page 1: Customer info + first chunk of items + summary
    currentPage++;
    pageList.push(
      <FirstPage
        key="page-1"
        customerName={customerName}
        customerAddress={customerAddress}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        items={itemChunks[0] || []}
        isOnlyChunk={itemChunks.length <= 1}
        breakdown={breakdown}
        config={config}
        opts={opts}
        showTerms={itemChunks.length <= 1 && opts.showTermsAndConditions}
        finePrintContent={opts.showCustomFinePrint ? finePrintContent : undefined}
      />
    );

    // Continuation pages for remaining items
    for (let i = 1; i < itemChunks.length; i++) {
      currentPage++;
      const isLastItemPage = i === itemChunks.length - 1;
      pageList.push(
        <ItemsContinuationPage
          key={`items-page-${i + 1}`}
          items={itemChunks[i]}
          isLastPage={isLastItemPage}
          breakdown={isLastItemPage ? breakdown : undefined}
          config={isLastItemPage ? config : undefined}
          opts={opts}
          showTerms={isLastItemPage && opts.showTermsAndConditions}
          finePrintContent={isLastItemPage && opts.showCustomFinePrint ? finePrintContent : undefined}
        />
      );
    }

    // Warranty page
    if (opts.showWarrantyInfo) {
      currentPage++;
      pageList.push(<WarrantyPage key="warranty-page" />);
    }

    // Measurement details page
    if (opts.showMeasurementDetails && measurementSummary) {
      currentPage++;
      pageList.push(
        <MeasurementPage key="measurement-page" measurementSummary={measurementSummary} />
      );
    }

    // Job photos page
    if (opts.showJobPhotos && jobPhotos && jobPhotos.length > 0) {
      currentPage++;
      pageList.push(
        <PhotosPage key="photos-page" jobPhotos={jobPhotos} />
      );
    }

    return { pages: pageList, totalPages: totalPageCount };
  }, [materialItems, opts, measurementSummary, jobPhotos, breakdown, config, customerName, customerAddress, customerPhone, customerEmail, finePrintContent]);

  const commonProps = {
    companyLogo,
    companyInfo,
    companyName,
    companyLocations,
    estimateNumber,
    dateStr,
    opts,
    totalPages: pages.totalPages,
  };

  return (
    <div id="estimate-pdf-pages" className="flex flex-col gap-4">
      {pages.pages.map((pageContent, idx) => (
        <PageShell
          key={idx}
          {...commonProps}
          pageNumber={idx + 1}
        >
          {pageContent}
        </PageShell>
      ))}
    </div>
  );
};

// First Page Content
const FirstPage: React.FC<{
  customerName: string;
  customerAddress: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  items: LineItem[];
  isOnlyChunk: boolean;
  breakdown: EstimatePDFDocumentProps['breakdown'];
  config: EstimatePDFDocumentProps['config'];
  opts: PDFComponentOptions;
  showTerms: boolean;
  finePrintContent?: string;
}> = ({
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  items,
  isOnlyChunk,
  breakdown,
  config,
  opts,
  showTerms,
  finePrintContent,
}) => {
  return (
    <div className="space-y-3">
      {/* Customer Info */}
      {(opts.showCustomerName || opts.showCustomerAddress) && (
        <div className="p-3 bg-gray-50 rounded-lg">
          <h3 className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">Prepared For</h3>
          {opts.showCustomerName && (
            <p className="font-semibold text-sm text-gray-900">{customerName || 'Customer'}</p>
          )}
          {opts.showCustomerAddress && (
            <p className="text-gray-600 text-xs">{customerAddress || 'Address not specified'}</p>
          )}
          {opts.showCustomerContact && (customerPhone || customerEmail) && (
            <div className="mt-1 text-xs text-gray-500">
              {customerPhone && <span>{customerPhone}</span>}
              {customerPhone && customerEmail && <span> • </span>}
              {customerEmail && <span>{customerEmail}</span>}
            </div>
          )}
        </div>
      )}

      {/* Show Only Total Mode */}
      {opts.showOnlyTotal && (
        <div className="bg-gray-50 rounded-lg p-4 text-center">
          <h3 className="text-sm font-semibold text-gray-700 mb-1">Project Investment</h3>
          <div className="text-2xl font-bold text-blue-600">
            {formatCurrency(breakdown.sellingPrice)}
          </div>
          <p className="text-xs text-gray-500 mt-1">Complete roofing installation</p>
        </div>
      )}

      {/* Project Scope Table */}
      {!opts.showOnlyTotal && opts.showUnifiedItems && items.length > 0 && (
        <ItemsTable items={items} opts={opts} />
      )}

      {/* Summary (only show if this is the only/last items page) */}
      {!opts.showOnlyTotal && isOnlyChunk && (
        <PricingSummary breakdown={breakdown} config={config} opts={opts} />
      )}

      {/* Terms & Fine Print (only if fits on first page) */}
      {showTerms && <TermsSection finePrintContent={finePrintContent} opts={opts} />}
    </div>
  );
};

// Items Continuation Page
const ItemsContinuationPage: React.FC<{
  items: LineItem[];
  isLastPage: boolean;
  breakdown?: EstimatePDFDocumentProps['breakdown'];
  config?: EstimatePDFDocumentProps['config'];
  opts: PDFComponentOptions;
  showTerms: boolean;
  finePrintContent?: string;
}> = ({ items, isLastPage, breakdown, config, opts, showTerms, finePrintContent }) => {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
        Project Scope (continued)
      </h3>
      
      <ItemsTable items={items} opts={opts} />

      {isLastPage && breakdown && config && (
        <PricingSummary breakdown={breakdown} config={config} opts={opts} />
      )}

      {showTerms && <TermsSection finePrintContent={finePrintContent} opts={opts} />}
    </div>
  );
};

// Items Table Component
const ItemsTable: React.FC<{ items: LineItem[]; opts: PDFComponentOptions }> = ({ items, opts }) => {
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
        Project Scope
      </h3>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-1.5 text-gray-700 font-semibold">Description</th>
            {opts.showLineItemQuantities && (
              <>
                <th className="text-right py-1.5 text-gray-700 font-semibold w-12">Qty</th>
                <th className="text-right py-1.5 text-gray-700 font-semibold w-12">Unit</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {items.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map((item, idx) => (
            <tr key={item.id || idx} className="border-b border-gray-100">
              <td className="py-1.5">
                <div className="font-medium text-gray-900">{item.item_name}</div>
                {opts.showItemDescriptions && item.description && (
                  <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">
                    {item.description}
                  </div>
                )}
              </td>
              {opts.showLineItemQuantities && (
                <>
                  <td className="py-1.5 text-right text-gray-700 align-top">{item.qty.toFixed(0)}</td>
                  <td className="py-1.5 text-right text-gray-500 align-top">{item.unit}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// Pricing Summary Component
const PricingSummary: React.FC<{
  breakdown: EstimatePDFDocumentProps['breakdown'];
  config: EstimatePDFDocumentProps['config'];
  opts: PDFComponentOptions;
}> = ({ breakdown, config, opts }) => {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      {(opts.showCostBreakdown || opts.showProfitInfo) && (
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Estimate Summary</h3>
      )}
      
      <div className="space-y-1.5 text-xs">
        {opts.showCostBreakdown && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-600">Direct Cost (Materials + Labor)</span>
              <span className="font-medium">{formatCurrency(breakdown.directCost)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Overhead ({config.overheadPercent}%)</span>
              <span className="font-medium">{formatCurrency(breakdown.overheadAmount)}</span>
            </div>
            <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-1.5">
              <span className="text-gray-700 font-medium">Total Cost</span>
              <span className="font-semibold">{formatCurrency(breakdown.totalCost)}</span>
            </div>
          </>
        )}
        
        {opts.showProfitInfo && (
          <div className="flex justify-between">
            <span className="text-gray-600">Profit ({breakdown.actualProfitMargin.toFixed(1)}%)</span>
            <span className="font-medium text-green-600">{formatCurrency(breakdown.profitAmount)}</span>
          </div>
        )}
      </div>
      
      {/* Consumer-Friendly Total */}
      {!opts.showCostBreakdown && !opts.showProfitInfo ? (
        <div className="text-center py-2">
          <p className="text-xs text-gray-500 mb-1">Your Investment</p>
          <div className="text-xl font-bold text-blue-600">{formatCurrency(breakdown.sellingPrice)}</div>
        </div>
      ) : (
        <div className="flex justify-between items-center border-t border-gray-300 pt-2 mt-2">
          <span className="text-gray-900 font-bold">Total Investment</span>
          <span className="text-lg font-bold text-blue-600">{formatCurrency(breakdown.sellingPrice)}</span>
        </div>
      )}
    </div>
  );
};

// Terms Section
const TermsSection: React.FC<{ finePrintContent?: string; opts: PDFComponentOptions }> = ({ finePrintContent, opts }) => {
  return (
    <div className="space-y-3 mt-3">
      {opts.showTermsAndConditions && (
        <div className="text-[10px] text-gray-600 p-2 bg-gray-50 rounded">
          <h4 className="font-semibold mb-1">Terms & Conditions</h4>
          <p>This estimate is valid for 30 days. Work will be scheduled upon signed acceptance and deposit. Final pricing may vary based on site conditions discovered during work.</p>
        </div>
      )}

      {opts.showCustomFinePrint && finePrintContent && (
        <div className="text-[10px] text-gray-500 p-2 border-t border-gray-100">
          {finePrintContent}
        </div>
      )}

      {opts.showSignatureBlock && (
        <div className="grid grid-cols-2 gap-4 mt-4 pt-3 border-t border-gray-200">
          <div>
            <p className="text-[10px] text-gray-500 mb-6">Customer Signature</p>
            <div className="border-b border-gray-400"></div>
            <p className="text-[10px] text-gray-500 mt-1">Date: _______________</p>
          </div>
          <div>
            <p className="text-[10px] text-gray-500 mb-6">Company Representative</p>
            <div className="border-b border-gray-400"></div>
            <p className="text-[10px] text-gray-500 mt-1">Date: _______________</p>
          </div>
        </div>
      )}
    </div>
  );
};

// Warranty Page
const WarrantyPage: React.FC = () => {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
        Warranty Information
      </h3>
      <div className="text-xs text-gray-600 space-y-3">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <h4 className="font-medium text-amber-900 mb-1.5">Manufacturer Warranty</h4>
          <p className="text-amber-800">All roofing materials include the full manufacturer's warranty as specified by the selected product line.</p>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 className="font-medium text-blue-900 mb-1.5">Workmanship Warranty</h4>
          <p className="text-blue-800">Our installation work is backed by a comprehensive workmanship warranty covering labor and installation quality.</p>
        </div>
      </div>
    </div>
  );
};

// Measurement Page
const MeasurementPage: React.FC<{ measurementSummary: MeasurementSummary }> = ({ measurementSummary }) => {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
        Roof Measurement Details
      </h3>
      <div className="grid grid-cols-2 gap-4 text-xs">
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <h4 className="font-medium text-purple-900 mb-2">Area Measurements</h4>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-600">Total Squares</span>
              <span className="font-medium">{measurementSummary.totalSquares.toFixed(1)} sq</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Total Area</span>
              <span className="font-medium">{measurementSummary.totalSqFt.toLocaleString()} sqft</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Waste Factor</span>
              <span className="font-medium">{measurementSummary.wastePercent}%</span>
            </div>
          </div>
        </div>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <h4 className="font-medium text-blue-900 mb-2">Linear Measurements</h4>
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <span className="text-gray-600">Eave</span>
              <span className="font-medium">{measurementSummary.eaveLength.toFixed(0)} lf</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Ridge</span>
              <span className="font-medium">{measurementSummary.ridgeLength.toFixed(0)} lf</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Hip</span>
              <span className="font-medium">{measurementSummary.hipLength.toFixed(0)} lf</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Valley</span>
              <span className="font-medium">{measurementSummary.valleyLength.toFixed(0)} lf</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Rake</span>
              <span className="font-medium">{measurementSummary.rakeLength.toFixed(0)} lf</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Photos Page
const PhotosPage: React.FC<{ jobPhotos: JobPhoto[] }> = ({ jobPhotos }) => {
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
        Project Photos
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {jobPhotos.slice(0, 4).map((photo, index) => (
          <div key={photo.id || index} className="bg-gray-50 rounded-lg overflow-hidden">
            <img 
              src={photo.file_url} 
              alt={photo.description || `Photo ${index + 1}`}
              className="w-full h-32 object-cover"
            />
            <div className="p-1.5">
              <p className="text-[10px] text-gray-600 truncate">
                {photo.description || photo.category || `Photo ${index + 1}`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default EstimatePDFDocument;
