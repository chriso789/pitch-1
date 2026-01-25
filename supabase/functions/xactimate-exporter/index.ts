import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface XactimateExportRequest {
  measurement_id?: string;
  scope_document_id?: string;
  pipeline_entry_id?: string;
  include_photos?: boolean;
  export_format?: 'esx' | 'xml' | 'json';
}

interface XactimateLineItem {
  category: string;
  selector: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price?: number;
  rcv?: number;
  depreciation?: number;
  acv?: number;
}

// Standard Xactimate category codes for roofing
const XACTIMATE_CODES = {
  shingles_remove: { selector: 'RFG RDCK', description: 'R&R Roofing - Comp shingle - remove only' },
  shingles_install: { selector: 'RFG SHNG3T', description: 'Roofing - Comp. shingle - 3 tab - 25yr' },
  shingles_arch: { selector: 'RFG SHNGA', description: 'Roofing - Comp. shingle - Architectural' },
  underlayment: { selector: 'RFG FELT15', description: 'Roofing - Felt - 15# - 432 SF/roll' },
  ice_water_shield: { selector: 'RFG ICEWTR', description: 'Roofing - Ice & water shield' },
  drip_edge: { selector: 'RFG DRIPEDG', description: 'Roofing - Drip edge - aluminum' },
  ridge_cap: { selector: 'RFG RIDGE', description: 'Roofing - Ridge cap - composition' },
  hip_ridge: { selector: 'RFG HIPRDG', description: 'Roofing - Hip and ridge cap' },
  valley_metal: { selector: 'RFG VLYMTL', description: 'Roofing - Valley metal - aluminum' },
  step_flashing: { selector: 'RFG STPFLSH', description: 'Roofing - Step flashing' },
  pipe_boot: { selector: 'RFG PIPEBT', description: 'Roofing - Pipe boot/jack' },
  starter_strip: { selector: 'RFG STRTR', description: 'Roofing - Starter strip' },
  ventilation: { selector: 'RFG VENT', description: 'Roofing - Roof vent' },
  labor_steep: { selector: 'RFG STEEP', description: 'Roofing - Steep roof charge - per SQ' },
  labor_high: { selector: 'RFG HIGH', description: 'Roofing - High roof charge - per SQ' },
  dumpster: { selector: 'DMP ROLL', description: 'Dumpster - Roll off - per load' },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify user
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      throw new Error('Invalid authorization');
    }

    const { 
      measurement_id, 
      scope_document_id, 
      pipeline_entry_id,
      include_photos = false,
      export_format = 'esx'
    }: XactimateExportRequest = await req.json();

    let measurementData: any = null;
    let scopeData: any = null;
    let contactData: any = null;
    let propertyAddress: string = '';

    // Fetch measurement data
    if (measurement_id) {
      const { data } = await supabase
        .from('roof_measurements')
        .select('*')
        .eq('id', measurement_id)
        .single();
      measurementData = data;
      propertyAddress = data?.address || '';
    }

    // Fetch scope document if provided
    if (scope_document_id) {
      const { data } = await supabase
        .from('scope_documents')
        .select('*')
        .eq('id', scope_document_id)
        .single();
      scopeData = data;
    }

    // Fetch pipeline entry for contact/property info
    if (pipeline_entry_id) {
      const { data } = await supabase
        .from('pipeline_entries')
        .select(`
          *,
          contacts(first_name, last_name, email, phone, address_line_1, city, state, zip_code)
        `)
        .eq('id', pipeline_entry_id)
        .single();
      
      if (data?.contacts) {
        contactData = data.contacts;
        propertyAddress = `${contactData.address_line_1 || ''}, ${contactData.city || ''}, ${contactData.state || ''} ${contactData.zip_code || ''}`;
      }
    }

    // Generate line items from measurement data
    const lineItems: XactimateLineItem[] = [];
    
    if (measurementData) {
      const summary = measurementData.summary || {};
      const squares = summary.total_squares || (summary.total_area_sqft ? summary.total_area_sqft / 100 : 0);
      const ridgeLf = summary.ridge_length || summary.ridges_lf || 0;
      const hipLf = summary.hip_length || summary.hips_lf || 0;
      const valleyLf = summary.valley_length || summary.valleys_lf || 0;
      const eaveLf = summary.eave_length || summary.eaves_lf || 0;
      const rakeLf = summary.rake_length || summary.rakes_lf || 0;
      const pitch = summary.predominant_pitch || '6/12';

      // Tear-off (if replacing)
      lineItems.push({
        category: 'RFG',
        selector: XACTIMATE_CODES.shingles_remove.selector,
        description: XACTIMATE_CODES.shingles_remove.description,
        quantity: squares,
        unit: 'SQ',
      });

      // New shingles (architectural)
      lineItems.push({
        category: 'RFG',
        selector: XACTIMATE_CODES.shingles_arch.selector,
        description: XACTIMATE_CODES.shingles_arch.description,
        quantity: squares * 1.10, // 10% waste
        unit: 'SQ',
      });

      // Underlayment
      lineItems.push({
        category: 'RFG',
        selector: XACTIMATE_CODES.underlayment.selector,
        description: XACTIMATE_CODES.underlayment.description,
        quantity: squares,
        unit: 'SQ',
      });

      // Ice & water shield (valleys + first 3ft of eaves)
      const iceWaterSqft = (valleyLf * 3) + (eaveLf * 3);
      if (iceWaterSqft > 0) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.ice_water_shield.selector,
          description: XACTIMATE_CODES.ice_water_shield.description,
          quantity: Math.ceil(iceWaterSqft),
          unit: 'SF',
        });
      }

      // Drip edge
      const dripEdgeLf = eaveLf + rakeLf;
      if (dripEdgeLf > 0) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.drip_edge.selector,
          description: XACTIMATE_CODES.drip_edge.description,
          quantity: Math.ceil(dripEdgeLf),
          unit: 'LF',
        });
      }

      // Ridge cap
      if (ridgeLf > 0) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.ridge_cap.selector,
          description: XACTIMATE_CODES.ridge_cap.description,
          quantity: Math.ceil(ridgeLf),
          unit: 'LF',
        });
      }

      // Hip & ridge
      if (hipLf > 0) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.hip_ridge.selector,
          description: XACTIMATE_CODES.hip_ridge.description,
          quantity: Math.ceil(hipLf),
          unit: 'LF',
        });
      }

      // Valley metal
      if (valleyLf > 0) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.valley_metal.selector,
          description: XACTIMATE_CODES.valley_metal.description,
          quantity: Math.ceil(valleyLf),
          unit: 'LF',
        });
      }

      // Starter strip
      lineItems.push({
        category: 'RFG',
        selector: XACTIMATE_CODES.starter_strip.selector,
        description: XACTIMATE_CODES.starter_strip.description,
        quantity: Math.ceil(eaveLf + rakeLf),
        unit: 'LF',
      });

      // Steep pitch charge (if applicable)
      const pitchValue = parseInt(pitch.split('/')[0] || '6');
      if (pitchValue >= 7) {
        lineItems.push({
          category: 'RFG',
          selector: XACTIMATE_CODES.labor_steep.selector,
          description: XACTIMATE_CODES.labor_steep.description,
          quantity: squares,
          unit: 'SQ',
        });
      }

      // Dumpster
      const dumpsterLoads = Math.ceil(squares / 15); // ~15 squares per load
      lineItems.push({
        category: 'DMP',
        selector: XACTIMATE_CODES.dumpster.selector,
        description: XACTIMATE_CODES.dumpster.description,
        quantity: dumpsterLoads,
        unit: 'EA',
      });
    }

    // Generate export content based on format
    let exportContent: string;
    let contentType: string;
    let fileName: string;

    if (export_format === 'json') {
      exportContent = JSON.stringify({
        claim_info: {
          insured_name: contactData ? `${contactData.first_name} ${contactData.last_name}` : '',
          property_address: propertyAddress,
          claim_number: '', // To be filled by user
          date_of_loss: '', // To be filled by user
          export_date: new Date().toISOString(),
        },
        line_items: lineItems,
        measurement_source: measurementData?.source || 'ai_analysis',
        total_squares: measurementData?.summary?.total_squares || 0,
      }, null, 2);
      contentType = 'application/json';
      fileName = `xactimate-export-${Date.now()}.json`;
    } else if (export_format === 'xml') {
      // Generate XML format
      const xmlItems = lineItems.map(item => `
    <LineItem>
      <Category>${item.category}</Category>
      <Selector>${item.selector}</Selector>
      <Description>${item.description}</Description>
      <Quantity>${item.quantity.toFixed(2)}</Quantity>
      <Unit>${item.unit}</Unit>
    </LineItem>`).join('');

      exportContent = `<?xml version="1.0" encoding="UTF-8"?>
<XactimateExport>
  <ClaimInfo>
    <InsuredName>${contactData ? `${contactData.first_name} ${contactData.last_name}` : ''}</InsuredName>
    <PropertyAddress>${propertyAddress}</PropertyAddress>
    <ExportDate>${new Date().toISOString()}</ExportDate>
  </ClaimInfo>
  <LineItems>${xmlItems}
  </LineItems>
</XactimateExport>`;
      contentType = 'application/xml';
      fileName = `xactimate-export-${Date.now()}.xml`;
    } else {
      // Generate ESX format (simplified - actual ESX is proprietary)
      const esxLines = lineItems.map(item => 
        `${item.selector}\t${item.description}\t${item.quantity.toFixed(2)}\t${item.unit}`
      ).join('\n');

      exportContent = `# Xactimate ESX Export
# Property: ${propertyAddress}
# Date: ${new Date().toISOString()}
# Source: PITCH CRM AI Measurement

${esxLines}`;
      contentType = 'text/plain';
      fileName = `xactimate-export-${Date.now()}.esx`;
    }

    // Store export record
    await supabase.from('document_exports').insert({
      tenant_id: user.id,
      export_type: 'xactimate',
      format: export_format,
      source_measurement_id: measurement_id,
      source_scope_id: scope_document_id,
      pipeline_entry_id,
      file_name: fileName,
      line_items_count: lineItems.length,
      created_at: new Date().toISOString(),
    }).catch(err => console.error('Export log error (non-fatal):', err));

    return new Response(
      JSON.stringify({
        success: true,
        file_name: fileName,
        content_type: contentType,
        content: exportContent,
        line_items_count: lineItems.length,
      }),
      { 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
        } 
      }
    );

  } catch (error) {
    console.error('Xactimate export error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
