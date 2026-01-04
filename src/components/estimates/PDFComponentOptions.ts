// PDF Component visibility options for estimate exports

export interface PDFComponentOptions {
  // Header & Branding
  showCompanyLogo: boolean;
  showCompanyInfo: boolean; // phone, email, address, license
  
  // Customer info
  showCustomerName: boolean;
  showCustomerAddress: boolean;
  showCustomerContact: boolean; // phone/email if available
  
  // Line items
  showMaterialsSection: boolean;
  showLaborSection: boolean;
  showLineItemPricing: boolean; // unit cost + line totals
  showLineItemQuantities: boolean;
  
  // Pricing Summary
  showSubtotals: boolean; // materials subtotal, labor subtotal
  showCostBreakdown: boolean; // direct cost, overhead (internal numbers)
  showProfitInfo: boolean; // profit %, profit amount - INTERNAL ONLY
  showRepCommission: boolean; // rep commission - INTERNAL ONLY
  showOnlyTotal: boolean; // hide all breakdown, show only final price
  
  // Terms & Signatures
  showTermsAndConditions: boolean;
  showCustomFinePrint: boolean;
  showSignatureBlock: boolean;
  
  // Meta
  showEstimateNumber: boolean;
  showDate: boolean;
}

export type PDFViewMode = 'customer' | 'internal';

// Preset configurations
export const PDF_PRESETS: Record<PDFViewMode, PDFComponentOptions> = {
  customer: {
    // Header
    showCompanyLogo: true,
    showCompanyInfo: true,
    // Customer
    showCustomerName: true,
    showCustomerAddress: true,
    showCustomerContact: false,
    // Line items - show items but hide unit pricing for cleaner look
    showMaterialsSection: true,
    showLaborSection: true,
    showLineItemPricing: false, // Hide unit costs from customer
    showLineItemQuantities: true,
    // Pricing - customer sees total only
    showSubtotals: true,
    showCostBreakdown: false, // Hide internal costs
    showProfitInfo: false, // NEVER show to customer
    showRepCommission: false, // NEVER show to customer
    showOnlyTotal: false,
    // Terms
    showTermsAndConditions: true,
    showCustomFinePrint: true,
    showSignatureBlock: true,
    // Meta
    showEstimateNumber: true,
    showDate: true,
  },
  internal: {
    // Header
    showCompanyLogo: true,
    showCompanyInfo: true,
    // Customer
    showCustomerName: true,
    showCustomerAddress: true,
    showCustomerContact: true,
    // Line items - show everything
    showMaterialsSection: true,
    showLaborSection: true,
    showLineItemPricing: true,
    showLineItemQuantities: true,
    // Pricing - show all internal numbers
    showSubtotals: true,
    showCostBreakdown: true,
    showProfitInfo: true,
    showRepCommission: true,
    showOnlyTotal: false,
    // Terms
    showTermsAndConditions: true,
    showCustomFinePrint: false,
    showSignatureBlock: false,
    // Meta
    showEstimateNumber: true,
    showDate: true,
  },
};

// Simple preset for showing only total (clean proposal)
export const TOTAL_ONLY_PRESET: Partial<PDFComponentOptions> = {
  showMaterialsSection: false,
  showLaborSection: false,
  showSubtotals: false,
  showCostBreakdown: false,
  showOnlyTotal: true,
};

export function getDefaultOptions(mode: PDFViewMode = 'customer'): PDFComponentOptions {
  return { ...PDF_PRESETS[mode] };
}
