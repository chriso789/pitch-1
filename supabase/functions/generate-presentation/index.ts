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

// Call AI to generate content
async function generateAIContent(prompt: string, context: TagContext, tagDefs: SmartTagDefinition[]): Promise<string> {
  const filledPrompt = replaceAllTags(prompt, context, tagDefs);
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are a professional sales proposal writer for contractors. Write compelling, clear, and professional content. Be concise but persuasive.'
          },
          { role: 'user', content: filledPrompt }
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    });
    
    if (!response.ok) {
      console.error('OpenAI API error:', await response.text());
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
    
    // Build context for tag replacement
    const context: TagContext = {
      contact: pipelineEntry.contacts,
      tenant: tenant,
      pipeline_entry: pipelineEntry,
      estimate: estimate || undefined,
      measurements: measurements || undefined
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
      
      // Create slide
      const slideData = {
        presentation_id: presentation.id,
        slide_type: templateSlide.slide_type,
        title: replaceAllTags(templateSlide.title || '', context, tagDefs),
        content: content,
        order_index: templateSlide.slide_order,
        settings: {
          media_type: templateSlide.media_type,
          media_source: templateSlide.media_source,
          is_required: templateSlide.is_required
        }
      };
      
      generatedSlides.push(slideData);
    }
    
    // Insert all slides
    const { error: slidesError } = await supabase
      .from('presentation_slides')
      .insert(generatedSlides);
    
    if (slidesError) {
      console.error('Error creating slides:', slidesError);
    }
    
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
