import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { measurementId, companyInfo } = await req.json()
    console.log('📄 Generating PDF for:', measurementId)

    // Validate measurementId before querying to avoid invalid UUID errors
    if (!measurementId || typeof measurementId !== 'string') {
      console.error('Missing measurementId in request body')
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid measurement ID'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const uuidRegex = /^[0-9a-fA-F-]{36}$/
    if (!uuidRegex.test(measurementId)) {
      console.error('Invalid UUID format for measurementId:', measurementId)
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid measurement ID format'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Fixed: Use correct table name roof_measurement_facets
    const { data: measurement, error: measurementError } = await supabase
      .from('roof_measurements')
      .select(`*, roof_measurement_facets (*)`)
      .eq('id', measurementId)
      .maybeSingle()

    if (measurementError) {
      console.error('Measurement query error:', measurementError)
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to load measurement'
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (!measurement) {
      console.error('Measurement not found for id:', measurementId)
      return new Response(JSON.stringify({
        success: false,
        error: 'Measurement not found'
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const html = generateReportHTML(measurement, companyInfo)

    const fileName = `roof-report-${measurementId}.html`
    
    // Fixed: Use correct storage bucket name roof-reports
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('roof-reports')
      .upload(fileName, new Blob([html], { type: 'text/html' }), {
        contentType: 'text/html',
        cacheControl: '3600',
        upsert: true
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      throw uploadError
    }

    const { data: urlData } = supabase.storage
      .from('roof-reports')
      .getPublicUrl(fileName)

    await supabase
      .from('roof_measurements')
      .update({
        report_pdf_url: urlData.publicUrl,
        report_generated_at: new Date().toISOString()
      })
      .eq('id', measurementId)

    console.log('✅ Report generated')

    return new Response(JSON.stringify({
      success: true,
      pdfUrl: urlData.publicUrl,
      fileName
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('❌ Error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

function generateReportHTML(measurement: any, companyInfo: any) {
  // Fixed: Use correct property name roof_measurement_facets
  const facets = measurement.roof_measurement_facets || []
  const materials = measurement.material_calculations || {}
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Roof Measurement Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #333; line-height: 1.6; }
    .page { width: 8.5in; min-height: 11in; padding: 0.75in; background: white; page-break-after: always; }
    .header { display: flex; justify-content: space-between; align-items: start; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 3px solid #1e5631; }
    .company-name { font-size: 24px; font-weight: bold; color: #1e5631; }
    .report-title h1 { font-size: 36px; color: #2196F3; }
    .property-info { background: #f5f5f5; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
    .property-address { font-size: 20px; font-weight: bold; color: #333; }
    .summary-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px; }
    .stat-box { background: white; border: 2px solid #e0e0e0; border-radius: 8px; padding: 15px; text-align: center; }
    .stat-value { font-size: 28px; font-weight: bold; color: #1e5631; }
    .stat-label { font-size: 12px; color: #666; text-transform: uppercase; }
    .section-title { font-size: 24px; color: #2196F3; margin: 30px 0 15px 0; padding-bottom: 10px; border-bottom: 2px solid #2196F3; }
    .measurements-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .measurements-table th { background: #1e5631; color: white; padding: 12px; text-align: left; }
    .measurements-table td { padding: 10px 12px; border-bottom: 1px solid #e0e0e0; }
    .measurements-table tr:nth-child(even) { background: #f9f9f9; }
    .facet-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 20px 0; }
    .facet-card { border-left: 4px solid #2196F3; background: #f5f5f5; padding: 15px; border-radius: 4px; }
    .materials-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin: 20px 0; }
    .material-item { background: white; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; }
    .material-quantity { font-size: 24px; font-weight: bold; color: #1e5631; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e0e0e0; text-align: center; color: #666; font-size: 11px; }
    @media print { .page { margin: 0; border: none; page-break-after: always; } }
  </style>
</head>
<body>

  <div class="page">
    <div class="header">
      <div>
        <div class="company-name">${companyInfo?.name || 'PITCH CRM'}</div>
        <div style="font-size: 12px; color: #666; margin-top: 5px;">
          ${companyInfo?.phone || ''}<br>${companyInfo?.email || ''}
        </div>
      </div>
      <div class="report-title" style="text-align: right;">
        <h1>Roof Report</h1>
        <div style="font-size: 14px; color: #666;">AI-Powered Measurement</div>
      </div>
    </div>

    <div class="property-info">
      <div class="property-address">${measurement.property_address || 'Property Address'}</div>
      <div style="display: flex; justify-content: space-between; margin-top: 10px;">
        <div><strong>Date:</strong> ${new Date().toLocaleDateString()}</div>
        <div><strong>Confidence:</strong> ${measurement.measurement_confidence || 0}%</div>
      </div>
    </div>

    <div class="summary-stats">
      <div class="stat-box">
        <div class="stat-value">${measurement.total_area_adjusted_sqft?.toFixed(0) || '0'}</div>
        <div class="stat-label">Total Area (sqft)</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${measurement.facet_count || '0'}</div>
        <div class="stat-label">Roof Facets</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${measurement.predominant_pitch || 'N/A'}</div>
        <div class="stat-label">Pitch</div>
      </div>
    </div>

    <div class="section-title">Measurements Summary</div>
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
          <td><strong>${measurement.total_area_adjusted_sqft?.toFixed(2) || '0'} sqft</strong></td>
        </tr>
        <tr>
          <td>Total Squares</td>
          <td><strong>${measurement.total_squares?.toFixed(1) || '0'}</strong></td>
        </tr>
        <tr>
          <td>Facet Count</td>
          <td>${measurement.facet_count || 0}</td>
        </tr>
        <tr>
          <td>Predominant Pitch</td>
          <td>${measurement.predominant_pitch || 'N/A'}</td>
        </tr>
        <tr>
          <td>Complexity</td>
          <td style="text-transform: capitalize;">${measurement.complexity_rating || 'N/A'}</td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <p>© ${new Date().getFullYear()} ${companyInfo?.name || 'PITCH CRM'} | AI-Powered Measurement Technology</p>
    </div>
  </div>

  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo?.name || 'PITCH CRM'}</div>
    </div>

    <div class="section-title">Linear Measurements</div>
    <div class="property-address" style="font-size: 16px; margin-bottom: 20px;">
      ${measurement.property_address || 'Property Address'}
    </div>

    <div class="summary-stats">
      <div class="stat-box" style="background: #e8f5e9;">
        <div class="stat-value" style="color: #2e7d32;">${measurement.total_eave_length?.toFixed(0) || '0'} ft</div>
        <div class="stat-label">Eaves</div>
      </div>
      <div class="stat-box" style="background: #fff3e0;">
        <div class="stat-value" style="color: #ef6c00;">${measurement.total_rake_length?.toFixed(0) || '0'} ft</div>
        <div class="stat-label">Rakes</div>
      </div>
      <div class="stat-box" style="background: #fce4ec;">
        <div class="stat-value" style="color: #c2185b;">${measurement.total_valley_length?.toFixed(0) || '0'} ft</div>
        <div class="stat-label">Valleys</div>
      </div>
      <div class="stat-box" style="background: #e3f2fd;">
        <div class="stat-value" style="color: #1976d2;">${measurement.total_hip_length?.toFixed(0) || '0'} ft</div>
        <div class="stat-label">Hips</div>
      </div>
      <div class="stat-box" style="background: #f3e5f5;">
        <div class="stat-value" style="color: #7b1fa2;">${measurement.total_ridge_length?.toFixed(0) || '0'} ft</div>
        <div class="stat-label">Ridges</div>
      </div>
    </div>

    <table class="measurements-table" style="margin-top: 30px;">
      <thead>
        <tr>
          <th>Edge Type</th>
          <th>Length (ft)</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Eaves</td>
          <td><strong>${measurement.total_eave_length?.toFixed(1) || '0.0'} ft</strong></td>
        </tr>
        <tr>
          <td>Valleys</td>
          <td><strong>${measurement.total_valley_length?.toFixed(1) || '0.0'} ft</strong></td>
        </tr>
        <tr>
          <td>Hips</td>
          <td><strong>${measurement.total_hip_length?.toFixed(1) || '0.0'} ft</strong></td>
        </tr>
        <tr>
          <td>Ridges</td>
          <td><strong>${measurement.total_ridge_length?.toFixed(1) || '0.0'} ft</strong></td>
        </tr>
        <tr>
          <td>Rakes</td>
          <td><strong>${measurement.total_rake_length?.toFixed(1) || '0.0'} ft</strong></td>
        </tr>
        <tr style="background: #e3f2fd; font-weight: bold;">
          <td>Hips + Ridges</td>
          <td><strong>${((measurement.total_hip_length || 0) + (measurement.total_ridge_length || 0)).toFixed(1)} ft</strong></td>
        </tr>
        <tr style="background: #e8f5e9; font-weight: bold;">
          <td>Eaves + Rakes</td>
          <td><strong>${((measurement.total_eave_length || 0) + (measurement.total_rake_length || 0)).toFixed(1)} ft</strong></td>
        </tr>
      </tbody>
    </table>

    <div class="footer">
      <p>Measurements are rounded for display. Totals use exact measurements.</p>
    </div>
  </div>

  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo?.name || 'PITCH CRM'}</div>
    </div>

    <div class="section-title">Individual Roof Facets</div>
    <div class="property-address" style="font-size: 16px; margin-bottom: 20px;">
      ${measurement.property_address || 'Property Address'}
    </div>

    <div class="facet-grid">
      ${facets.map((facet: any, index: number) => `
        <div class="facet-card" style="border-left-color: hsl(${index * 40}, 70%, 50%);">
          <div style="font-weight: bold; margin-bottom: 8px;">Facet ${facet.facet_number || index + 1}</div>
          <div style="font-size: 12px; color: #666;">
            <strong>Area:</strong> ${facet.area_adjusted_sqft?.toFixed(0) || '0'} sqft<br>
            <strong>Pitch:</strong> ${facet.pitch || 'N/A'}<br>
            <strong>Shape:</strong> ${facet.shape_type || 'N/A'}
          </div>
        </div>
      `).join('')}
    </div>

    <div class="section-title" style="margin-top: 40px;">Material Requirements</div>

    <div class="materials-grid">
      ${materials.shingleBundles ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Shingle Bundles</div>
          <div class="material-quantity">${materials.shingleBundles}</div>
          <div style="font-size: 11px; color: #999;">3 bundles per square</div>
        </div>
      ` : ''}

      ${materials.underlaymentRolls ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Underlayment Rolls</div>
          <div class="material-quantity">${materials.underlaymentRolls}</div>
          <div style="font-size: 11px; color: #999;">400 sqft per roll</div>
        </div>
      ` : ''}

      ${materials.iceWaterShieldRolls ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Ice & Water Shield</div>
          <div class="material-quantity">${materials.iceWaterShieldRolls} rolls</div>
          <div style="font-size: 11px; color: #999;">${materials.iceWaterShieldFeet?.toFixed(0) || 0} linear feet</div>
        </div>
      ` : ''}

      ${materials.dripEdgeSheets ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Drip Edge</div>
          <div class="material-quantity">${materials.dripEdgeSheets} sheets</div>
          <div style="font-size: 11px; color: #999;">${materials.dripEdgeFeet?.toFixed(0) || 0} ft total</div>
        </div>
      ` : ''}

      ${materials.starterStripBundles ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Starter Strip</div>
          <div class="material-quantity">${materials.starterStripBundles} bundles</div>
          <div style="font-size: 11px; color: #999;">${materials.starterStripFeet?.toFixed(0) || 0} ft coverage</div>
        </div>
      ` : ''}

      ${materials.hipRidgeBundles ? `
        <div class="material-item">
          <div style="font-size: 12px; color: #666;">Hip & Ridge Cap</div>
          <div class="material-quantity">${materials.hipRidgeBundles} bundles</div>
          <div style="font-size: 11px; color: #999;">${materials.hipRidgeFeet?.toFixed(0) || 0} ft total</div>
        </div>
      ` : ''}
    </div>

    <div style="margin-top: 30px; padding: 15px; background: #ffebee; border-left: 4px solid #f44336; border-radius: 4px;">
      <p style="font-size: 11px; color: #c62828;">
        <strong>Disclaimer:</strong> These calculations are estimates. Always verify before ordering materials.
      </p>
    </div>

    <div class="footer">
      <p>© ${new Date().getFullYear()} ${companyInfo?.name || 'PITCH CRM'} | All rights reserved</p>
    </div>
  </div>

</body>
</html>`
}
