/**
 * EstimatePDFDocument - Multi-page PDF document with proper page breaks
 * 
 * This component renders the estimate as explicit letter-sized pages,
 * ensuring text/rows are never cut mid-page and footer is always at bottom.
 */
import React, { useMemo } from 'react';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { type PDFComponentOptions, getDefaultOptions } from './PDFComponentOptions';
import { EstimateCoverPage } from './EstimateCoverPage';
import { AttachmentPagesRenderer } from './AttachmentPagesRenderer';
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

interface TemplateAttachment {
  document_id: string;
  file_path: string;
  filename: string;
  attachment_order: number;
}

interface EstimatePDFDocumentProps {
  estimateNumber: string;
  estimateName?: string;
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
    salesTaxAmount?: number;
    totalWithTax?: number;
  };
  config: {
    overheadPercent: number;
    profitMarginPercent: number;
    repCommissionPercent: number;
    salesTaxEnabled?: boolean;
    salesTaxRate?: number;
  };
  createdAt?: string;
  finePrintContent?: string;
  warrantyTerms?: string;
  options?: Partial<PDFComponentOptions>;
  measurementSummary?: MeasurementSummary;
  jobPhotos?: JobPhoto[];
  templateAttachments?: TemplateAttachment[];
  // Multi-estimate deduplication flags
  skipCoverPage?: boolean;
  skipWarrantyAndTerms?: boolean;
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// ---- Group-aware pagination types ----
interface RenderBlock {
  type: 'trade-header' | 'sub-header' | 'item';
  label?: string;
  item?: LineItem;
  tradeType?: string;
}

/**
 * Build render blocks from items: Trade Header → Materials sub-header → items → Labor sub-header → items
 * Then paginate blocks as units to preserve visual hierarchy across page breaks.
 */
function buildRenderBlocks(items: LineItem[]): RenderBlock[] {
  if (items.length === 0) return [];

  // Group by trade
  const tradeOrder: string[] = [];
  const tradeMap = new Map<string, { label: string; items: LineItem[] }>();
  items.forEach(item => {
    const tradeType = (item as any).trade_type || 'roofing';
    const tradeLabel = (item as any).trade_label || tradeType.charAt(0).toUpperCase() + tradeType.slice(1);
    if (!tradeMap.has(tradeType)) {
      tradeOrder.push(tradeType);
      tradeMap.set(tradeType, { label: tradeLabel, items: [] });
    }
    tradeMap.get(tradeType)!.items.push(item);
  });

  const hasMultipleTrades = tradeOrder.length > 1;
  const blocks: RenderBlock[] = [];

  tradeOrder.forEach(tradeType => {
    const group = tradeMap.get(tradeType)!;
    const materialItems = group.items.filter(i => (i as any).item_type === 'material').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const laborItems = group.items.filter(i => (i as any).item_type === 'labor').sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    const otherItems = group.items.filter(i => !(i as any).item_type || !['material', 'labor'].includes((i as any).item_type));
    const hasBothTypes = materialItems.length > 0 && laborItems.length > 0;

    if (hasMultipleTrades) {
      blocks.push({ type: 'trade-header', label: group.label, tradeType });
    }

    if (hasBothTypes) {
      if (materialItems.length > 0) {
        blocks.push({ type: 'sub-header', label: 'Materials' });
        materialItems.forEach(item => blocks.push({ type: 'item', item }));
      }
      if (laborItems.length > 0) {
        blocks.push({ type: 'sub-header', label: 'Labor' });
        laborItems.forEach(item => blocks.push({ type: 'item', item }));
      }
    } else {
      materialItems.forEach(item => blocks.push({ type: 'item', item }));
      laborItems.forEach(item => blocks.push({ type: 'item', item }));
    }
    otherItems.forEach(item => blocks.push({ type: 'item', item }));
  });

  return blocks;
}

function chunkRenderBlocks(blocks: RenderBlock[], firstPageMax: number, continuationMax: number): RenderBlock[][] {
  if (blocks.length === 0) return [];

  const chunks: RenderBlock[][] = [];
  let remaining = [...blocks];

  const chunkOnce = (maxRows: number) => {
    if (remaining.length === 0) return;
    let size = Math.min(maxRows, remaining.length);
    // Don't end a page on a header (trade-header or sub-header) — pull it to next page
    while (size > 1 && size < remaining.length && remaining[size - 1].type !== 'item') {
      size--;
    }
    chunks.push(remaining.slice(0, size));
    remaining = remaining.slice(size);
  };

  chunkOnce(firstPageMax);
  while (remaining.length > 0) {
    chunkOnce(continuationMax);
  }

  return chunks;
}

// Legacy wrapper — converts render block chunks back to LineItem[][] for existing page components
function chunkItems(items: LineItem[], firstPageMax: number, continuationMax: number): { itemChunks: LineItem[][]; blockChunks: RenderBlock[][] } {
  const blocks = buildRenderBlocks(items);
  const blockChunks = chunkRenderBlocks(blocks, firstPageMax, continuationMax);
  const itemChunks = blockChunks.map(chunk => 
    chunk.filter(b => b.type === 'item').map(b => b.item!)
  );
  return { itemChunks, blockChunks };
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
    <div className="border-t border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center gap-3">
        {/* Logo + Company */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {(companyLogo || companyInfo?.logo_url) && (
            <img 
              src={companyLogo || companyInfo?.logo_url || ''} 
              alt={companyInfo?.name || 'Company Logo'} 
              className="h-5 object-contain" 
            />
          )}
          <div>
            <p className="font-semibold text-gray-800 text-[10px]">
              {companyInfo?.name || companyName}
            </p>
            {companyInfo?.license_number && (
              <p className="text-[8px] text-gray-500">License #{companyInfo.license_number}</p>
            )}
          </div>
        </div>
        
        {/* Locations - inline compact format */}
        <div className="flex-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[9px] text-gray-600">
          {locations.slice(0, 2).map((location, idx) => (
            <span key={location.id || idx}>
              <span className="font-medium text-gray-700">{location.name}:</span>{' '}
              {location.address_street && `${location.address_street}, `}
              {[location.address_city, location.address_state].filter(Boolean).join(', ')}
              {location.address_zip && ` ${location.address_zip}`}
              {location.phone && ` | ${location.phone}`}
            </span>
          ))}
        </div>
      </div>
      
      <div className="flex justify-between items-center text-[8px] text-gray-400 mt-1 pt-1 border-t border-gray-100">
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
  isSignaturePage?: boolean;
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
  isSignaturePage = false,
}) => {
  return (
    <div 
      data-report-page
      {...(isSignaturePage ? { 'data-signature-page': true } : {})}
      className="bg-white text-black flex flex-col pdf-render-container"
      style={{ 
        width: `${PAGE_WIDTH}px`, 
        minHeight: `${PAGE_HEIGHT}px`,
        maxHeight: `${PAGE_HEIGHT}px`,
        // Safe font stack with explicit fallbacks for PDF rendering
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        WebkitFontSmoothing: 'antialiased',
        MozOsxFontSmoothing: 'grayscale',
        textRendering: 'optimizeLegibility',
        letterSpacing: '0.01em',
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
  estimateName,
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  companyName = 'Your Company',
  companyLogo,
  companyInfo,
  companyLocations,
  materialItems,
  laborItems,
  breakdown,
  config,
  createdAt,
  finePrintContent,
  warrantyTerms,
  options: partialOptions,
  measurementSummary,
  jobPhotos,
  templateAttachments,
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
    
    // In unified mode, combine materials + labor so all trades appear in scope
    const scopeItems = opts.showUnifiedItems
      ? (() => {
          const combined = [...materialItems, ...laborItems];
          // Build trade order map from first appearance (preserves builder order)
          const tradeOrder = new Map<string, number>();
          combined.forEach(item => {
            const trade = (item as any).trade_type || 'roofing';
            if (!tradeOrder.has(trade)) tradeOrder.set(trade, tradeOrder.size);
          });
          return combined.sort((a, b) => {
            const tradeA = (a as any).trade_type || 'roofing';
            const tradeB = (b as any).trade_type || 'roofing';
            if (tradeA !== tradeB) return (tradeOrder.get(tradeA) ?? 0) - (tradeOrder.get(tradeB) ?? 0);
            const orderA = (a as any).sort_order ?? 0;
            const orderB = (b as any).sort_order ?? 0;
            if (orderA !== orderB) return orderA - orderB;
            return (a.item_name || '').localeCompare(b.item_name || '');
          });
        })()
      : materialItems;
    
    // Chunk scope items for pagination (group-aware)
    const { itemChunks, blockChunks } = chunkItems(scopeItems, MAX_ROWS_FIRST_PAGE, MAX_ROWS_CONTINUATION);
    
    // Count total pages for page numbering
    // Pre-build warranty pages to know their count
    const warrantyPages = (opts.showManufacturerWarranty || opts.showWorkmanshipWarranty)
      ? buildWarrantyPages(warrantyTerms, opts.showManufacturerWarranty, opts.showWorkmanshipWarranty)
      : [];

    let totalPageCount = itemChunks.length || 1; // At least 1 for main content
    if (opts.showCoverPage) totalPageCount++;
    totalPageCount += warrantyPages.length;
    if (opts.showMeasurementDetails && measurementSummary) totalPageCount++;
    // Photos page count calculated below
    
    let currentPage = 0;
    // Track which page index (in pageList) contains the signature block
    let signaturePageIdx: number | null = null;

    // Cover page (if enabled) - prepended before other content
    if (opts.showCoverPage) {
      currentPage++;
      pageList.push(
        <EstimateCoverPage
          key="cover-page"
          companyInfo={companyInfo}
          companyLogo={companyLogo}
          companyName={companyName}
          customerName={customerName}
          customerAddress={customerAddress}
          estimateNumber={estimateNumber}
          createdAt={createdAt}
          propertyPhoto={opts.coverPagePropertyPhoto}
          estimateName={estimateName}
        />
      );
    }

    // Page 1: Customer info + first chunk of items + summary
    currentPage++;
    const firstPageHasTerms = itemChunks.length <= 1 && opts.showTermsAndConditions;
    if (firstPageHasTerms && opts.showSignatureBlock) {
      signaturePageIdx = pageList.length; // index of this page in the list
    }
    pageList.push(
      <FirstPage
        key="page-1"
        customerName={customerName}
        customerAddress={customerAddress}
        customerPhone={customerPhone}
        customerEmail={customerEmail}
        items={itemChunks[0] || []}
        blocks={blockChunks[0] || []}
        isOnlyChunk={itemChunks.length <= 1}
        breakdown={breakdown}
        config={config}
        opts={opts}
        showTerms={firstPageHasTerms}
        finePrintContent={opts.showCustomFinePrint ? finePrintContent : undefined}
        estimateName={estimateName}
      />
    );

    // Continuation pages for remaining items
    for (let i = 1; i < itemChunks.length; i++) {
      currentPage++;
      const isLastItemPage = i === itemChunks.length - 1;
      const showTerms = isLastItemPage && opts.showTermsAndConditions;
      if (showTerms && opts.showSignatureBlock) {
        signaturePageIdx = pageList.length;
      }
      pageList.push(
        <ItemsContinuationPage
          key={`items-page-${i + 1}`}
          items={itemChunks[i]}
          blocks={blockChunks[i]}
          isLastPage={isLastItemPage}
          breakdown={isLastItemPage ? breakdown : undefined}
          config={isLastItemPage ? config : undefined}
          opts={opts}
          showTerms={showTerms}
          finePrintContent={isLastItemPage && opts.showCustomFinePrint ? finePrintContent : undefined}
        />
      );
    }

    // Warranty page(s)
    warrantyPages.forEach((page, i) => {
      currentPage++;
      pageList.push(page);
    });

    // Measurement details page
    if (opts.showMeasurementDetails && measurementSummary) {
      currentPage++;
      pageList.push(
        <MeasurementPage key="measurement-page" measurementSummary={measurementSummary} />
      );
    }

    // Job photos page(s) - may need multiple pages for large grids
    if (opts.showJobPhotos && jobPhotos && jobPhotos.length > 0) {
      const cols = getPhotoGridCols(jobPhotos.length, opts.photoLayout || 'auto');
      // Each page can fit roughly: 2-col = 6, 3-col = 9, 4-col = 8, 1-col = 2
      const photosPerPage = cols === 1 ? 2 : cols === 2 ? 4 : cols === 3 ? 6 : 8;
      const photoChunks: typeof jobPhotos[] = [];
      for (let i = 0; i < jobPhotos.length; i += photosPerPage) {
        photoChunks.push(jobPhotos.slice(i, i + photosPerPage));
      }
      photoChunks.forEach((chunk, chunkIdx) => {
        currentPage++;
        totalPageCount++;
        pageList.push(
          <PhotosPage key={`photos-page-${chunkIdx}`} jobPhotos={chunk} cols={cols} pageIndex={chunkIdx} totalPhotoPages={photoChunks.length} />
        );
      });
    }

    return { pages: pageList, totalPages: totalPageCount, signaturePageIdx };
  }, [materialItems, laborItems, opts, measurementSummary, jobPhotos, breakdown, config, customerName, customerAddress, customerPhone, customerEmail, finePrintContent]);

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
      {pages.pages.map((pageContent, idx) => {
        // Cover page already has its own data-report-page attribute, don't wrap in PageShell
        const isCoverPage = opts.showCoverPage && idx === 0;
        
        if (isCoverPage) {
          // Render cover page directly without PageShell wrapper to avoid duplicate data-report-page
          return <React.Fragment key="cover">{pageContent}</React.Fragment>;
        }
        
        // Wrap other pages in PageShell
        return (
          <PageShell
            key={idx}
            {...commonProps}
            pageNumber={idx + 1}
            isSignaturePage={idx === pages.signaturePageIdx}
          >
            {pageContent}
          </PageShell>
        );
      })}
      
      {/* Render attachment pages (marketing flyers, etc.) after main content */}
      {templateAttachments && templateAttachments.length > 0 && (
        <AttachmentPagesRenderer attachments={templateAttachments} />
      )}
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
  blocks: RenderBlock[];
  isOnlyChunk: boolean;
  breakdown: EstimatePDFDocumentProps['breakdown'];
  config: EstimatePDFDocumentProps['config'];
  opts: PDFComponentOptions;
  showTerms: boolean;
  finePrintContent?: string;
  estimateName?: string;
}> = ({
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  items,
  blocks,
  isOnlyChunk,
  breakdown,
  config,
  opts,
  showTerms,
  finePrintContent,
  estimateName,
}) => {
  return (
    <div className="space-y-3">
      {/* Estimate Name Banner */}
      {estimateName && (
        <div className="text-center py-2 mb-1">
          <h2 className="text-xl font-bold text-gray-900 tracking-tight">{estimateName}</h2>
        </div>
      )}
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
        <ItemsTable blocks={blocks} opts={opts} />
      )}

      {/* Continuation hint when items overflow to next page */}
      {!opts.showOnlyTotal && opts.showUnifiedItems && items.length > 0 && !isOnlyChunk && (
        <p className="text-[10px] text-gray-400 italic text-right mt-2">
          Scope continues on next page…
        </p>
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
  blocks: RenderBlock[];
  isLastPage: boolean;
  breakdown?: EstimatePDFDocumentProps['breakdown'];
  config?: EstimatePDFDocumentProps['config'];
  opts: PDFComponentOptions;
  showTerms: boolean;
  finePrintContent?: string;
}> = ({ items, blocks, isLastPage, breakdown, config, opts, showTerms, finePrintContent }) => {
  return (
    <div className="space-y-3">
      <ItemsTable blocks={blocks} opts={opts} continued />

      {isLastPage && breakdown && config && (
        <PricingSummary breakdown={breakdown} config={config} opts={opts} />
      )}

      {showTerms && <TermsSection finePrintContent={finePrintContent} opts={opts} />}
    </div>
  );
};

// Items Table Component - renders pre-built render blocks
const ItemsTable: React.FC<{ blocks: RenderBlock[]; opts: PDFComponentOptions; continued?: boolean }> = ({ blocks, opts, continued = false }) => {
  const renderItem = (item: LineItem, idx: number) => (
    <tr key={item.id || `item-${idx}`} className="border-b border-gray-100">
      <td className="py-1.5">
        <div className="font-medium text-gray-900">{item.item_name}</div>
        {opts.showItemDescriptions && item.description && (
          <div className="text-[10px] text-gray-500 mt-0.5 leading-snug">
            {item.description}
          </div>
        )}
        {item.notes && (
          <div className="text-[10px] text-gray-500 mt-0.5 leading-snug italic">
            {item.notes}
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
  );

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
        {continued ? 'Project Scope (continued)' : 'Project Scope'}
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
          {blocks.map((block, idx) => {
            if (block.type === 'trade-header') {
              return (
                <tr key={`trade-${block.tradeType}-${idx}`}>
                  <td 
                    colSpan={opts.showLineItemQuantities ? 3 : 1} 
                    className="pt-3 pb-1"
                  >
                    <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide border-b border-gray-300 pb-0.5">
                      {block.label}
                    </div>
                  </td>
                </tr>
              );
            }
            if (block.type === 'sub-header') {
              return (
                <tr key={`sub-${block.label}-${idx}`}>
                  <td colSpan={opts.showLineItemQuantities ? 3 : 1} className="pt-2 pb-0.5">
                    <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider pl-1">
                      {block.label}
                    </div>
                  </td>
                </tr>
              );
            }
            if (block.type === 'item' && block.item) {
              return renderItem(block.item, idx);
            }
            return null;
          })}
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
      
      {/* Sales Tax - ONLY show for internal view (showCostBreakdown = internal) */}
      {opts.showCostBreakdown && config.salesTaxEnabled && config.salesTaxRate && config.salesTaxRate > 0 && (
        <div className="flex justify-between text-xs border-t border-gray-200 pt-1.5 mt-1.5">
          <span className="text-gray-600">Sales Tax ({config.salesTaxRate.toFixed(2)}%)</span>
          <span className="font-medium">{formatCurrency(breakdown.salesTaxAmount || 0)}</span>
        </div>
      )}
      
      {/* Consumer-Friendly Total - Tax is now INCLUDED in sellingPrice */}
      {!opts.showCostBreakdown && !opts.showProfitInfo ? (
        <div className="text-center py-2">
          <p className="text-xs text-gray-500 mb-1">Your Investment</p>
          <div className="text-xl font-bold text-blue-600">
            {formatCurrency(breakdown.sellingPrice)}
          </div>
          {config.salesTaxEnabled && config.salesTaxRate && config.salesTaxRate > 0 && (
            <p className="text-[9px] text-gray-400 mt-0.5">Price includes applicable sales tax</p>
          )}
        </div>
      ) : (
        <div className="flex justify-between items-center border-t border-gray-300 pt-2 mt-2">
          <span className="text-gray-900 font-bold">Total Investment</span>
          <span className="text-lg font-bold text-blue-600">
            {formatCurrency(breakdown.sellingPrice)}
          </span>
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

// Warranty Page(s) - splits into multiple pages when content is long
function buildWarrantyPages(
  warrantyTerms?: string,
  showManufacturer: boolean = true,
  showWorkmanship: boolean = true
): React.ReactNode[] {
  let manufacturer = "All roofing materials include the full manufacturer's warranty as specified by the selected product line.";
  let workmanship = "Our installation work is backed by a comprehensive workmanship warranty covering labor and installation quality.";

  if (warrantyTerms) {
    try {
      const obj = JSON.parse(warrantyTerms);
      if (obj?.manufacturer) manufacturer = obj.manufacturer;
      if (obj?.workmanship) workmanship = obj.workmanship;
    } catch { /* not JSON */ }
  }

  if (!showManufacturer && !showWorkmanship) return [];

  // Only one section enabled — always fits in one page
  if (!showManufacturer) {
    return [
      <div key="warranty-page" className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
          Warranty Information
        </h3>
        <div className="text-xs text-gray-600 space-y-2">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
            <h4 className="font-medium text-blue-900 mb-1">Workmanship Warranty</h4>
            <p className="text-blue-800 whitespace-pre-line leading-tight">{workmanship}</p>
          </div>
        </div>
      </div>
    ];
  }

  if (!showWorkmanship) {
    return [
      <div key="warranty-page" className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
          Warranty Information
        </h3>
        <div className="text-xs text-gray-600 space-y-2">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            <h4 className="font-medium text-amber-900 mb-1">Manufacturer Warranty</h4>
            <p className="text-amber-800 whitespace-pre-line leading-tight">{manufacturer}</p>
          </div>
        </div>
      </div>
    ];
  }

  // Both enabled — check if they need splitting
  const combinedLength = manufacturer.length + workmanship.length;
  const needsSplit = combinedLength > 800;

  if (!needsSplit) {
    return [
      <div key="warranty-page" className="space-y-2">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
          Warranty Information
        </h3>
        <div className="text-xs text-gray-600 space-y-2">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
            <h4 className="font-medium text-amber-900 mb-1">Manufacturer Warranty</h4>
            <p className="text-amber-800 whitespace-pre-line leading-tight">{manufacturer}</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
            <h4 className="font-medium text-blue-900 mb-1">Workmanship Warranty</h4>
            <p className="text-blue-800 whitespace-pre-line leading-tight">{workmanship}</p>
          </div>
        </div>
      </div>
    ];
  }

  // Split: Page 1 = Manufacturer, Page 2 = Workmanship
  return [
    <div key="warranty-page-1" className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
        Warranty Information
      </h3>
      <div className="text-xs text-gray-600 space-y-2">
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-2">
          <h4 className="font-medium text-amber-900 mb-1">Manufacturer Warranty</h4>
          <p className="text-amber-800 whitespace-pre-line leading-tight">{manufacturer}</p>
        </div>
      </div>
    </div>,
    <div key="warranty-page-2" className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
        Warranty Information <span className="text-xs font-normal text-gray-500">(continued)</span>
      </h3>
      <div className="text-xs text-gray-600 space-y-2">
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-2">
          <h4 className="font-medium text-blue-900 mb-1">Workmanship Warranty</h4>
          <p className="text-blue-800 whitespace-pre-line leading-tight">{workmanship}</p>
        </div>
      </div>
    </div>
  ];
}

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

// Helper to determine grid columns
function getPhotoGridCols(count: number, layout: string): number {
  if (layout === '1col') return 1;
  if (layout === '2col') return 2;
  if (layout === '3col') return 3;
  if (layout === '4col') return 4;
  // Auto mode
  if (count <= 1) return 1;
  if (count <= 4) return 2;
  if (count <= 9) return 3;
  return 4;
}

// Photos Page
const PhotosPage: React.FC<{ jobPhotos: JobPhoto[]; cols: number; pageIndex: number; totalPhotoPages: number }> = ({ jobPhotos, cols, pageIndex, totalPhotoPages }) => {
  const gridClass = cols === 1 ? 'grid-cols-1' : cols === 2 ? 'grid-cols-2' : cols === 3 ? 'grid-cols-3' : 'grid-cols-4';
  // Adjust image height based on grid density
  const imgHeight = cols === 1 ? 'h-72' : cols === 2 ? 'h-48' : cols === 3 ? 'h-36' : 'h-28';
  
  const isAerialOnly = jobPhotos.length === 1 && jobPhotos[0].category === 'aerial';
  const title = isAerialOnly ? 'Aerial View' : 'Project Photos';
  
  return (
    <div className="space-y-3">
      <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
        <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
        {title}{totalPhotoPages > 1 ? ` (${pageIndex + 1}/${totalPhotoPages})` : ''}
      </h3>
      <div className={`grid ${gridClass} gap-3`}>
        {jobPhotos.map((photo, index) => (
          <div key={photo.id || index} className="bg-gray-50 rounded-lg overflow-hidden">
            <img 
              src={photo.file_url} 
              alt={photo.description || `Photo ${index + 1}`}
              className={`w-full ${imgHeight} object-cover`}
            />
            {cols <= 2 && (
              <div className="p-1.5">
                <p className="text-xs text-gray-600 truncate">
                  {photo.description || photo.category || `Photo ${index + 1}`}
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default EstimatePDFDocument;
