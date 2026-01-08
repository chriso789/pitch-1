import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GeneratePresentationRequest {
  pipeline_entry_id: string;
  template_id: string;
  mode: 'auto' | 'semi';
  presentation_name?: string;
}

interface SmartTagDefinition {
  tag_key: string;
  category: string;
  data_source: string;
  field_path: string;
  default_value?: string;
  format_type: string;
}

interface TagContext {
  contact?: Record<string, any>;
  tenant?: Record<string, any>;
  pipeline_entry?: Record<string, any>;
  estimate?: Record<string, any>;
  measurements?: Record<string, any>;
  line_items?: Record<string, any>[];
  photos?: Record<string, any>[];
  roofing?: Record<string, any>;
}

// Format value based on type
function formatValue(value: any, formatType: string): string {
  if (value === null || value === undefined) return '';
  
  switch (formatType) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { 
        style: 'currency', 
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(Number(value));
    case 'date':
      if (!value) return '';
      return new Date(value).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    case 'number':
      return new Intl.NumberFormat('en-US').format(Number(value));
    default:
      return String(value);
  }
}

// Resolve tag value
function resolveTagValue(tagKey: string, context: TagContext, tagDefs: SmartTagDefinition[]): string {
  if (tagKey === 'today') {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  
  const tagDef = tagDefs.find(t => t.tag_key === tagKey);
  if (!tagDef) return `{{${tagKey}}}`;
  
  const sourceMap: Record<string, keyof TagContext> = {
    'contacts': 'contact',
    'tenants': 'tenant',
    'pipeline_entries': 'pipeline_entry',
    'estimates': 'estimate',
    'measurements': 'measurements'
  };
  
  const sourceKey = sourceMap[tagDef.data_source];
  const sourceData = context[sourceKey];
  if (!sourceData) return tagDef.default_value || '';
  
  let value: any;
  if (tagDef.field_path.includes('||')) {
    const parts = tagDef.field_path.split('||').map(p => p.trim());
    value = parts.map(part => {
      if (part.startsWith("'") && part.endsWith("'")) return part.slice(1, -1);
      return sourceData[part] || '';
    }).join('');
  } else {
    value = sourceData[tagDef.field_path];
  }
  
  return value !== null && value !== undefined ? formatValue(value, tagDef.format_type) : (tagDef.default_value || '');
}

// Replace all tags in content
function replaceAllTags(content: string, context: TagContext, tagDefs: SmartTagDefinition[]): string {
  return content.replace(/\{\{([^}]+)\}\}/g, (match, tagKey) => {
    const resolved = resolveTagValue(tagKey.trim(), context, tagDefs);
    return resolved || match;
  });
}

// Replace tags in object recursively
function replaceTagsInObject(obj: any, context: TagContext, tagDefs: SmartTagDefinition[]): any {
  if (typeof obj === 'string') return replaceAllTags(obj, context, tagDefs);
  if (Array.isArray(obj)) return obj.map(item => replaceTagsInObject(item, context, tagDefs));
  if (typeof obj === 'object' && obj !== null) {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = replaceTagsInObject(value, context, tagDefs);
    }
    return result;
  }
  return obj;
}

// Build roofing-specific system prompt
function buildRoofingSystemPrompt(context: TagContext): string {
  const tenant = context.tenant || {};
  const contact = context.contact || {};
  const measurements = context.measurements || {};
  const estimate = context.estimate || {};
  
  return `You are a professional roofing sales presentation writer for ${tenant.name || 'our company'}.

Company Details:
- Name: ${tenant.name || 'Roofing Company'}
- License: ${tenant.license_number || 'Licensed & Insured'}
- Phone: ${tenant.phone || ''}
- Email: ${tenant.email || ''}
- Website: ${tenant.website || ''}
- About: ${tenant.about_us || ''}

Project Details:
- Customer: ${contact.first_name || ''} ${contact.last_name || ''}
- Property: ${contact.address_line1 || ''}, ${contact.city || ''}, ${contact.state || ''}
- Roof Area: ${measurements.summary?.total_area || 'TBD'} sq ft
- Roof Pitch: ${measurements.summary?.predominant_pitch || 'TBD'}
- Estimate Total: ${estimate.selling_price ? '$' + Number(estimate.selling_price).toLocaleString() : 'TBD'}

Write compelling, professional content that:
1. Emphasizes quality workmanship and materials
2. Highlights the company's experience and licensing
3. Builds trust with clear warranty information
4. Uses specific project details when available
5. Maintains a professional but friendly tone
6. Is concise and to the point`;
}

// Format material list from line items
function formatMaterialList(lineItems: Record<string, any>[] | undefined): string {
  if (!lineItems || lineItems.length === 0) return 'Materials to be determined';
  
  return lineItems
    .filter(item => item.item_type === 'material' || item.category === 'Materials')
    .map(item => `• ${item.name || item.description}: ${item.quantity || 1} ${item.unit || 'units'}`)
    .join('\n');
}

// Call AI to generate content using Lovable AI Gateway
async function generateAIContent(prompt: string, context: TagContext, tagDefs: SmartTagDefinition[]): Promise<string> {
  const filledPrompt = replaceAllTags(prompt, context, tagDefs);
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  
  if (!LOVABLE_API_KEY) {
    console.error('LOVABLE_API_KEY not configured');
    return '';
  }
  
  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: buildRoofingSystemPrompt(context)
          },
          { role: 'user', content: filledPrompt }
        ],
        max_tokens: 800,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Lovable AI Gateway error:', response.status, errorText);
      return '';
    }
    
    const data = await response.json();
    return data.choices?.[0]?.message?.content || '';
  } catch (error) {
    console.error('AI generation error:', error);
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get auth user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    const { pipeline_entry_id, template_id, mode, presentation_name } = await req.json() as GeneratePresentationRequest;
    
    console.log(`Generating presentation for pipeline_entry: ${pipeline_entry_id}, template: ${template_id}, mode: ${mode}`);
    
    // Get user's tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', user.id)
      .single();
    
    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), { 
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Fetch all required data in parallel
    const [
      { data: pipelineEntry },
      { data: tenant },
      { data: tagDefinitions },
      { data: templateSlides },
      { data: template }
    ] = await Promise.all([
      supabase.from('pipeline_entries').select('*, contacts(*)').eq('id', pipeline_entry_id).single(),
      supabase.from('tenants').select('*').eq('id', profile.tenant_id).single(),
      supabase.from('smart_tag_definitions').select('*'),
      supabase.from('presentation_template_slides').select('*').eq('template_id', template_id).order('slide_order'),
      supabase.from('presentation_templates').select('*').eq('id', template_id).single()
    ]);
    
    if (!pipelineEntry || !template || !templateSlides?.length) {
      return new Response(JSON.stringify({ error: 'Required data not found' }), { 
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Get estimate if exists
    const { data: estimate } = await supabase
      .from('estimates')
      .select('*')
      .eq('pipeline_entry_id', pipeline_entry_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Get measurements if exists
    const { data: measurements } = await supabase
      .from('measurements')
      .select('*')
      .eq('pipeline_entry_id', pipeline_entry_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Get estimate line items if estimate exists
    let lineItems: any[] = [];
    if (estimate?.id) {
      const { data: items } = await supabase
        .from('estimate_line_items')
        .select('*')
        .eq('estimate_id', estimate.id)
        .order('sort_order');
      lineItems = items || [];
    }
    
    // Get project photos
    let projectPhotos: any[] = [];
    if (pipelineEntry.project_id) {
      const { data: photos } = await supabase
        .from('project_photos')
        .select('*')
        .eq('project_id', pipelineEntry.project_id)
        .order('created_at', { ascending: false })
        .limit(10);
      projectPhotos = photos || [];
    }
    
    // Build full company address
    const fullAddress = [
      tenant?.address_street,
      tenant?.address_city,
      tenant?.address_state,
      tenant?.address_zip
    ].filter(Boolean).join(', ');
    
    // Build context for tag replacement with enhanced data
    const context: TagContext = {
      contact: pipelineEntry.contacts,
      tenant: {
        ...tenant,
        full_address: fullAddress,
      },
      pipeline_entry: pipelineEntry,
      estimate: estimate || undefined,
      measurements: measurements || undefined,
      line_items: lineItems,
      photos: projectPhotos,
      roofing: {
        total_area: measurements?.summary?.total_area,
        primary_pitch: measurements?.summary?.predominant_pitch,
        material_list: formatMaterialList(lineItems),
        warranty_years: estimate?.parameters?.warranty_years || '25',
      },
    };
    
    const tagDefs = tagDefinitions as SmartTagDefinition[] || [];
    
    // Create presentation record
    const presentationName = presentation_name || 
      `${pipelineEntry.contacts?.first_name || 'New'} ${pipelineEntry.contacts?.last_name || 'Client'} - ${template.name}`;
    
    const { data: presentation, error: createError } = await supabase
      .from('presentations')
      .insert({
        tenant_id: profile.tenant_id,
        name: presentationName,
        description: `Generated from ${template.name}`,
        template_type: template.vertical,
        is_template: false,
        created_by: user.id,
        source_template_id: template_id,
        pipeline_entry_id: pipeline_entry_id,
        generation_mode: mode,
        generation_status: 'generating'
      })
      .select()
      .single();
    
    if (createError || !presentation) {
      console.error('Error creating presentation:', createError);
      return new Response(JSON.stringify({ error: 'Failed to create presentation' }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    // Generate slides
    const generatedSlides: any[] = [];
    const missingData: string[] = [];
    
    for (let i = 0; i < templateSlides.length; i++) {
      const templateSlide = templateSlides[i];
      
      // Update status
      await supabase
        .from('presentations')
        .update({ generation_status: `generating_slide_${i + 1}` })
        .eq('id', presentation.id);
      
      // Process content template
      let content = replaceTagsInObject(templateSlide.content_template, context, tagDefs);
      
      // Generate AI content if needed and mode is auto
      if (mode === 'auto' && templateSlide.ai_prompt) {
        const aiContent = await generateAIContent(templateSlide.ai_prompt, context, tagDefs);
        if (aiContent) {
          // Replace ai_generated placeholders or add to content
          if (typeof content === 'object' && content.content === '{{ai_generated_scope}}') {
            content.content = aiContent;
          } else if (typeof content === 'object') {
            content.ai_content = aiContent;
          }
        }
      }
      
      // Check for missing tags
      const contentStr = JSON.stringify(content);
      const unresolved = contentStr.match(/\{\{[^}]+\}\}/g) || [];
      unresolved.forEach(tag => {
        const tagKey = tag.replace(/[{}]/g, '');
        if (!missingData.includes(tagKey)) {
          missingData.push(tagKey);
        }
      });
      
      // Create slide with correct column names matching presentation_slides table
      const slideData = {
        presentation_id: presentation.id,
        slide_type: templateSlide.slide_type,
        slide_order: templateSlide.slide_order,
        content: {
          ...content,
          title: replaceAllTags(templateSlide.title || '', context, tagDefs),
          media_type: templateSlide.media_type,
          media_source: templateSlide.media_source,
          is_required: templateSlide.is_required
        },
        transition_effect: 'fade'
      };
      
      generatedSlides.push(slideData);
    }
    
    // Insert all slides
    const { data: insertedSlides, error: slidesError } = await supabase
      .from('presentation_slides')
      .insert(generatedSlides)
      .select();
    
    if (slidesError) {
      console.error('Error creating slides:', slidesError);
      // Update presentation with error status
      await supabase
        .from('presentations')
        .update({ 
          generation_status: 'error',
          missing_data: [`Slide creation failed: ${slidesError.message}`]
        })
        .eq('id', presentation.id);
        
      return new Response(JSON.stringify({ 
        success: false, 
        error: `Failed to create slides: ${slidesError.message}` 
      }), { 
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
    console.log(`Successfully inserted ${insertedSlides?.length || 0} slides for presentation ${presentation.id}`);
    
    // Update presentation status
    await supabase
      .from('presentations')
      .update({ 
        generation_status: 'completed',
        missing_data: missingData
      })
      .eq('id', presentation.id);
    
    console.log(`Presentation ${presentation.id} generated with ${generatedSlides.length} slides`);
    
    return new Response(JSON.stringify({ 
      success: true,
      presentation_id: presentation.id,
      slides_count: generatedSlides.length,
      missing_data: missingData,
      mode
    }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
    
  } catch (error) {
    console.error('Error in generate-presentation:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
