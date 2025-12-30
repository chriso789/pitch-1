// ============================================================================
// PDF GENERATOR - PROFESSIONAL PROPOSAL DOCUMENTS
// ============================================================================

import { TierPricing, formatCurrency } from './pricing-engine.ts';

export interface ProposalData {
  // Company info
  companyName: string;
  companyLogo?: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyLicense?: string;
  
  // Customer info
  customerName: string;
  customerAddress: string;
  customerPhone?: string;
  customerEmail?: string;
  
  // Project info
  projectName: string;
  estimateNumber: string;
  createdAt: string;
  validUntil: string;
  
  // Measurements
  roofAreaSqFt: number;
  roofSquares: number;
  pitch: string;
  linearMeasurements: {
    ridge: number;
    hip: number;
    valley: number;
    eave: number;
    rake: number;
  };
  
  // Pricing tiers
  tiers: TierPricing[];
  selectedTier?: 'good' | 'better' | 'best';
  
  // Content
  scopeOfWork: string[];
  exclusions?: string[];
  warranty: string;
  paymentTerms: string;
  termsAndConditions: string;
  
  // Media
  coverPhotoUrl?: string;
  beforePhotos?: string[];
  roofDiagramUrl?: string;
}

/**
 * Generate HTML for the proposal (to be converted to PDF)
 */
export function generateProposalHTML(data: ProposalData): string {
  const {
    companyName,
    companyLogo,
    companyAddress,
    companyPhone,
    companyEmail,
    companyLicense,
    customerName,
    customerAddress,
    projectName,
    estimateNumber,
    createdAt,
    validUntil,
    roofAreaSqFt,
    roofSquares,
    pitch,
    linearMeasurements,
    tiers,
    selectedTier,
    scopeOfWork,
    exclusions,
    warranty,
    paymentTerms,
    termsAndConditions,
    coverPhotoUrl,
    beforePhotos,
    roofDiagramUrl
  } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Proposal - ${estimateNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Helvetica Neue', Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1f2937;
      background: white;
    }
    
    .page {
      width: 8.5in;
      min-height: 11in;
      padding: 0.5in;
      margin: 0 auto;
      background: white;
      page-break-after: always;
    }
    
    .page:last-child {
      page-break-after: avoid;
    }
    
    /* Cover Page */
    .cover-page {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      height: 10in;
    }
    
    .cover-header {
      text-align: center;
      padding-top: 1in;
    }
    
    .company-logo {
      max-width: 200px;
      max-height: 80px;
      margin-bottom: 20px;
    }
    
    .company-name {
      font-size: 28pt;
      font-weight: bold;
      color: #1e40af;
      margin-bottom: 10px;
    }
    
    .proposal-title {
      font-size: 36pt;
      font-weight: bold;
      color: #1f2937;
      margin: 40px 0;
    }
    
    .cover-photo {
      width: 100%;
      max-height: 300px;
      object-fit: cover;
      border-radius: 8px;
      margin: 30px 0;
    }
    
    .customer-info {
      text-align: left;
      padding: 20px;
      background: #f8fafc;
      border-radius: 8px;
    }
    
    .customer-info h3 {
      color: #1e40af;
      margin-bottom: 10px;
    }
    
    .cover-footer {
      display: flex;
      justify-content: space-between;
      padding: 20px;
      border-top: 2px solid #e5e7eb;
    }
    
    .estimate-meta {
      font-size: 10pt;
      color: #6b7280;
    }
    
    /* Headers */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 15px;
      border-bottom: 2px solid #1e40af;
      margin-bottom: 20px;
    }
    
    .header-logo {
      max-height: 40px;
    }
    
    .header-title {
      font-size: 14pt;
      font-weight: bold;
      color: #1e40af;
    }
    
    /* Section Titles */
    .section-title {
      font-size: 16pt;
      font-weight: bold;
      color: #1e40af;
      margin: 25px 0 15px;
      padding-bottom: 5px;
      border-bottom: 1px solid #e5e7eb;
    }
    
    /* Pricing Tiers */
    .tiers-container {
      display: flex;
      gap: 15px;
      margin: 20px 0;
    }
    
    .tier-card {
      flex: 1;
      border: 2px solid #e5e7eb;
      border-radius: 12px;
      overflow: hidden;
      background: white;
    }
    
    .tier-card.recommended {
      border-color: #1e40af;
      box-shadow: 0 4px 12px rgba(30, 64, 175, 0.15);
    }
    
    .tier-header {
      padding: 15px;
      text-align: center;
      background: #f8fafc;
    }
    
    .tier-card.recommended .tier-header {
      background: #1e40af;
      color: white;
    }
    
    .tier-badge {
      display: inline-block;
      padding: 2px 10px;
      background: #1e40af;
      color: white;
      font-size: 9pt;
      border-radius: 10px;
      margin-bottom: 5px;
    }
    
    .tier-card.recommended .tier-badge {
      background: white;
      color: #1e40af;
    }
    
    .tier-label {
      font-size: 18pt;
      font-weight: bold;
      margin: 5px 0;
    }
    
    .tier-price {
      font-size: 24pt;
      font-weight: bold;
      color: #059669;
    }
    
    .tier-card.recommended .tier-price {
      color: white;
    }
    
    .tier-per-square {
      font-size: 10pt;
      color: #6b7280;
    }
    
    .tier-card.recommended .tier-per-square {
      color: #bfdbfe;
    }
    
    .tier-body {
      padding: 15px;
    }
    
    .tier-features {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    
    .tier-features li {
      padding: 5px 0;
      padding-left: 20px;
      position: relative;
      font-size: 10pt;
    }
    
    .tier-features li::before {
      content: "✓";
      position: absolute;
      left: 0;
      color: #059669;
      font-weight: bold;
    }
    
    .tier-warranty {
      margin-top: 10px;
      padding: 10px;
      background: #f0fdf4;
      border-radius: 6px;
      font-size: 10pt;
    }
    
    .tier-warranty strong {
      color: #059669;
    }
    
    /* Financing */
    .financing-options {
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
    }
    
    .financing-option {
      display: flex;
      justify-content: space-between;
      padding: 8px;
      background: #f8fafc;
      border-radius: 6px;
      margin-bottom: 5px;
      font-size: 10pt;
    }
    
    .financing-monthly {
      font-weight: bold;
      color: #1e40af;
    }
    
    .promo-badge {
      display: inline-block;
      padding: 2px 8px;
      background: #fef3c7;
      color: #d97706;
      font-size: 8pt;
      border-radius: 4px;
    }
    
    /* Measurements Table */
    .measurements-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    
    .measurements-table th,
    .measurements-table td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    
    .measurements-table th {
      background: #f8fafc;
      font-weight: bold;
      color: #1e40af;
    }
    
    .measurements-table tr:last-child td {
      border-bottom: none;
    }
    
    /* Scope of Work */
    .scope-list {
      margin: 15px 0;
      padding-left: 20px;
    }
    
    .scope-list li {
      padding: 5px 0;
    }
    
    /* Terms */
    .terms-section {
      font-size: 9pt;
      color: #6b7280;
    }
    
    .terms-section h4 {
      color: #1f2937;
      margin-top: 15px;
      margin-bottom: 5px;
    }
    
    /* Signature Section */
    .signature-section {
      margin-top: 40px;
      page-break-inside: avoid;
    }
    
    .signature-box {
      display: flex;
      gap: 40px;
      margin-top: 20px;
    }
    
    .signature-field {
      flex: 1;
    }
    
    .signature-line {
      border-bottom: 1px solid #1f2937;
      height: 40px;
      margin-bottom: 5px;
    }
    
    .signature-label {
      font-size: 9pt;
      color: #6b7280;
    }
    
    /* Photos Grid */
    .photos-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 15px;
      margin: 15px 0;
    }
    
    .photo-item {
      border-radius: 8px;
      overflow: hidden;
    }
    
    .photo-item img {
      width: 100%;
      height: 200px;
      object-fit: cover;
    }
    
    /* Roof Diagram */
    .roof-diagram {
      text-align: center;
      margin: 20px 0;
    }
    
    .roof-diagram img {
      max-width: 100%;
      max-height: 400px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
    }
    
    /* Footer */
    .page-footer {
      text-align: center;
      font-size: 9pt;
      color: #6b7280;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
      margin-top: auto;
    }
    
    @media print {
      .page {
        margin: 0;
        padding: 0.5in;
      }
    }
  </style>
</head>
<body>
  <!-- Cover Page -->
  <div class="page cover-page">
    <div class="cover-header">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="company-logo">` : ''}
      <div class="company-name">${companyName}</div>
      <div class="proposal-title">Roofing Proposal</div>
      ${coverPhotoUrl ? `<img src="${coverPhotoUrl}" alt="Property" class="cover-photo">` : ''}
    </div>
    
    <div class="customer-info">
      <h3>Prepared For:</h3>
      <p><strong>${customerName}</strong></p>
      <p>${customerAddress}</p>
    </div>
    
    <div class="cover-footer">
      <div class="estimate-meta">
        <p><strong>Estimate #:</strong> ${estimateNumber}</p>
        <p><strong>Date:</strong> ${createdAt}</p>
        <p><strong>Valid Until:</strong> ${validUntil}</p>
      </div>
      <div class="estimate-meta" style="text-align: right;">
        <p>${companyAddress}</p>
        <p>${companyPhone}</p>
        <p>${companyEmail}</p>
        ${companyLicense ? `<p>License #: ${companyLicense}</p>` : ''}
      </div>
    </div>
  </div>
  
  <!-- Pricing Options Page -->
  <div class="page">
    <div class="page-header">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="header-logo">` : ''}
      <div class="header-title">Pricing Options</div>
    </div>
    
    <h2 class="section-title">Choose Your Package</h2>
    <p>Select the option that best fits your needs and budget. All packages include professional installation by our certified team.</p>
    
    <div class="tiers-container">
      ${tiers.map(tier => `
        <div class="tier-card ${tier.recommended ? 'recommended' : ''}">
          <div class="tier-header">
            ${tier.recommended ? '<span class="tier-badge">RECOMMENDED</span>' : ''}
            <div class="tier-label">${tier.label}</div>
            <div class="tier-price">${formatCurrency(tier.totalPrice)}</div>
            <div class="tier-per-square">${formatCurrency(tier.pricePerSquare)}/square</div>
          </div>
          <div class="tier-body">
            <ul class="tier-features">
              ${tier.features.slice(0, 6).map(f => `<li>${f}</li>`).join('')}
            </ul>
            <div class="tier-warranty">
              <strong>${tier.warranty.years}-Year ${tier.warranty.type} Warranty</strong><br>
              ${tier.warranty.description}
            </div>
            <div class="financing-options">
              <p style="font-size: 9pt; color: #6b7280; margin-bottom: 8px;">Financing Available:</p>
              ${tier.financing.slice(0, 2).map(f => `
                <div class="financing-option">
                  <span>${f.termMonths} months @ ${f.aprPercent}% APR</span>
                  <span class="financing-monthly">${formatCurrency(f.monthlyPayment)}/mo</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    
    <div class="page-footer">
      ${companyName} | ${companyPhone} | ${companyEmail}
    </div>
  </div>
  
  <!-- Measurements Page -->
  <div class="page">
    <div class="page-header">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="header-logo">` : ''}
      <div class="header-title">Property Measurements</div>
    </div>
    
    <h2 class="section-title">Roof Measurements</h2>
    
    ${roofDiagramUrl ? `
      <div class="roof-diagram">
        <img src="${roofDiagramUrl}" alt="Roof Diagram">
      </div>
    ` : ''}
    
    <table class="measurements-table">
      <thead>
        <tr>
          <th>Measurement</th>
          <th>Value</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Total Roof Area</td>
          <td>${roofAreaSqFt.toLocaleString()} sq ft (${roofSquares.toFixed(1)} squares)</td>
        </tr>
        <tr>
          <td>Predominant Pitch</td>
          <td>${pitch}</td>
        </tr>
        <tr>
          <td>Ridge Length</td>
          <td>${linearMeasurements.ridge.toFixed(0)} LF</td>
        </tr>
        <tr>
          <td>Hip Length</td>
          <td>${linearMeasurements.hip.toFixed(0)} LF</td>
        </tr>
        <tr>
          <td>Valley Length</td>
          <td>${linearMeasurements.valley.toFixed(0)} LF</td>
        </tr>
        <tr>
          <td>Eave Length</td>
          <td>${linearMeasurements.eave.toFixed(0)} LF</td>
        </tr>
        <tr>
          <td>Rake Length</td>
          <td>${linearMeasurements.rake.toFixed(0)} LF</td>
        </tr>
      </tbody>
    </table>
    
    ${beforePhotos && beforePhotos.length > 0 ? `
      <h2 class="section-title">Property Photos</h2>
      <div class="photos-grid">
        ${beforePhotos.slice(0, 4).map(url => `
          <div class="photo-item">
            <img src="${url}" alt="Property photo">
          </div>
        `).join('')}
      </div>
    ` : ''}
    
    <div class="page-footer">
      ${companyName} | ${companyPhone} | ${companyEmail}
    </div>
  </div>
  
  <!-- Scope of Work Page -->
  <div class="page">
    <div class="page-header">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="header-logo">` : ''}
      <div class="header-title">Scope of Work</div>
    </div>
    
    <h2 class="section-title">What's Included</h2>
    <ul class="scope-list">
      ${scopeOfWork.map(item => `<li>${item}</li>`).join('')}
    </ul>
    
    ${exclusions && exclusions.length > 0 ? `
      <h2 class="section-title">Exclusions</h2>
      <ul class="scope-list">
        ${exclusions.map(item => `<li>${item}</li>`).join('')}
      </ul>
    ` : ''}
    
    <h2 class="section-title">Warranty Information</h2>
    <p>${warranty}</p>
    
    <h2 class="section-title">Payment Terms</h2>
    <p>${paymentTerms}</p>
    
    <div class="page-footer">
      ${companyName} | ${companyPhone} | ${companyEmail}
    </div>
  </div>
  
  <!-- Terms & Signature Page -->
  <div class="page">
    <div class="page-header">
      ${companyLogo ? `<img src="${companyLogo}" alt="${companyName}" class="header-logo">` : ''}
      <div class="header-title">Terms & Agreement</div>
    </div>
    
    <div class="terms-section">
      <h2 class="section-title">Terms & Conditions</h2>
      <p>${termsAndConditions}</p>
    </div>
    
    <div class="signature-section">
      <h2 class="section-title">Authorization</h2>
      <p>By signing below, you authorize ${companyName} to proceed with the selected roofing package.</p>
      
      <div style="margin: 20px 0; padding: 15px; background: #f8fafc; border-radius: 8px;">
        <p><strong>Selected Package:</strong> ______________________</p>
        <p><strong>Total Investment:</strong> $_____________________</p>
      </div>
      
      <div class="signature-box">
        <div class="signature-field">
          <div class="signature-line"></div>
          <div class="signature-label">Customer Signature</div>
        </div>
        <div class="signature-field">
          <div class="signature-line"></div>
          <div class="signature-label">Date</div>
        </div>
      </div>
      
      <div class="signature-box">
        <div class="signature-field">
          <div class="signature-line"></div>
          <div class="signature-label">Print Name</div>
        </div>
        <div class="signature-field">
          <div class="signature-line"></div>
          <div class="signature-label">Company Representative</div>
        </div>
      </div>
    </div>
    
    <div class="page-footer">
      ${companyName} | ${companyPhone} | ${companyEmail}<br>
      Thank you for choosing ${companyName}!
    </div>
  </div>
</body>
</html>
  `;
}

/**
 * Generate a simplified preview HTML (single page summary)
 */
export function generatePreviewHTML(data: ProposalData): string {
  const { companyName, customerName, tiers, estimateNumber, validUntil } = data;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; }
    .tiers { display: flex; gap: 20px; }
    .tier { flex: 1; border: 1px solid #ddd; padding: 20px; border-radius: 8px; }
    .tier.recommended { border-color: #1e40af; background: #f0f5ff; }
    .tier h3 { margin: 0 0 10px; }
    .price { font-size: 24px; font-weight: bold; color: #059669; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${companyName}</h1>
    <h2>Proposal for ${customerName}</h2>
    <p>Estimate #${estimateNumber} | Valid until ${validUntil}</p>
  </div>
  <div class="tiers">
    ${tiers.map(t => `
      <div class="tier ${t.recommended ? 'recommended' : ''}">
        <h3>${t.label}</h3>
        <div class="price">${formatCurrency(t.totalPrice)}</div>
        <p>${t.warranty.years}-year warranty</p>
      </div>
    `).join('')}
  </div>
</body>
</html>
  `;
}
