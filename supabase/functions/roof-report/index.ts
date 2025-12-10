import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// ============================================================================
// ROOF REPORT ENGINE - TypeScript Port
// Accepts measurement JSON, returns complete report data for PDF generation
// ============================================================================

interface MeasurementInput {
  // Property info
  address: string
  lat?: number
  lng?: number
  
  // Areas
  total_area_sqft: number
  total_squares?: number
  pitched_area?: number
  flat_area?: number
  
  // Pitch info
  pitch: string | number
  predominant_pitch?: string
  
  // Linear features (in feet)
  eave_ft?: number
  rake_ft?: number
  ridge_ft?: number
  hip_ft?: number
  valley_ft?: number
  step_flashing_ft?: number
  wall_flashing_ft?: number
  perimeter_ft?: number
  
  // Facets
  facets?: Array<{
    id?: string
    name?: string
    area_sqft: number
    pitch?: string
    direction?: string
    shape?: string
  }>
  
  // Additional
  waste_pct?: number
  stories?: number
  complexity?: 'simple' | 'medium' | 'complex'
  satellite_image_url?: string
}

interface CompanyInfo {
  name: string
  logo_url?: string
  phone?: string
  email?: string
  license?: string
  address?: string
}

interface MaterialCalculations {
  shingle_bundles: number
  shingle_squares: number
  starter_bundles: number
  ice_water_rolls: number
  underlayment_rolls: number
  hip_ridge_bundles: number
  drip_edge_pieces: number
  valley_pieces: number
  step_flashing_ft: number
  penetration_flashings: number
}

interface WasteScenario {
  waste_pct: number
  adjusted_area: number
  adjusted_squares: number
  shingle_bundles: number
}

interface ReportOutput {
  success: boolean
  report: {
    // Metadata
    generated_at: string
    report_id: string
    
    // Property
    property: {
      address: string
      lat?: number
      lng?: number
    }
    
    // Summary stats
    summary: {
      total_area_sqft: number
      total_squares: number
      pitched_area: number
      flat_area: number
      predominant_pitch: string
      facet_count: number
      complexity: string
      stories: number
    }
    
    // Linear measurements
    linear: {
      eave_ft: number
      rake_ft: number
      ridge_ft: number
      hip_ft: number
      valley_ft: number
      step_flashing_ft: number
      wall_flashing_ft: number
      perimeter_ft: number
      hip_ridge_total_ft: number
      eave_rake_total_ft: number
    }
    
    // Individual facets
    facets: Array<{
      id: string
      name: string
      area_sqft: number
      pitch: string
      direction: string
      shape: string
    }>
    
    // Waste scenarios
    waste_scenarios: WasteScenario[]
    
    // Material calculations
    materials: MaterialCalculations
    
    // Company info
    company: CompanyInfo
    
    // For PDF rendering
    html?: string
  }
}

// ============================================================================
// CALCULATION ENGINE
// ============================================================================

function calculateMaterials(
  totalArea: number,
  linear: {
    eave_ft: number
    rake_ft: number
    ridge_ft: number
    hip_ft: number
    valley_ft: number
    step_flashing_ft: number
  },
  wastePct: number = 10
): MaterialCalculations {
  const adjustedArea = totalArea * (1 + wastePct / 100)
  const squares = adjustedArea / 100
  
  return {
    // Shingles: 3 bundles per square
    shingle_bundles: Math.ceil(squares * 3),
    shingle_squares: parseFloat(squares.toFixed(2)),
    
    // Starter: eaves + rakes, ~120 linear ft per bundle
    starter_bundles: Math.ceil((linear.eave_ft + linear.rake_ft) / 120),
    
    // Ice & Water: valleys + 3ft up from eaves, 66 sqft per roll
    ice_water_rolls: Math.ceil((linear.valley_ft + (linear.eave_ft * 3)) / 66),
    
    // Underlayment: 400 sqft per roll
    underlayment_rolls: Math.ceil(adjustedArea / 400),
    
    // Hip & Ridge cap: ~35 linear ft per bundle
    hip_ridge_bundles: Math.ceil((linear.hip_ft + linear.ridge_ft) / 35),
    
    // Drip edge: 10ft pieces
    drip_edge_pieces: Math.ceil((linear.eave_ft + linear.rake_ft) / 10),
    
    // Valley metal: 10ft pieces
    valley_pieces: Math.ceil(linear.valley_ft / 10),
    
    // Step flashing
    step_flashing_ft: Math.ceil(linear.step_flashing_ft),
    
    // Penetration flashings: estimate 1 per 500 sqft
    penetration_flashings: Math.max(1, Math.ceil(totalArea / 500)),
  }
}

function generateWasteScenarios(totalArea: number): WasteScenario[] {
  const wasteLevels = [0, 10, 12, 15, 17, 20, 22]
  
  return wasteLevels.map(waste_pct => {
    const adjusted_area = totalArea * (1 + waste_pct / 100)
    const adjusted_squares = adjusted_area / 100
    return {
      waste_pct,
      adjusted_area: parseFloat(adjusted_area.toFixed(0)),
      adjusted_squares: parseFloat(adjusted_squares.toFixed(2)),
      shingle_bundles: Math.ceil(adjusted_squares * 3),
    }
  })
}

function formatPitch(pitch: string | number): string {
  if (typeof pitch === 'number') {
    return `${pitch}/12`
  }
  if (pitch.includes('/')) {
    return pitch
  }
  return `${pitch}/12`
}

function formatFeetInches(feet: number): string {
  const wholeFeet = Math.floor(feet)
  const inches = Math.round((feet - wholeFeet) * 12)
  return `${wholeFeet}ft ${inches}in`
}

// ============================================================================
// HTML REPORT GENERATOR
// ============================================================================

function generateReportHTML(report: ReportOutput['report']): string {
  const { property, summary, linear, facets, waste_scenarios, materials, company } = report
  
  const pageStyle = `
    @page { size: letter; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; color: #1a1a1a; line-height: 1.5; background: white; }
    .page { width: 8.5in; min-height: 11in; padding: 0.5in; background: white; page-break-after: always; position: relative; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #2563eb; }
    .company-name { font-size: 24px; font-weight: 700; color: #2563eb; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin: 24px 0; }
    .stat-box { background: #f0f9ff; border: 2px solid #2563eb; border-radius: 8px; padding: 20px; text-align: center; }
    .stat-value { font-size: 32px; font-weight: 700; color: #2563eb; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .section-title { font-size: 20px; font-weight: 700; color: #2563eb; margin: 32px 0 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th { background: #2563eb; color: white; padding: 12px; text-align: left; font-weight: 600; }
    td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; }
    tr:nth-child(even) { background: #f9fafb; }
    .linear-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0; }
    .linear-box { border-radius: 8px; padding: 16px; text-align: center; }
    .linear-box.eave { background: #ecfeff; border: 2px solid #06b6d4; color: #0891b2; }
    .linear-box.valley { background: #fef2f2; border: 2px solid #ef4444; color: #dc2626; }
    .linear-box.hip { background: #eff6ff; border: 2px solid #3b82f6; color: #2563eb; }
    .linear-box.ridge { background: #f0fdf4; border: 2px solid #22c55e; color: #16a34a; }
    .linear-box.rake { background: #faf5ff; border: 2px solid #a855f7; color: #9333ea; }
    .linear-value { font-size: 20px; font-weight: 700; }
    .linear-label { font-size: 11px; text-transform: uppercase; }
    .footer { position: absolute; bottom: 0.5in; left: 0.5in; right: 0.5in; display: flex; justify-content: space-between; font-size: 10px; color: #666; padding-top: 12px; border-top: 1px solid #e5e7eb; }
    .highlight-row { background: #dbeafe !important; font-weight: 600; }
    .facet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .facet-card { border-left: 4px solid #2563eb; background: #f9fafb; padding: 12px; border-radius: 4px; }
    .disclaimer { margin-top: 24px; padding: 16px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 12px; color: #92400e; }
    @media print { .page { page-break-after: always; margin: 0; } }
  `
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roof Measurement Report - ${property.address}</title>
  <style>${pageStyle}</style>
</head>
<body>

  <!-- PAGE 1: COVER -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="text-align: right; font-size: 12px; color: #666;">
        ${company.phone ? `<div>${company.phone}</div>` : ''}
        ${company.email ? `<div>${company.email}</div>` : ''}
        ${company.license ? `<div>License: ${company.license}</div>` : ''}
      </div>
    </div>

    <div style="text-align: center; margin: 40px 0;">
      <h1 style="font-size: 48px; color: #2563eb; margin-bottom: 8px;">Roof Report</h1>
      <p style="font-size: 16px; color: #666;">AI-Powered Measurement Technology</p>
    </div>

    <div style="background: #f9fafb; padding: 24px; border-radius: 8px; margin: 32px 0;">
      <p style="font-size: 20px; font-weight: 600;">${property.address}</p>
    </div>

    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${Math.round(summary.total_area_sqft).toLocaleString()}</div>
        <div class="stat-label">Total Sq Ft</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${summary.facet_count}</div>
        <div class="stat-label">Roof Facets</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${summary.predominant_pitch}</div>
        <div class="stat-label">Predominant Pitch</div>
      </div>
    </div>

    <div class="footer">
      <span>Generated on ${new Date().toLocaleDateString()}</span>
      <span>Page 1 of 7</span>
      <span>Powered by PITCH CRM</span>
    </div>
  </div>

  <!-- PAGE 2: LENGTH MEASUREMENTS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Length Measurements</div>
    </div>

    <div class="linear-grid">
      <div class="linear-box eave">
        <div class="linear-value">${formatFeetInches(linear.eave_ft)}</div>
        <div class="linear-label">Eaves</div>
      </div>
      <div class="linear-box valley">
        <div class="linear-value">${formatFeetInches(linear.valley_ft)}</div>
        <div class="linear-label">Valleys</div>
      </div>
      <div class="linear-box hip">
        <div class="linear-value">${formatFeetInches(linear.hip_ft)}</div>
        <div class="linear-label">Hips</div>
      </div>
      <div class="linear-box ridge">
        <div class="linear-value">${formatFeetInches(linear.ridge_ft)}</div>
        <div class="linear-label">Ridges</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0;">
      <div class="linear-box rake">
        <div class="linear-value">${formatFeetInches(linear.rake_ft)}</div>
        <div class="linear-label">Rakes</div>
      </div>
      <div class="linear-box" style="background: #fff7ed; border: 2px solid #f97316; color: #ea580c;">
        <div class="linear-value">${formatFeetInches(linear.step_flashing_ft)}</div>
        <div class="linear-label">Step Flashing</div>
      </div>
      <div class="linear-box" style="background: #f9fafb; border: 2px solid #9ca3af; color: #6b7280;">
        <div class="linear-value">${formatFeetInches(linear.wall_flashing_ft)}</div>
        <div class="linear-label">Wall Flashing</div>
      </div>
    </div>

    <table style="margin-top: 24px;">
      <thead>
        <tr>
          <th>Edge Type</th>
          <th style="text-align: right;">Length</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Eaves</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.eave_ft)}</td></tr>
        <tr><td>Valleys</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.valley_ft)}</td></tr>
        <tr><td>Hips</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.hip_ft)}</td></tr>
        <tr><td>Ridges</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.ridge_ft)}</td></tr>
        <tr><td>Rakes</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.rake_ft)}</td></tr>
        <tr class="highlight-row"><td>Hips + Ridges</td><td style="text-align: right;">${formatFeetInches(linear.hip_ridge_total_ft)}</td></tr>
        <tr class="highlight-row"><td>Eaves + Rakes</td><td style="text-align: right;">${formatFeetInches(linear.eave_rake_total_ft)}</td></tr>
      </tbody>
    </table>

    <div class="footer">
      <span>${property.address}</span>
      <span>Page 2 of 7</span>
      <span>${company.name}</span>
    </div>
  </div>

  <!-- PAGE 3: AREA MEASUREMENTS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Area Measurements</div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 24px 0;">
      <div class="stat-box">
        <div class="stat-value">${Math.round(summary.total_area_sqft).toLocaleString()}</div>
        <div class="stat-label">Total Roof Area (sqft)</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${summary.predominant_pitch}</div>
        <div class="stat-label">Predominant Pitch</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0;">
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">${Math.round(summary.pitched_area).toLocaleString()}</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Pitched (sqft)</div>
      </div>
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">${Math.round(summary.flat_area)}</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Flat (sqft)</div>
      </div>
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">${summary.stories}</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Stories</div>
      </div>
    </div>

    <div class="footer">
      <span>${property.address}</span>
      <span>Page 3 of 7</span>
      <span>${company.name}</span>
    </div>
  </div>

  <!-- PAGE 4: FACETS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Roof Facets</div>
    </div>

    <div class="facet-grid">
      ${facets.map((facet, i) => `
        <div class="facet-card" style="border-left-color: hsl(${i * 40}, 70%, 50%);">
          <div style="font-weight: bold; margin-bottom: 8px;">${facet.name}</div>
          <div style="font-size: 12px; color: #666;">
            <strong>Area:</strong> ${Math.round(facet.area_sqft)} sqft<br>
            <strong>Pitch:</strong> ${facet.pitch}<br>
            <strong>Direction:</strong> ${facet.direction}<br>
            <strong>Shape:</strong> ${facet.shape}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="footer">
      <span>${property.address}</span>
      <span>Page 4 of 7</span>
      <span>${company.name}</span>
    </div>
  </div>

  <!-- PAGE 5: WASTE SCENARIOS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Waste Calculation Summary</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Waste %</th>
          <th style="text-align: right;">Adjusted Area (sqft)</th>
          <th style="text-align: right;">Squares</th>
          <th style="text-align: right;">Bundles (3/sq)</th>
        </tr>
      </thead>
      <tbody>
        ${waste_scenarios.map(s => `
          <tr${s.waste_pct === 10 ? ' class="highlight-row"' : ''}>
            <td>${s.waste_pct}%</td>
            <td style="text-align: right;">${s.adjusted_area.toLocaleString()}</td>
            <td style="text-align: right;">${s.adjusted_squares}</td>
            <td style="text-align: right;">${s.shingle_bundles}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="footer">
      <span>${property.address}</span>
      <span>Page 5 of 7</span>
      <span>${company.name}</span>
    </div>
  </div>

  <!-- PAGE 6: MATERIALS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Material Requirements</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Material</th>
          <th style="text-align: right;">Quantity</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Shingles</td>
          <td style="text-align: right; font-weight: 600;">${materials.shingle_bundles} bundles</td>
          <td style="color: #666;">${materials.shingle_squares} squares (3 bundles/sq)</td>
        </tr>
        <tr>
          <td>Starter Strip</td>
          <td style="text-align: right; font-weight: 600;">${materials.starter_bundles} bundles</td>
          <td style="color: #666;">Eaves + Rakes coverage</td>
        </tr>
        <tr>
          <td>Ice & Water Shield</td>
          <td style="text-align: right; font-weight: 600;">${materials.ice_water_rolls} rolls</td>
          <td style="color: #666;">Valleys + first 3ft eaves</td>
        </tr>
        <tr>
          <td>Underlayment</td>
          <td style="text-align: right; font-weight: 600;">${materials.underlayment_rolls} rolls</td>
          <td style="color: #666;">400 sqft per roll</td>
        </tr>
        <tr>
          <td>Hip & Ridge Cap</td>
          <td style="text-align: right; font-weight: 600;">${materials.hip_ridge_bundles} bundles</td>
          <td style="color: #666;">~35 linear ft per bundle</td>
        </tr>
        <tr>
          <td>Drip Edge</td>
          <td style="text-align: right; font-weight: 600;">${materials.drip_edge_pieces} pieces</td>
          <td style="color: #666;">10ft pieces</td>
        </tr>
        <tr>
          <td>Valley Metal</td>
          <td style="text-align: right; font-weight: 600;">${materials.valley_pieces} pieces</td>
          <td style="color: #666;">10ft pieces</td>
        </tr>
        <tr>
          <td>Penetration Flashings</td>
          <td style="text-align: right; font-weight: 600;">${materials.penetration_flashings} units</td>
          <td style="color: #666;">Estimate 1 per 500 sqft</td>
        </tr>
      </tbody>
    </table>

    <div class="disclaimer">
      <strong>Disclaimer:</strong> Material quantities are estimates based on measurements and standard waste factors. 
      Always verify quantities with your supplier before ordering. Actual requirements may vary based on roof complexity, 
      local codes, and installation methods.
    </div>

    <div class="footer">
      <span>${property.address}</span>
      <span>Page 6 of 7</span>
      <span>${company.name}</span>
    </div>
  </div>

  <!-- PAGE 7: SUMMARY -->
  <div class="page">
    <div class="header">
      <div class="company-name">${company.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Report Summary</div>
    </div>

    <div style="background: #f9fafb; padding: 24px; border-radius: 8px; margin: 24px 0;">
      <h2 style="font-size: 20px; margin-bottom: 16px;">${property.address}</h2>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
        <div>
          <strong>Total Area:</strong> ${Math.round(summary.total_area_sqft).toLocaleString()} sqft<br>
          <strong>Total Squares:</strong> ${summary.total_squares}<br>
          <strong>Predominant Pitch:</strong> ${summary.predominant_pitch}<br>
          <strong>Facet Count:</strong> ${summary.facet_count}
        </div>
        <div>
          <strong>Perimeter:</strong> ${formatFeetInches(linear.perimeter_ft)}<br>
          <strong>Ridges + Hips:</strong> ${formatFeetInches(linear.hip_ridge_total_ft)}<br>
          <strong>Eaves + Rakes:</strong> ${formatFeetInches(linear.eave_rake_total_ft)}<br>
          <strong>Valleys:</strong> ${formatFeetInches(linear.valley_ft)}
        </div>
      </div>
    </div>

    <div style="text-align: center; margin-top: 48px; color: #666;">
      <p style="font-size: 14px;">Thank you for choosing ${company.name}</p>
      <p style="font-size: 12px; margin-top: 8px;">
        ${company.phone ? `Phone: ${company.phone}` : ''}
        ${company.email ? ` | Email: ${company.email}` : ''}
      </p>
    </div>

    <div class="footer">
      <span>Report ID: ${report.report_id}</span>
      <span>Page 7 of 7</span>
      <span>© ${new Date().getFullYear()} ${company.name}</span>
    </div>
  </div>

</body>
</html>`
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  
  try {
    const body = await req.json()
    const { measurement, company_info } = body as { 
      measurement: MeasurementInput
      company_info?: CompanyInfo 
    }
    
    if (!measurement) {
      throw new Error('Missing measurement data')
    }
    
    console.log('📄 Processing roof report for:', measurement.address)
    
    // Extract and normalize measurement data
    const totalArea = measurement.total_area_sqft || 0
    const totalSquares = measurement.total_squares || (totalArea / 100)
    const wastePct = measurement.waste_pct || 10
    
    // Linear features
    const linear = {
      eave_ft: measurement.eave_ft || 0,
      rake_ft: measurement.rake_ft || 0,
      ridge_ft: measurement.ridge_ft || 0,
      hip_ft: measurement.hip_ft || 0,
      valley_ft: measurement.valley_ft || 0,
      step_flashing_ft: measurement.step_flashing_ft || 0,
      wall_flashing_ft: measurement.wall_flashing_ft || 0,
      perimeter_ft: measurement.perimeter_ft || (measurement.eave_ft || 0) + (measurement.rake_ft || 0),
      hip_ridge_total_ft: (measurement.hip_ft || 0) + (measurement.ridge_ft || 0),
      eave_rake_total_ft: (measurement.eave_ft || 0) + (measurement.rake_ft || 0),
    }
    
    // Facets
    const facets = (measurement.facets || []).map((f, i) => ({
      id: f.id || `facet-${i + 1}`,
      name: f.name || `Facet ${i + 1}`,
      area_sqft: f.area_sqft || 0,
      pitch: f.pitch || measurement.pitch?.toString() || '6/12',
      direction: f.direction || 'N/A',
      shape: f.shape || 'Unknown',
    }))
    
    // Calculate materials
    const materials = calculateMaterials(totalArea, linear, wastePct)
    
    // Generate waste scenarios
    const waste_scenarios = generateWasteScenarios(totalArea)
    
    // Company info with defaults
    const company: CompanyInfo = {
      name: company_info?.name || 'PITCH CRM',
      logo_url: company_info?.logo_url,
      phone: company_info?.phone,
      email: company_info?.email,
      license: company_info?.license,
      address: company_info?.address,
    }
    
    // Build report
    const report: ReportOutput['report'] = {
      generated_at: new Date().toISOString(),
      report_id: `RPT-${Date.now().toString(36).toUpperCase()}`,
      
      property: {
        address: measurement.address,
        lat: measurement.lat,
        lng: measurement.lng,
      },
      
      summary: {
        total_area_sqft: totalArea,
        total_squares: parseFloat(totalSquares.toFixed(2)),
        pitched_area: measurement.pitched_area || totalArea,
        flat_area: measurement.flat_area || 0,
        predominant_pitch: formatPitch(measurement.predominant_pitch || measurement.pitch || '6/12'),
        facet_count: facets.length || 1,
        complexity: measurement.complexity || 'medium',
        stories: measurement.stories || 1,
      },
      
      linear,
      facets,
      waste_scenarios,
      materials,
      company,
    }
    
    // Generate HTML for PDF rendering
    report.html = generateReportHTML(report)
    
    console.log('✅ Roof report generated:', report.report_id)
    
    const response: ReportOutput = {
      success: true,
      report,
    }
    
    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
    
  } catch (error: any) {
    console.error('❌ Roof report error:', error)
    
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to generate report',
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})