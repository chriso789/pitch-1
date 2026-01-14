import React from 'react';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { type PDFComponentOptions, getDefaultOptions } from './PDFComponentOptions';

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

interface CustomerInfo {
  name: string;
  address: string;
  phone?: string | null;
  email?: string | null;
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

interface EstimatePDFTemplateProps {
  estimateNumber: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  companyName?: string;
  companyLogo?: string;
  companyInfo?: CompanyInfo;
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

// Page break CSS styles
const pageBreakStyles = `
  @media print {
    .page-break-before { page-break-before: always; break-before: page; }
    .page-break-after { page-break-after: always; break-after: page; }
    .avoid-break { page-break-inside: avoid; break-inside: avoid; }
    .pdf-header { position: running(header); }
    .pdf-footer { position: running(footer); }
  }
`;

export const EstimatePDFTemplate: React.FC<EstimatePDFTemplateProps> = ({
  estimateNumber,
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  companyName = 'PITCH CRM',
  companyLogo,
  companyInfo,
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
  // Merge with defaults (customer mode by default = hide internal info)
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

  // Build company address string
  const companyAddressParts = [
    companyInfo?.address_street,
    [companyInfo?.address_city, companyInfo?.address_state].filter(Boolean).join(', '),
    companyInfo?.address_zip
  ].filter(Boolean);
  const companyAddressStr = companyAddressParts.join(' ');

  const currentYear = new Date().getFullYear();

  return (
    <div 
      id="estimate-pdf-template"
      className="bg-white text-black w-[816px]"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      <style>{pageBreakStyles}</style>
      
      {/* Page Header - Repeats on every page when printing */}
      {opts.showPageHeader && companyInfo && (
        <div className="pdf-header bg-gray-50 border-b px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {opts.showCompanyLogo && (companyLogo || companyInfo?.logo_url) && (
              <img 
                src={companyLogo || companyInfo?.logo_url || ''} 
                alt="Logo" 
                className="h-8 object-contain" 
              />
            )}
            <span className="font-semibold text-gray-800">{companyInfo?.name || companyName}</span>
          </div>
          <div className="text-xs text-gray-500">
            {companyInfo?.phone && <span>{companyInfo.phone}</span>}
            {companyInfo?.phone && companyInfo?.email && <span className="mx-2">•</span>}
            {companyInfo?.email && <span>{companyInfo.email}</span>}
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="p-6 min-h-[1000px]">
      {/* Header - Compact */}
      <div className="flex justify-between items-start mb-4 pb-3 border-b border-gray-200">
        <div>
          {opts.showCompanyLogo && (companyLogo || companyInfo?.logo_url) ? (
            <>
              <img 
                src={companyLogo || companyInfo?.logo_url || ''} 
                alt="Company Logo" 
                className="h-12 mb-1 object-contain" 
              />
              <h1 className="text-lg font-bold text-gray-900">
                {companyInfo?.name || companyName}
              </h1>
            </>
          ) : (
            <h1 className="text-xl font-bold text-gray-900">
              {companyInfo?.name || companyName}
            </h1>
          )}
          {opts.showCompanyInfo && companyInfo && (
            <div className="text-xs text-gray-600 mt-1 space-y-0.5">
              {companyAddressStr && <p>{companyAddressStr}</p>}
              <p>
                {companyInfo.phone}
                {companyInfo.phone && companyInfo.email && ' • '}
                {companyInfo.email}
              </p>
              {companyInfo.license_number && (
                <p className="text-gray-500">License: {companyInfo.license_number}</p>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Estimate</p>
          {opts.showEstimateNumber && (
            <h2 className="text-lg font-bold text-gray-900">{estimateNumber}</h2>
          )}
          {opts.showDate && (
            <p className="text-sm text-gray-500">{dateStr}</p>
          )}
        </div>
      </div>

      {/* Customer Info - Compact */}
      {(opts.showCustomerName || opts.showCustomerAddress) && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <h3 className="text-xs uppercase tracking-wide text-gray-500 mb-1">Prepared For</h3>
          {opts.showCustomerName && (
            <p className="font-semibold text-base text-gray-900">{customerName || 'Customer'}</p>
          )}
          {opts.showCustomerAddress && (
            <p className="text-gray-600 text-sm">{customerAddress || 'Address not specified'}</p>
          )}
          {opts.showCustomerContact && (customerPhone || customerEmail) && (
            <div className="mt-1 text-sm text-gray-500">
              {customerPhone && <span>{customerPhone}</span>}
              {customerPhone && customerEmail && <span> • </span>}
              {customerEmail && <span>{customerEmail}</span>}
            </div>
          )}
        </div>
      )}

      {/* Show Only Total Mode - Clean Summary */}
      {opts.showOnlyTotal && (
        <div className="bg-gray-50 rounded-lg p-6 mb-4 text-center">
          <h3 className="text-base font-semibold text-gray-700 mb-2">Project Investment</h3>
          <div className="text-3xl font-bold text-blue-600">
            {formatCurrency(breakdown.sellingPrice)}
          </div>
          <p className="text-sm text-gray-500 mt-1">Complete roofing installation</p>
        </div>
      )}

      {/* UNIFIED ITEMS SECTION - Consumer-Friendly Single List */}
      {!opts.showOnlyTotal && opts.showUnifiedItems && (
        <div className="mb-4 avoid-break">
          <h3 className="text-base font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            Project Scope
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-2 text-gray-700 font-semibold">Description</th>
                {opts.showLineItemQuantities && (
                  <>
                    <th className="text-right py-2 text-gray-700 font-semibold w-16">Qty</th>
                    <th className="text-right py-2 text-gray-700 font-semibold w-16">Unit</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {/* Combine all items and sort */}
              {[...materialItems, ...laborItems]
                .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
                .map((item, idx) => (
                  <tr key={item.id || idx} className="border-b border-gray-100">
                    <td className="py-2">
                      <div className="font-medium text-gray-900">{item.item_name}</div>
                      {opts.showItemDescriptions && item.description && (
                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">
                          {item.description}
                        </div>
                      )}
                    </td>
                    {opts.showLineItemQuantities && (
                      <>
                        <td className="py-2 text-right text-gray-700 align-top">{item.qty.toFixed(0)}</td>
                        <td className="py-2 text-right text-gray-500 align-top">{item.unit}</td>
                      </>
                    )}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Materials Section - Traditional View (not unified) */}
      {!opts.showOnlyTotal && !opts.showUnifiedItems && opts.showMaterialsSection && materialItems.length > 0 && (
        <div className="mb-4 avoid-break">
          <h3 className="text-base font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
            Materials
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-600 font-medium">Item</th>
                {opts.showLineItemQuantities && (
                  <>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-16">Qty</th>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-14">Unit</th>
                  </>
                )}
                {opts.showLineItemPricing && (
                  <>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-20">Unit Cost</th>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-24">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {materialItems.map((item, idx) => (
                <tr key={item.id || idx} className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-900">{item.item_name}</td>
                  {opts.showLineItemQuantities && (
                    <>
                      <td className="py-1.5 text-right text-gray-700">{item.qty.toFixed(2)}</td>
                      <td className="py-1.5 text-right text-gray-500">{item.unit}</td>
                    </>
                  )}
                  {opts.showLineItemPricing && (
                    <>
                      <td className="py-1.5 text-right text-gray-700">{formatCurrency(item.unit_cost)}</td>
                      <td className="py-1.5 text-right font-medium text-gray-900">{formatCurrency(item.line_total)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {opts.showSubtotals && !opts.hideSectionSubtotals && (
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td 
                    colSpan={opts.showLineItemQuantities ? 3 : 1} 
                    className="py-2 text-right font-semibold text-gray-700"
                  >
                    Materials Subtotal
                  </td>
                  {opts.showLineItemPricing && <td />}
                  <td className="py-2 text-right font-bold text-gray-900">
                    {formatCurrency(breakdown.materialsTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Labor Section - Traditional View (not unified) */}
      {!opts.showOnlyTotal && !opts.showUnifiedItems && opts.showLaborSection && laborItems.length > 0 && (
        <div className="mb-4 avoid-break">
          <h3 className="text-base font-semibold text-gray-900 mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full"></span>
            Labor
          </h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1.5 text-gray-600 font-medium">Item</th>
                {opts.showLineItemQuantities && (
                  <>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-16">Qty</th>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-14">Unit</th>
                  </>
                )}
                {opts.showLineItemPricing && (
                  <>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-20">Rate</th>
                    <th className="text-right py-1.5 text-gray-600 font-medium w-24">Total</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {laborItems.map((item, idx) => (
                <tr key={item.id || idx} className="border-b border-gray-100">
                  <td className="py-1.5 text-gray-900">{item.item_name}</td>
                  {opts.showLineItemQuantities && (
                    <>
                      <td className="py-1.5 text-right text-gray-700">{item.qty.toFixed(2)}</td>
                      <td className="py-1.5 text-right text-gray-500">{item.unit}</td>
                    </>
                  )}
                  {opts.showLineItemPricing && (
                    <>
                      <td className="py-1.5 text-right text-gray-700">{formatCurrency(item.unit_cost)}</td>
                      <td className="py-1.5 text-right font-medium text-gray-900">{formatCurrency(item.line_total)}</td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
            {opts.showSubtotals && !opts.hideSectionSubtotals && (
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td 
                    colSpan={opts.showLineItemQuantities ? 3 : 1} 
                    className="py-2 text-right font-semibold text-gray-700"
                  >
                    Labor Subtotal
                  </td>
                  {opts.showLineItemPricing && <td />}
                  <td className="py-2 text-right font-bold text-gray-900">
                    {formatCurrency(breakdown.laborTotal)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Cost Summary - Consumer-Friendly or Internal */}
      {!opts.showOnlyTotal && (
        <div className="bg-gray-50 rounded-lg p-4 mb-4 avoid-break">
          {/* Show internal breakdown header only when showing internal info */}
          {(opts.showCostBreakdown || opts.showProfitInfo) && (
            <h3 className="text-base font-semibold text-gray-900 mb-3">Estimate Summary</h3>
          )}
          
          <div className="space-y-2 text-sm">
            {/* Internal-only cost breakdown */}
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
                <div className="flex justify-between border-t border-gray-200 pt-2 mt-2">
                  <span className="text-gray-700 font-medium">Total Cost</span>
                  <span className="font-semibold">{formatCurrency(breakdown.totalCost)}</span>
                </div>
              </>
            )}
            
            {/* Internal-only profit info */}
            {opts.showProfitInfo && (
              <div className="flex justify-between">
                <span className="text-gray-600">Profit ({breakdown.actualProfitMargin.toFixed(1)}%)</span>
                <span className="font-medium text-green-600">{formatCurrency(breakdown.profitAmount)}</span>
              </div>
            )}
          </div>
          
          {/* Consumer-Friendly Total - Clean centered display when no internal breakdown */}
          {!opts.showCostBreakdown && !opts.showProfitInfo ? (
            <div className="text-center py-4">
              <p className="text-sm text-gray-500 mb-2">Your Investment</p>
              <div className="text-4xl font-bold text-blue-600 mb-2">
                {formatCurrency(breakdown.sellingPrice)}
              </div>
              <p className="text-xs text-gray-400">
                Complete installation as described above
              </p>
            </div>
          ) : (
            /* Internal view - side by side total */
            <div className="mt-6 pt-4 border-t-2 border-gray-300">
              <div className="flex justify-between items-center">
                <span className="text-xl font-bold text-gray-900">Total Investment</span>
                <span className="text-3xl font-bold text-blue-600">{formatCurrency(breakdown.sellingPrice)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rep Commission (Internal Only) */}
      {opts.showRepCommission && (
        <div className="text-xs text-gray-400 mb-8 p-3 bg-gray-50 rounded border border-dashed border-gray-200">
          <span className="font-medium">Internal:</span> Rep Commission ({config.repCommissionPercent}%) = {formatCurrency(breakdown.repCommissionAmount)}
        </div>
      )}

      {/* Terms & Conditions */}
      {opts.showTermsAndConditions && (
        <div className="text-xs text-gray-500 border-t pt-4">
          <h4 className="font-semibold text-gray-700 mb-2">Terms & Conditions</h4>
          <p className="mb-1">• This estimate is valid for 30 days from the date above.</p>
          <p className="mb-1">• A 50% deposit is required to schedule the project.</p>
          <p className="mb-1">• Final balance due upon completion.</p>
          <p>• All work includes standard manufacturer warranty.</p>
        </div>
      )}

      {/* Custom Fine Print */}
      {opts.showCustomFinePrint && finePrintContent && (
        <div className="text-xs text-gray-500 border-t pt-4 mt-4">
          <h4 className="font-semibold text-gray-700 mb-2">Additional Terms</h4>
          <div className="whitespace-pre-wrap">{finePrintContent}</div>
        </div>
      )}

      {/* Signature Block */}
      {opts.showSignatureBlock && (
        <div className="avoid-break mt-8 pt-6 border-t grid grid-cols-2 gap-8">
          <div>
            <div className="border-b border-gray-400 h-12 mb-2"></div>
            <p className="text-xs text-gray-500">Customer Signature</p>
          </div>
          <div>
            <div className="border-b border-gray-400 h-12 mb-2"></div>
            <p className="text-xs text-gray-500">Date</p>
          </div>
        </div>
      )}

      {/* Measurement Details Page */}
      {opts.showMeasurementDetails && measurementSummary && (
        <div className="page-break-before pt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
            Measurement Details
          </h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Roof Area</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Area</span>
                  <span className="font-medium">{measurementSummary.totalSqFt.toLocaleString()} sqft</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Squares</span>
                  <span className="font-medium">{measurementSummary.totalSquares.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Waste Factor</span>
                  <span className="font-medium">{measurementSummary.wastePercent}%</span>
                </div>
              </div>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-gray-700 mb-3">Linear Footage</h4>
              <div className="space-y-2 text-sm">
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
      )}

      {/* Job Photos Page */}
      {opts.showJobPhotos && jobPhotos && jobPhotos.length > 0 && (
        <div className="page-break-before pt-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <span className="w-2 h-2 bg-teal-500 rounded-full"></span>
            Project Photos
          </h3>
          <div className="grid grid-cols-2 gap-4">
            {jobPhotos.map((photo, index) => (
              <div key={photo.id || index} className="bg-gray-50 rounded-lg overflow-hidden">
                <img 
                  src={photo.file_url} 
                  alt={photo.description || `Photo ${index + 1}`}
                  className="w-full h-48 object-cover"
                />
                <div className="p-2">
                  <p className="text-xs text-gray-600 truncate">
                    {photo.description || photo.category || `Photo ${index + 1}`}
                  </p>
                  {photo.category && (
                    <span className="inline-block mt-1 px-2 py-0.5 text-[10px] bg-gray-200 text-gray-700 rounded">
                      {photo.category}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warranty Info Page */}
      {opts.showWarrantyInfo && (
        <div className="avoid-break mt-8 pt-6 border-t">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
            Warranty Information
          </h3>
          <div className="text-sm text-gray-600 space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <h4 className="font-medium text-amber-900 mb-2">Manufacturer Warranty</h4>
              <p className="text-amber-800">All roofing materials include the full manufacturer's warranty as specified by the selected product line.</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h4 className="font-medium text-blue-900 mb-2">Workmanship Warranty</h4>
              <p className="text-blue-800">Our installation work is backed by a comprehensive workmanship warranty covering labor and installation quality.</p>
            </div>
          </div>
        </div>
      )}

      </div>
      
      {/* Page Footer */}
      {opts.showPageFooter && (
        <div className="pdf-footer border-t px-8 py-3 flex items-center justify-between text-xs text-gray-500">
          <span>© {currentYear} {companyInfo?.name || companyName}</span>
          <span>{companyInfo?.license_number ? `License #${companyInfo.license_number}` : ''}</span>
        </div>
      )}
    </div>
  );
};

export default EstimatePDFTemplate;
