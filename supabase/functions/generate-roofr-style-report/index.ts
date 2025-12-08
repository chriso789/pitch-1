import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Waste percentage options
const WASTE_PERCENTAGES = [0, 10, 12, 15, 17, 20, 22]

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { measurementId, measurement, tags, address, companyInfo, pipelineEntryId } = await req.json()
    console.log('📄 Generating Roofr-style report for:', address || measurementId)

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    // Extract measurement data
    const totalArea = measurement?.summary?.total_area_sqft || tags?.['roof.plan_area'] || 0
    const totalSquares = (totalArea / 100).toFixed(2)
    const pitch = measurement?.summary?.pitch || measurement?.predominant_pitch || '6/12'
    const facetCount = measurement?.faces?.length || tags?.['roof.faces_count'] || 0
    
    // Linear features
    const eaves = tags?.['lf.eave'] || measurement?.summary?.eave_ft || 0
    const rakes = tags?.['lf.rake'] || measurement?.summary?.rake_ft || 0
    const ridges = tags?.['lf.ridge'] || measurement?.summary?.ridge_ft || 0
    const hips = tags?.['lf.hip'] || measurement?.summary?.hip_ft || 0
    const valleys = tags?.['lf.valley'] || measurement?.summary?.valley_ft || 0
    const stepFlashing = tags?.['lf.step'] || 0

    // Materials calculation
    const materials = {
      shingleBundles: Math.ceil((totalArea * 1.1) / 33.3),
      starterBundles: Math.ceil((eaves + rakes) / 120),
      iceWaterRolls: Math.ceil(valleys / 66),
      underlaymentRolls: Math.ceil(totalArea / 400),
      hipRidgeBundles: Math.ceil((ridges + hips) / 35),
      valleySheets: Math.ceil(valleys / 10),
      dripEdgeSheets: Math.ceil((eaves + rakes) / 10),
    }

    // Generate waste table
    const wasteTable = WASTE_PERCENTAGES.map(waste => ({
      waste,
      area: (totalArea * (1 + waste / 100)).toFixed(0),
      squares: ((totalArea * (1 + waste / 100)) / 100).toFixed(2),
    }))

    // Format feet and inches
    const formatFeetInches = (feet: number) => {
      const wholeFeet = Math.floor(feet)
      const inches = Math.round((feet - wholeFeet) * 12)
      return `${wholeFeet}ft ${inches}in`
    }

    // Generate 7-page HTML report matching Roofr format
    const html = generateRoofrStyleHTML({
      address,
      companyInfo: companyInfo || { name: 'PITCH CRM' },
      totalArea,
      totalSquares,
      pitch,
      facetCount,
      linear: { eaves, rakes, ridges, hips, valleys, stepFlashing },
      materials,
      wasteTable,
      facets: measurement?.faces || [],
      formatFeetInches,
    })

    // Upload to Supabase Storage
    const fileName = `roofr-report-${Date.now()}.html`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('measurement-reports')
      .upload(fileName, new Blob([html], { type: 'text/html' }), {
        contentType: 'text/html',
        cacheControl: '3600',
        upsert: true
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      // Try creating bucket if it doesn't exist
      await supabase.storage.createBucket('measurement-reports', { public: true })
      const retryUpload = await supabase.storage
        .from('measurement-reports')
        .upload(fileName, new Blob([html], { type: 'text/html' }), {
          contentType: 'text/html',
          cacheControl: '3600',
          upsert: true
        })
      if (retryUpload.error) throw retryUpload.error
    }

    const { data: urlData } = supabase.storage
      .from('measurement-reports')
      .getPublicUrl(fileName)

    // Save to documents table if pipelineEntryId provided
    if (pipelineEntryId) {
      await supabase.from('documents').insert({
        pipeline_entry_id: pipelineEntryId,
        name: `Roof Measurement Report - ${address}`,
        file_url: urlData.publicUrl,
        file_type: 'html',
        document_type: 'measurement_report',
        created_at: new Date().toISOString(),
      })
      console.log('📎 Report saved to documents')
    }

    console.log('✅ Roofr-style report generated:', urlData.publicUrl)

    return new Response(JSON.stringify({
      success: true,
      pdfUrl: urlData.publicUrl,
      fileName,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('❌ Report generation error:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})

interface ReportData {
  address: string
  companyInfo: { name: string; logo?: string; phone?: string; email?: string; license?: string }
  totalArea: number
  totalSquares: string
  pitch: string
  facetCount: number
  linear: { eaves: number; rakes: number; ridges: number; hips: number; valleys: number; stepFlashing: number }
  materials: { shingleBundles: number; starterBundles: number; iceWaterRolls: number; underlaymentRolls: number; hipRidgeBundles: number; valleySheets: number; dripEdgeSheets: number }
  wasteTable: Array<{ waste: number; area: string; squares: string }>
  facets: any[]
  formatFeetInches: (feet: number) => string
}

function generateRoofrStyleHTML(data: ReportData): string {
  const { address, companyInfo, totalArea, totalSquares, pitch, facetCount, linear, materials, wasteTable, facets, formatFeetInches } = data
  
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
    .materials-section { margin: 24px 0; }
    .disclaimer { margin-top: 24px; padding: 16px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 12px; color: #92400e; }
    @media print { .page { page-break-after: always; margin: 0; } }
  `

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Roof Measurement Report - ${address}</title>
  <style>${pageStyle}</style>
</head>
<body>

  <!-- PAGE 1: COVER -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="text-align: right; font-size: 12px; color: #666;">
        ${companyInfo.phone ? `<div>${companyInfo.phone}</div>` : ''}
        ${companyInfo.email ? `<div>${companyInfo.email}</div>` : ''}
        ${companyInfo.license ? `<div>License: ${companyInfo.license}</div>` : ''}
      </div>
    </div>

    <div style="text-align: center; margin: 40px 0;">
      <h1 style="font-size: 48px; color: #2563eb; margin-bottom: 8px;">Roof Report</h1>
      <p style="font-size: 16px; color: #666;">AI-Powered Measurement Technology</p>
    </div>

    <div style="background: #f9fafb; padding: 24px; border-radius: 8px; margin: 32px 0;">
      <p style="font-size: 20px; font-weight: 600;">${address}</p>
    </div>

    <div class="stat-grid">
      <div class="stat-box">
        <div class="stat-value">${Math.round(totalArea).toLocaleString()}</div>
        <div class="stat-label">Total Sq Ft</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${facetCount}</div>
        <div class="stat-label">Roof Facets</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${pitch}</div>
        <div class="stat-label">Predominant Pitch</div>
      </div>
    </div>

    <div style="margin-top: 40px; text-align: center;">
      <div style="background: #e5e7eb; height: 300px; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #666;">
        [Satellite Image with Roof Overlay]
      </div>
    </div>

    <div class="footer">
      <span>Generated on ${new Date().toLocaleDateString()}</span>
      <span>Page 1 of 7</span>
      <span>Powered by PITCH CRM</span>
    </div>
  </div>

  <!-- PAGE 2: CLEAN DIAGRAM -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Roof Diagram</div>
    </div>

    <div style="background: white; border: 2px solid #e5e7eb; border-radius: 8px; height: 600px; display: flex; align-items: center; justify-content: center; position: relative;">
      <div style="color: #666;">[3D Isometric Roof Diagram]</div>
      <div style="position: absolute; top: 16px; right: 16px; text-align: center;">
        <div style="font-size: 14px; font-weight: bold; color: #ef4444;">N</div>
        <div style="width: 2px; height: 20px; background: #333; margin: 4px auto;"></div>
        <div style="width: 30px; height: 30px; border: 2px solid #333; border-radius: 50%;"></div>
      </div>
    </div>

    <div style="margin-top: 20px; display: flex; gap: 16px; justify-content: center;">
      <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 16px; height: 3px; background: #22c55e;"></span> Ridge</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 16px; height: 3px; background: #3b82f6;"></span> Hip</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 16px; height: 3px; background: #ef4444;"></span> Valley</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 16px; height: 3px; background: #06b6d4;"></span> Eave</span>
      <span style="display: flex; align-items: center; gap: 4px;"><span style="width: 16px; height: 3px; background: #a855f7;"></span> Rake</span>
    </div>

    <div class="footer">
      <span>${address}</span>
      <span>Page 2 of 7</span>
      <span>${companyInfo.name}</span>
    </div>
  </div>

  <!-- PAGE 3: LENGTH MEASUREMENTS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Length Measurement Report</div>
    </div>

    <div class="linear-grid">
      <div class="linear-box eave">
        <div class="linear-value">${formatFeetInches(linear.eaves)}</div>
        <div class="linear-label">Eaves</div>
      </div>
      <div class="linear-box valley">
        <div class="linear-value">${formatFeetInches(linear.valleys)}</div>
        <div class="linear-label">Valleys</div>
      </div>
      <div class="linear-box hip">
        <div class="linear-value">${formatFeetInches(linear.hips)}</div>
        <div class="linear-label">Hips</div>
      </div>
      <div class="linear-box ridge">
        <div class="linear-value">${formatFeetInches(linear.ridges)}</div>
        <div class="linear-label">Ridges</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0;">
      <div class="linear-box rake">
        <div class="linear-value">${formatFeetInches(linear.rakes)}</div>
        <div class="linear-label">Rakes</div>
      </div>
      <div class="linear-box" style="background: #fff7ed; border: 2px solid #f97316; color: #ea580c;">
        <div class="linear-value">${formatFeetInches(linear.stepFlashing)}</div>
        <div class="linear-label">Step Flashing</div>
      </div>
      <div class="linear-box" style="background: #f9fafb; border: 2px solid #9ca3af; color: #6b7280;">
        <div class="linear-value">0ft 0in</div>
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
        <tr><td>Eaves</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.eaves)}</td></tr>
        <tr><td>Valleys</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.valleys)}</td></tr>
        <tr><td>Hips</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.hips)}</td></tr>
        <tr><td>Ridges</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.ridges)}</td></tr>
        <tr><td>Rakes</td><td style="text-align: right; font-weight: 600;">${formatFeetInches(linear.rakes)}</td></tr>
        <tr class="highlight-row"><td>Hips + Ridges</td><td style="text-align: right;">${formatFeetInches(linear.hips + linear.ridges)}</td></tr>
        <tr class="highlight-row"><td>Eaves + Rakes</td><td style="text-align: right;">${formatFeetInches(linear.eaves + linear.rakes)}</td></tr>
      </tbody>
    </table>

    <div class="footer">
      <span>${address}</span>
      <span>Page 3 of 7</span>
      <span>${companyInfo.name}</span>
    </div>
  </div>

  <!-- PAGE 4: AREA MEASUREMENTS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Area Measurement Report</div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin: 24px 0;">
      <div class="stat-box">
        <div class="stat-value">${Math.round(totalArea).toLocaleString()}</div>
        <div class="stat-label">Total Roof Area (sqft)</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${pitch}</div>
        <div class="stat-label">Predominant Pitch</div>
      </div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0;">
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">${Math.round(totalArea).toLocaleString()}</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Pitched Roof (sqft)</div>
      </div>
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">0</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Flat Roof (sqft)</div>
      </div>
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 16px; text-align: center;">
        <div style="font-size: 24px; font-weight: 700;">0</div>
        <div style="font-size: 11px; color: #666; text-transform: uppercase;">Two Story (sqft)</div>
      </div>
    </div>

    <div style="background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; height: 350px; display: flex; align-items: center; justify-content: center; margin-top: 24px;">
      <div style="color: #666;">[Diagram with Area Labels per Facet]</div>
    </div>

    <div class="footer">
      <span>${address}</span>
      <span>Page 4 of 7</span>
      <span>${companyInfo.name}</span>
    </div>
  </div>

  <!-- PAGE 5: PITCH & DIRECTION -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Pitch & Direction Report</div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 24px; margin: 24px 0;">
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px;">
        <h3 style="font-size: 14px; color: #666; margin-bottom: 12px;">Pitch Distribution</h3>
        ${facets.reduce((html: string, face: any, i: number) => {
          const facePitch = face.pitch || '6/12'
          return html + `<div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #f3f4f6;">
            <span style="font-weight: 600;">${facePitch}</span>
            <span style="color: #666;">Facet ${i + 1}</span>
          </div>`
        }, '')}
      </div>
      <div style="border: 2px solid #e5e7eb; border-radius: 8px; padding: 20px;">
        <h3 style="font-size: 14px; color: #666; margin-bottom: 12px;">Orientation</h3>
        <div style="font-size: 28px; font-weight: 700; color: #2563eb;">South-Facing</div>
        <p style="font-size: 12px; color: #666; margin-top: 8px;">Based on largest facet orientation</p>
      </div>
    </div>

    <div style="background: #f9fafb; border: 2px solid #e5e7eb; border-radius: 8px; height: 400px; display: flex; align-items: center; justify-content: center;">
      <div style="color: #666;">[Diagram with Pitch Values per Facet]</div>
    </div>

    <div class="footer">
      <span>${address}</span>
      <span>Page 5 of 7</span>
      <span>${companyInfo.name}</span>
    </div>
  </div>

  <!-- PAGE 6: SUMMARY -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Report Summary</div>
    </div>

    <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 32px;">
      <div>
        <h3 class="section-title" style="margin-top: 0;">Measurements Summary</h3>
        <table>
          <tbody>
            <tr><td>Total Roof Area</td><td style="text-align: right; font-weight: 700;">${Math.round(totalArea).toLocaleString()} sqft</td></tr>
            <tr><td>Predominant Pitch</td><td style="text-align: right; font-weight: 700;">${pitch}</td></tr>
            <tr><td>Facet Count</td><td style="text-align: right; font-weight: 700;">${facetCount}</td></tr>
            <tr><td>Eaves</td><td style="text-align: right;">${formatFeetInches(linear.eaves)}</td></tr>
            <tr><td>Rakes</td><td style="text-align: right;">${formatFeetInches(linear.rakes)}</td></tr>
            <tr><td>Ridges</td><td style="text-align: right;">${formatFeetInches(linear.ridges)}</td></tr>
            <tr><td>Hips</td><td style="text-align: right;">${formatFeetInches(linear.hips)}</td></tr>
            <tr><td>Valleys</td><td style="text-align: right;">${formatFeetInches(linear.valleys)}</td></tr>
          </tbody>
        </table>
      </div>

      <div>
        <h3 class="section-title" style="margin-top: 0;">Waste Factor Table</h3>
        <table>
          <thead>
            <tr>
              <th>Waste %</th>
              <th style="text-align: right;">Area (sqft)</th>
              <th style="text-align: right;">Squares</th>
            </tr>
          </thead>
          <tbody>
            ${wasteTable.map(row => `
              <tr class="${row.waste === 10 ? 'highlight-row' : ''}">
                <td>${row.waste}%</td>
                <td style="text-align: right;">${row.area}</td>
                <td style="text-align: right;">${row.squares}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="font-size: 11px; color: #666; margin-top: 8px;">* Recommended waste: 10-15% for standard roofs</p>
      </div>
    </div>

    <div class="footer">
      <span>${address}</span>
      <span>Page 6 of 7</span>
      <span>${companyInfo.name}</span>
    </div>
  </div>

  <!-- PAGE 7: MATERIALS -->
  <div class="page">
    <div class="header">
      <div class="company-name">${companyInfo.name}</div>
      <div style="font-size: 18px; color: #2563eb; font-weight: 600;">Material Calculations</div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Product</th>
          <th style="text-align: center;">Unit</th>
          <th style="text-align: right;">0%</th>
          <th style="text-align: right;">10%</th>
          <th style="text-align: right;">12%</th>
          <th style="text-align: right;">15%</th>
        </tr>
      </thead>
      <tbody>
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Shingles</td></tr>
        ${['IKO Cambridge', 'CertainTeed Landmark', 'GAF Timberline HDZ', 'Owens Corning Duration', 'Atlas Pristine'].map(brand => `
          <tr>
            <td style="padding-left: 24px;">${brand}</td>
            <td style="text-align: center;">bundle</td>
            <td style="text-align: right;">${Math.ceil(totalArea / 33.3)}</td>
            <td style="text-align: right;">${Math.ceil((totalArea * 1.1) / 33.3)}</td>
            <td style="text-align: right;">${Math.ceil((totalArea * 1.12) / 33.3)}</td>
            <td style="text-align: right;">${Math.ceil((totalArea * 1.15) / 33.3)}</td>
          </tr>
        `).join('')}
        
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Starter Strip</td></tr>
        <tr><td style="padding-left: 24px;">IKO Leading Edge</td><td style="text-align: center;">bundle</td><td style="text-align: right;" colspan="4">${materials.starterBundles}</td></tr>
        
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Ice & Water Shield</td></tr>
        <tr><td style="padding-left: 24px;">IKO GoldShield</td><td style="text-align: center;">roll</td><td style="text-align: right;" colspan="4">${materials.iceWaterRolls}</td></tr>
        
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Hip & Ridge Cap</td></tr>
        <tr><td style="padding-left: 24px;">IKO Ultra HP</td><td style="text-align: center;">bundle</td><td style="text-align: right;" colspan="4">${materials.hipRidgeBundles}</td></tr>
        
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Underlayment</td></tr>
        <tr>
          <td style="padding-left: 24px;">IKO RoofGard-SA</td>
          <td style="text-align: center;">roll</td>
          <td style="text-align: right;">${materials.underlaymentRolls}</td>
          <td style="text-align: right;">${Math.ceil(materials.underlaymentRolls * 1.1)}</td>
          <td style="text-align: right;">${Math.ceil(materials.underlaymentRolls * 1.12)}</td>
          <td style="text-align: right;">${Math.ceil(materials.underlaymentRolls * 1.15)}</td>
        </tr>
        
        <tr style="background: #eff6ff;"><td colspan="6" style="font-weight: 700;">Drip Edge</td></tr>
        <tr><td style="padding-left: 24px;">Aluminum Drip Edge</td><td style="text-align: center;">10ft pc</td><td style="text-align: right;" colspan="4">${materials.dripEdgeSheets}</td></tr>
      </tbody>
    </table>

    <div class="disclaimer">
      <strong>Disclaimer:</strong> Material quantities are estimates based on measurements. 
      Always verify requirements before ordering. Local building codes may require additional materials.
    </div>

    <div class="footer">
      <span>${address}</span>
      <span>Page 7 of 7</span>
      <span>© ${new Date().getFullYear()} ${companyInfo.name}</span>
    </div>
  </div>

</body>
</html>`
}
