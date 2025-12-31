import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { jsPDF } from 'https://esm.sh/jspdf@2.5.1'

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

    // Fetch measurement data
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

    console.log('📊 Building PDF directly with jsPDF...')

    // Generate PDF using jsPDF directly (no Puppeteer needed)
    const pdfBytes = generatePDFDirectly(measurement, companyInfo)
    
    const fileName = `roof-report-${measurementId}.pdf`

    console.log('📤 Uploading PDF to storage...')

    // Upload actual PDF to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('measurement-reports')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      throw new Error(`Failed to upload PDF: ${uploadError.message}`)
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('measurement-reports')
      .getPublicUrl(fileName)

    const pdfUrl = urlData.publicUrl

    // Update the measurement record with the PDF URL
    await supabase
      .from('roof_measurements')
      .update({
        report_pdf_url: pdfUrl,
        report_generated_at: new Date().toISOString()
      })
      .eq('id', measurementId)

    console.log('✅ PDF Report generated successfully:', pdfUrl)

    return new Response(JSON.stringify({
      success: true,
      pdfUrl: pdfUrl,
      storagePath: uploadData.path,
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

function generatePDFDirectly(measurement: any, companyInfo: any): Uint8Array {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'letter'
  })

  const facets = measurement.roof_measurement_facets || []
  const materials = measurement.material_calculations || {}
  const companyName = companyInfo?.name || 'PITCH CRM'
  const propertyAddress = measurement.property_address || 'Property Address'

  // Colors
  const primaryGreen = [30, 86, 49] as [number, number, number]
  const primaryBlue = [33, 150, 243] as [number, number, number]
  const darkGray = [51, 51, 51] as [number, number, number]
  const lightGray = [102, 102, 102] as [number, number, number]

  // Page dimensions
  const pageWidth = 215.9
  const pageHeight = 279.4
  const margin = 20
  const contentWidth = pageWidth - (margin * 2)

  // ============ PAGE 1: SUMMARY ============
  let yPos = margin

  // Header
  doc.setFontSize(20)
  doc.setTextColor(...primaryGreen)
  doc.text(companyName, margin, yPos)

  doc.setFontSize(28)
  doc.setTextColor(...primaryBlue)
  doc.text('Roof Measurement Report', pageWidth - margin, yPos, { align: 'right' })
  
  yPos += 8
  doc.setFontSize(11)
  doc.setTextColor(...lightGray)
  doc.text('AI-Powered Measurement', pageWidth - margin, yPos, { align: 'right' })

  // Divider line
  yPos += 8
  doc.setDrawColor(...primaryGreen)
  doc.setLineWidth(0.8)
  doc.line(margin, yPos, pageWidth - margin, yPos)

  // Property Info Box
  yPos += 12
  doc.setFillColor(245, 245, 245)
  doc.roundedRect(margin, yPos, contentWidth, 25, 3, 3, 'F')
  
  yPos += 8
  doc.setFontSize(16)
  doc.setTextColor(...darkGray)
  doc.text(propertyAddress, margin + 8, yPos)

  yPos += 10
  doc.setFontSize(11)
  doc.setTextColor(...lightGray)
  doc.text(`Date: ${new Date().toLocaleDateString()}`, margin + 8, yPos)
  doc.text(`Confidence: ${measurement.measurement_confidence || 0}%`, margin + 100, yPos)

  // Summary Stats - 3 boxes
  yPos += 20
  const boxWidth = (contentWidth - 10) / 3
  const boxHeight = 35
  
  // Box 1: Total Area
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(224, 224, 224)
  doc.roundedRect(margin, yPos, boxWidth, boxHeight, 3, 3, 'FD')
  doc.setFontSize(22)
  doc.setTextColor(...primaryGreen)
  doc.text(`${(measurement.total_area_adjusted_sqft || 0).toFixed(0)}`, margin + boxWidth/2, yPos + 16, { align: 'center' })
  doc.setFontSize(9)
  doc.setTextColor(...lightGray)
  doc.text('TOTAL AREA (SQFT)', margin + boxWidth/2, yPos + 26, { align: 'center' })

  // Box 2: Facet Count
  doc.roundedRect(margin + boxWidth + 5, yPos, boxWidth, boxHeight, 3, 3, 'FD')
  doc.setFontSize(22)
  doc.setTextColor(...primaryGreen)
  doc.text(`${measurement.facet_count || 0}`, margin + boxWidth + 5 + boxWidth/2, yPos + 16, { align: 'center' })
  doc.setFontSize(9)
  doc.setTextColor(...lightGray)
  doc.text('ROOF FACETS', margin + boxWidth + 5 + boxWidth/2, yPos + 26, { align: 'center' })

  // Box 3: Pitch
  doc.roundedRect(margin + (boxWidth + 5) * 2, yPos, boxWidth, boxHeight, 3, 3, 'FD')
  doc.setFontSize(22)
  doc.setTextColor(...primaryGreen)
  doc.text(measurement.predominant_pitch || 'N/A', margin + (boxWidth + 5) * 2 + boxWidth/2, yPos + 16, { align: 'center' })
  doc.setFontSize(9)
  doc.setTextColor(...lightGray)
  doc.text('PITCH', margin + (boxWidth + 5) * 2 + boxWidth/2, yPos + 26, { align: 'center' })

  // Measurements Summary Section
  yPos += boxHeight + 15
  doc.setFontSize(18)
  doc.setTextColor(...primaryBlue)
  doc.text('Measurements Summary', margin, yPos)
  yPos += 3
  doc.setDrawColor(...primaryBlue)
  doc.setLineWidth(0.5)
  doc.line(margin, yPos, margin + 80, yPos)

  // Table
  yPos += 10
  const tableData = [
    ['Total Roof Area', `${(measurement.total_area_adjusted_sqft || 0).toFixed(2)} sqft`],
    ['Total Squares', `${(measurement.total_squares || 0).toFixed(1)}`],
    ['Facet Count', `${measurement.facet_count || 0}`],
    ['Predominant Pitch', measurement.predominant_pitch || 'N/A'],
    ['Complexity', measurement.complexity_rating || 'N/A'],
  ]

  doc.setFontSize(11)
  tableData.forEach((row, i) => {
    if (i % 2 === 1) {
      doc.setFillColor(249, 249, 249)
      doc.rect(margin, yPos - 4, contentWidth, 10, 'F')
    }
    doc.setTextColor(...darkGray)
    doc.text(row[0], margin + 5, yPos)
    doc.setTextColor(...primaryGreen)
    doc.text(row[1], pageWidth - margin - 5, yPos, { align: 'right' })
    yPos += 10
  })

  // Footer
  yPos = pageHeight - 20
  doc.setDrawColor(224, 224, 224)
  doc.setLineWidth(0.3)
  doc.line(margin, yPos, pageWidth - margin, yPos)
  yPos += 8
  doc.setFontSize(9)
  doc.setTextColor(...lightGray)
  doc.text(`© ${new Date().getFullYear()} ${companyName} | AI-Powered Measurement Technology`, pageWidth / 2, yPos, { align: 'center' })

  // ============ PAGE 2: LINEAR MEASUREMENTS ============
  doc.addPage()
  yPos = margin

  // Header
  doc.setFontSize(20)
  doc.setTextColor(...primaryGreen)
  doc.text(companyName, margin, yPos)

  yPos += 15
  doc.setFontSize(18)
  doc.setTextColor(...primaryBlue)
  doc.text('Linear Measurements', margin, yPos)
  yPos += 3
  doc.setDrawColor(...primaryBlue)
  doc.line(margin, yPos, margin + 70, yPos)

  yPos += 10
  doc.setFontSize(12)
  doc.setTextColor(...darkGray)
  doc.text(propertyAddress, margin, yPos)

  // Linear measurement boxes
  yPos += 15
  const lmBoxWidth = (contentWidth - 15) / 4
  const lmBoxHeight = 40

  const linearData = [
    { label: 'EAVES', value: measurement.total_eave_length || 0, color: [46, 125, 50] as [number, number, number] },
    { label: 'RAKES', value: measurement.total_rake_length || 0, color: [239, 108, 0] as [number, number, number] },
    { label: 'VALLEYS', value: measurement.total_valley_length || 0, color: [194, 24, 91] as [number, number, number] },
    { label: 'HIPS', value: measurement.total_hip_length || 0, color: [25, 118, 210] as [number, number, number] },
  ]

  linearData.forEach((item, i) => {
    const x = margin + i * (lmBoxWidth + 5)
    doc.setFillColor(255, 255, 255)
    doc.setDrawColor(224, 224, 224)
    doc.roundedRect(x, yPos, lmBoxWidth, lmBoxHeight, 3, 3, 'FD')
    
    doc.setFontSize(18)
    doc.setTextColor(...item.color)
    doc.text(`${item.value.toFixed(0)} ft`, x + lmBoxWidth/2, yPos + 18, { align: 'center' })
    
    doc.setFontSize(8)
    doc.setTextColor(...lightGray)
    doc.text(item.label, x + lmBoxWidth/2, yPos + 30, { align: 'center' })
  })

  // Ridge box (full width below)
  yPos += lmBoxHeight + 10
  doc.setFillColor(255, 255, 255)
  doc.setDrawColor(224, 224, 224)
  doc.roundedRect(margin, yPos, contentWidth, lmBoxHeight, 3, 3, 'FD')
  doc.setFontSize(18)
  doc.setTextColor(123, 31, 162)
  doc.text(`${(measurement.total_ridge_length || 0).toFixed(0)} ft`, pageWidth/2, yPos + 18, { align: 'center' })
  doc.setFontSize(8)
  doc.setTextColor(...lightGray)
  doc.text('RIDGES', pageWidth/2, yPos + 30, { align: 'center' })

  // Linear table
  yPos += lmBoxHeight + 20
  const linearTableData = [
    ['Eaves', `${(measurement.total_eave_length || 0).toFixed(1)} ft`],
    ['Valleys', `${(measurement.total_valley_length || 0).toFixed(1)} ft`],
    ['Hips', `${(measurement.total_hip_length || 0).toFixed(1)} ft`],
    ['Ridges', `${(measurement.total_ridge_length || 0).toFixed(1)} ft`],
    ['Rakes', `${(measurement.total_rake_length || 0).toFixed(1)} ft`],
    ['Hips + Ridges', `${((measurement.total_hip_length || 0) + (measurement.total_ridge_length || 0)).toFixed(1)} ft`],
    ['Eaves + Rakes', `${((measurement.total_eave_length || 0) + (measurement.total_rake_length || 0)).toFixed(1)} ft`],
  ]

  // Table header
  doc.setFillColor(...primaryGreen)
  doc.rect(margin, yPos, contentWidth, 10, 'F')
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text('Edge Type', margin + 5, yPos + 7)
  doc.text('Length (ft)', pageWidth - margin - 5, yPos + 7, { align: 'right' })
  yPos += 10

  doc.setFontSize(10)
  linearTableData.forEach((row, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(249, 249, 249)
      doc.rect(margin, yPos, contentWidth, 9, 'F')
    }
    if (i >= 5) {
      doc.setFillColor(227, 242, 253)
      doc.rect(margin, yPos, contentWidth, 9, 'F')
    }
    doc.setTextColor(...darkGray)
    doc.text(row[0], margin + 5, yPos + 6)
    doc.setTextColor(...primaryGreen)
    doc.text(row[1], pageWidth - margin - 5, yPos + 6, { align: 'right' })
    yPos += 9
  })

  // Footer
  yPos = pageHeight - 20
  doc.setDrawColor(224, 224, 224)
  doc.line(margin, yPos, pageWidth - margin, yPos)
  yPos += 8
  doc.setFontSize(9)
  doc.setTextColor(...lightGray)
  doc.text('Measurements are rounded for display. Totals use exact measurements.', pageWidth / 2, yPos, { align: 'center' })

  // ============ PAGE 3: FACETS & MATERIALS ============
  if (facets.length > 0 || Object.keys(materials).length > 0) {
    doc.addPage()
    yPos = margin

    // Header
    doc.setFontSize(20)
    doc.setTextColor(...primaryGreen)
    doc.text(companyName, margin, yPos)

    yPos += 15
    doc.setFontSize(18)
    doc.setTextColor(...primaryBlue)
    doc.text('Individual Roof Facets', margin, yPos)
    yPos += 3
    doc.setDrawColor(...primaryBlue)
    doc.line(margin, yPos, margin + 70, yPos)

    yPos += 10
    doc.setFontSize(12)
    doc.setTextColor(...darkGray)
    doc.text(propertyAddress, margin, yPos)

    // Facet cards
    yPos += 15
    const facetColWidth = (contentWidth - 10) / 3
    const facetRowHeight = 45

    facets.forEach((facet: any, i: number) => {
      const col = i % 3
      const row = Math.floor(i / 3)
      const x = margin + col * (facetColWidth + 5)
      const y = yPos + row * (facetRowHeight + 5)

      // Check if we need a new page
      if (y + facetRowHeight > pageHeight - 40) {
        doc.addPage()
        yPos = margin + 20
      }

      const hue = (i * 40) % 360
      doc.setFillColor(245, 245, 245)
      doc.setDrawColor(hue, 70, 50)
      doc.roundedRect(x, y, facetColWidth, facetRowHeight, 2, 2, 'FD')
      
      // Left border color
      doc.setFillColor(33, 150, 243)
      doc.rect(x, y, 3, facetRowHeight, 'F')

      doc.setFontSize(11)
      doc.setTextColor(...darkGray)
      doc.text(`Facet ${facet.facet_number || i + 1}`, x + 8, y + 10)
      
      doc.setFontSize(9)
      doc.setTextColor(...lightGray)
      doc.text(`Area: ${(facet.area_adjusted_sqft || 0).toFixed(0)} sqft`, x + 8, y + 22)
      doc.text(`Pitch: ${facet.pitch || 'N/A'}`, x + 8, y + 32)
      doc.text(`Shape: ${facet.shape_type || 'N/A'}`, x + 8, y + 42)
    })

    // Materials section
    yPos += Math.ceil(facets.length / 3) * (facetRowHeight + 5) + 20
    
    if (Object.keys(materials).length > 0 && yPos < pageHeight - 80) {
      doc.setFontSize(18)
      doc.setTextColor(...primaryBlue)
      doc.text('Material Requirements', margin, yPos)
      yPos += 3
      doc.setDrawColor(...primaryBlue)
      doc.line(margin, yPos, margin + 70, yPos)

      yPos += 15
      const matColWidth = (contentWidth - 5) / 2
      const matRowHeight = 35

      const materialItems = [
        { label: 'Shingle Bundles', value: materials.shingleBundles, note: '3 bundles per square' },
        { label: 'Underlayment Rolls', value: materials.underlaymentRolls, note: '400 sqft per roll' },
        { label: 'Ice & Water Shield', value: `${materials.iceWaterShieldRolls || 0} rolls`, note: `${(materials.iceWaterShieldFeet || 0).toFixed(0)} linear feet` },
        { label: 'Drip Edge', value: `${materials.dripEdgeSheets || 0} sheets`, note: `${(materials.dripEdgeFeet || 0).toFixed(0)} ft total` },
        { label: 'Starter Strip', value: `${materials.starterStripBundles || 0} bundles`, note: `${(materials.starterStripFeet || 0).toFixed(0)} ft coverage` },
        { label: 'Hip & Ridge Cap', value: `${materials.hipRidgeBundles || 0} bundles`, note: `${(materials.hipRidgeFeet || 0).toFixed(0)} ft total` },
      ].filter(m => m.value)

      materialItems.forEach((mat, i) => {
        const col = i % 2
        const row = Math.floor(i / 2)
        const x = margin + col * (matColWidth + 5)
        const y = yPos + row * (matRowHeight + 5)

        doc.setFillColor(255, 255, 255)
        doc.setDrawColor(224, 224, 224)
        doc.roundedRect(x, y, matColWidth, matRowHeight, 3, 3, 'FD')

        doc.setFontSize(9)
        doc.setTextColor(...lightGray)
        doc.text(mat.label, x + 8, y + 10)

        doc.setFontSize(16)
        doc.setTextColor(...primaryGreen)
        doc.text(String(mat.value), x + 8, y + 24)

        doc.setFontSize(8)
        doc.setTextColor(153, 153, 153)
        doc.text(mat.note, x + 8, y + 32)
      })
    }

    // Disclaimer
    yPos = pageHeight - 35
    doc.setFillColor(255, 235, 238)
    doc.roundedRect(margin, yPos, contentWidth, 15, 2, 2, 'F')
    doc.setFontSize(9)
    doc.setTextColor(198, 40, 40)
    doc.text('Disclaimer: These calculations are estimates. Always verify before ordering materials.', margin + 5, yPos + 10)

    // Footer
    yPos = pageHeight - 15
    doc.setFontSize(9)
    doc.setTextColor(...lightGray)
    doc.text(`© ${new Date().getFullYear()} ${companyName} | All rights reserved`, pageWidth / 2, yPos, { align: 'center' })
  }

  // Return as Uint8Array
  return doc.output('arraybuffer') as unknown as Uint8Array
}
