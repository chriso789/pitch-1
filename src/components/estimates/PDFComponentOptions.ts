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
  
  // NEW: Consumer-friendly unified view options
  showUnifiedItems: boolean;       // Combine materials + labor into single "Project Scope" list
  showItemDescriptions: boolean;   // Show description under item name
  hideSectionSubtotals: boolean;   // Hide "Materials Subtotal" and "Labor Subtotal"
  
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
  
  // Extra Pages (NEW)
  showMeasurementDetails: boolean; // Full measurement breakdown page
  showJobPhotos: boolean; // Job photos grid
  showRoofDiagram: boolean; // Schematic roof diagram (future)
  showWarrantyInfo: boolean; // Warranty details page
  
  // Header/Footer on every page
  showPageHeader: boolean;
  showPageFooter: boolean;
  
  // Smart Sign
  enableSmartSign?: boolean;
  signerName?: string;
  signerEmail?: string;
  
  // Cover Page
  showCoverPage: boolean;
  coverPagePropertyPhoto?: string;
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
    // Line items - UNIFIED VIEW for customer (no separate Materials/Labor)
    showMaterialsSection: false,  // Hidden - use unified view instead
    showLaborSection: false,      // Hidden - use unified view instead
    showLineItemPricing: false,   // Hide unit costs from customer
    showLineItemQuantities: true,
    // NEW: Consumer-friendly unified view
    showUnifiedItems: true,       // Show single combined list
    showItemDescriptions: true,   // Show descriptions for each item
    hideSectionSubtotals: true,   // Don't expose cost breakdown
    // Pricing - customer sees total only
    showSubtotals: false,         // CHANGED: Hide subtotals from customer
    showCostBreakdown: false,     // Hide internal costs
    showProfitInfo: false,        // NEVER show to customer
    showRepCommission: false,     // NEVER show to customer
    showOnlyTotal: false,
    // Terms
    showTermsAndConditions: true,
    showCustomFinePrint: true,
    showSignatureBlock: true,
    // Meta
    showEstimateNumber: true,
    showDate: true,
    // Extra Pages
    showMeasurementDetails: false,
    showJobPhotos: false,
    showRoofDiagram: false,
    showWarrantyInfo: true,
    // Header/Footer
    showPageHeader: true,
    showPageFooter: true,
    // Cover Page
    showCoverPage: false,
  },
  internal: {
    // Header
    showCompanyLogo: true,
    showCompanyInfo: true,
    // Customer
    showCustomerName: true,
    showCustomerAddress: true,
    showCustomerContact: true,
    // Line items - show everything in separate sections
    showMaterialsSection: true,
    showLaborSection: true,
    showLineItemPricing: true,
    showLineItemQuantities: true,
    // NEW: Internal uses traditional view
    showUnifiedItems: false,
    showItemDescriptions: false,
    hideSectionSubtotals: false,
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
    // Extra Pages
    showMeasurementDetails: true,
    showJobPhotos: false,
    showRoofDiagram: false,
    showWarrantyInfo: false,
    // Header/Footer
    showPageHeader: true,
    showPageFooter: true,
    // Cover Page
    showCoverPage: false,
  },
};

// Simple preset for showing only total (clean proposal)
export const TOTAL_ONLY_PRESET: Partial<PDFComponentOptions> = {
  showMaterialsSection: false,
  showLaborSection: false,
  showUnifiedItems: false,
  showSubtotals: false,
  showCostBreakdown: false,
  showOnlyTotal: true,
};

export function getDefaultOptions(mode: PDFViewMode = 'customer'): PDFComponentOptions {
  return { ...PDF_PRESETS[mode] };
}
