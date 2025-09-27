import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import { corsHeaders } from "../_shared/cors.ts";

interface GeneratePDFRequest {
  estimate_id?: string;
  pipeline_entry_id?: string;
  template_data?: any;
  contact_data?: any;
  photos?: string[];
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } }
    );

    const { estimate_id, pipeline_entry_id, template_data, contact_data, photos }: GeneratePDFRequest = await req.json();

    let estimateData: any = null;
    let contactInfo: any = null;

    // Fetch estimate data if provided
    if (estimate_id) {
      const { data: estimate } = await supabaseClient
        .from('estimates')
        .select('*')
        .eq('id', estimate_id)
        .single();
      
      estimateData = estimate;
    }

    // Fetch pipeline entry data if provided
    if (pipeline_entry_id) {
      const { data: pipelineEntry } = await supabaseClient
        .from('pipeline_entries')
        .select(`
          *,
          contact:contacts(*)
        `)
        .eq('id', pipeline_entry_id)
        .single();
      
      estimateData = pipelineEntry;
      contactInfo = pipelineEntry?.contact;
    }

    // Fetch contact data if not already available
    if (!contactInfo && estimateData?.contact_id) {
      const { data: contact } = await supabaseClient
        .from('contacts')
        .select('*')
        .eq('id', estimateData.contact_id)
        .single();
      
      contactInfo = contact;
    }

    // Fetch company/tenant information
    const tenantId = estimateData?.tenant_id;
    const { data: tenantProfile } = await supabaseClient
      .from('profiles')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('role', 'admin')
      .limit(1)
      .single();

    // Build comprehensive data object for PDF generation
    const pdfData = {
      estimate: estimateData,
      contact: contactInfo,
      company: {
        name: "Your Roofing Company", // This should come from tenant settings
        address: "123 Business St, City, ST 12345",
        phone: "(555) 123-4567",
        email: "info@yourroofing.com",
        website: "www.yourroofing.com",
        logo_url: null // This should come from tenant settings
      },
      photos: photos || [],
      generated_at: new Date().toISOString(),
      
      // Estimate/Pipeline specific data
      roof_area: estimateData?.roof_area_sq_ft || 0,
      material_cost: estimateData?.material_cost || 0,
      labor_cost: estimateData?.labor_cost || 0,
      total_cost: estimateData?.selling_price || estimateData?.total_cost || 0,
      
      // Address information
      property_address: `${contactInfo?.address_street || ''} ${contactInfo?.address_city || ''} ${contactInfo?.address_state || ''} ${contactInfo?.address_zip || ''}`.trim(),
      
      // Date formatting
      estimate_date: new Date().toLocaleDateString(),
      valid_until: estimateData?.valid_until ? new Date(estimateData.valid_until).toLocaleDateString() : null
    };

    // Generate HTML content for PDF
    const htmlContent = generateEstimateHTML(pdfData);

    // For now, we'll store the HTML and return a reference
    // In a production system, you'd convert this to PDF using a service like Puppeteer
    const timestamp = Date.now();
    const fileName = `estimate-${estimate_id || pipeline_entry_id}-${timestamp}.html`;
    
    // Store in a simple format for now (in production, use proper PDF generation)
    const generatedDocument = {
      html_content: htmlContent,
      pdf_data: pdfData,
      file_name: fileName,
      generated_at: new Date().toISOString()
    };

    console.log('PDF generation completed:', fileName);

    return new Response(JSON.stringify({
      success: true,
      document: generatedDocument,
      file_name: fileName,
      download_url: null // Would be set when using real PDF generation
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });

  } catch (error: any) {
    console.error("Error in generate-estimate-pdf function:", error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error.message 
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

function generateEstimateHTML(data: any): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Roofing Estimate</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #2563eb; padding-bottom: 20px; margin-bottom: 30px; }
        .company-info { flex: 1; }
        .company-name { font-size: 24px; font-weight: bold; color: #2563eb; margin-bottom: 5px; }
        .company-details { font-size: 14px; line-height: 1.4; }
        .estimate-info { text-align: right; }
        .estimate-title { font-size: 28px; font-weight: bold; color: #2563eb; margin-bottom: 10px; }
        .estimate-details { font-size: 14px; }
        .section { margin-bottom: 30px; }
        .section-title { font-size: 18px; font-weight: bold; color: #2563eb; margin-bottom: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; }
        .customer-info { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .info-block { background: #f8fafc; padding: 15px; border-radius: 8px; }
        .info-label { font-weight: bold; margin-bottom: 5px; }
        .cost-breakdown { background: #f8fafc; padding: 20px; border-radius: 8px; }
        .cost-item { display: flex; justify-content: space-between; margin-bottom: 10px; }
        .cost-total { font-size: 18px; font-weight: bold; color: #2563eb; border-top: 2px solid #2563eb; padding-top: 10px; margin-top: 15px; }
        .photo-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px; }
        .photo-item { text-align: center; }
        .photo-item img { width: 100%; height: 150px; object-fit: cover; border-radius: 8px; border: 1px solid #e5e7eb; }
        .signature-section { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
        .signature-block { border: 1px solid #d1d5db; padding: 20px; border-radius: 8px; }
        .signature-line { border-bottom: 1px solid #6b7280; margin: 40px 0 10px 0; height: 1px; }
        .signature-label { font-size: 12px; color: #6b7280; text-align: center; }
        .terms { font-size: 12px; color: #6b7280; margin-top: 30px; line-height: 1.5; }
    </style>
</head>
<body>
    <div class="header">
        <div class="company-info">
            <div class="company-name">${data.company.name}</div>
            <div class="company-details">
                ${data.company.address}<br>
                Phone: ${data.company.phone}<br>
                Email: ${data.company.email}<br>
                ${data.company.website}
            </div>
        </div>
        <div class="estimate-info">
            <div class="estimate-title">ESTIMATE</div>
            <div class="estimate-details">
                <strong>Date:</strong> ${data.estimate_date}<br>
                <strong>Estimate #:</strong> ${data.estimate?.estimate_number || 'EST-001'}<br>
                ${data.valid_until ? `<strong>Valid Until:</strong> ${data.valid_until}` : ''}
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Customer Information</div>
        <div class="customer-info">
            <div class="info-block">
                <div class="info-label">Customer</div>
                <div>${data.contact?.first_name || ''} ${data.contact?.last_name || ''}</div>
                ${data.contact?.company_name ? `<div>${data.contact.company_name}</div>` : ''}
                ${data.contact?.email ? `<div>${data.contact.email}</div>` : ''}
                ${data.contact?.phone ? `<div>${data.contact.phone}</div>` : ''}
            </div>
            <div class="info-block">
                <div class="info-label">Property Address</div>
                <div>${data.property_address || 'Address not provided'}</div>
            </div>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Project Details</div>
        <div class="info-block">
            <div><strong>Roof Area:</strong> ${data.roof_area} sq ft</div>
            <div><strong>Project Type:</strong> Roofing Installation/Repair</div>
            <div><strong>Materials:</strong> Premium roofing materials as specified</div>
        </div>
    </div>

    ${data.photos && data.photos.length > 0 ? `
    <div class="section">
        <div class="section-title">Property Photos</div>
        <div class="photo-grid">
            ${data.photos.map((photo: string, index: number) => `
                <div class="photo-item">
                    <img src="${photo}" alt="Property Photo ${index + 1}" />
                    <div>Photo ${index + 1}</div>
                </div>
            `).join('')}
        </div>
    </div>
    ` : ''}

    <div class="section">
        <div class="section-title">Cost Breakdown</div>
        <div class="cost-breakdown">
            <div class="cost-item">
                <span>Materials:</span>
                <span>$${(data.material_cost || 0).toLocaleString()}</span>
            </div>
            <div class="cost-item">
                <span>Labor:</span>
                <span>$${(data.labor_cost || 0).toLocaleString()}</span>
            </div>
            <div class="cost-item cost-total">
                <span>Total Investment:</span>
                <span>$${(data.total_cost || 0).toLocaleString()}</span>
            </div>
        </div>
    </div>

    <div class="signature-section">
        <div class="signature-block">
            <div><strong>Customer Acceptance</strong></div>
            <div class="signature-line"></div>
            <div class="signature-label">Customer Signature</div>
            <div class="signature-line"></div>
            <div class="signature-label">Date</div>
        </div>
        <div class="signature-block">
            <div><strong>Company Representative</strong></div>
            <div class="signature-line"></div>
            <div class="signature-label">Representative Signature</div>
            <div class="signature-line"></div>
            <div class="signature-label">Date</div>
        </div>
    </div>

    <div class="terms">
        <strong>Terms and Conditions:</strong><br>
        This estimate is valid for 30 days from the date above. Work to be completed in accordance with standard industry practices. 
        Payment terms: 50% deposit required to start work, remaining balance due upon completion. 
        All materials and workmanship are guaranteed for one year from completion date.
        Customer is responsible for obtaining necessary permits unless otherwise specified.
    </div>
</body>
</html>
  `;
}

serve(handler);