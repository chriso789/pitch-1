import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReportRequest {
  action: 'generate' | 'preview' | 'get_templates';
  tenant_id: string;
  job_id?: string;
  template?: 'standard' | 'before_after' | 'timeline' | 'damage';
  options?: {
    include_annotations?: boolean;
    include_metadata?: boolean;
    include_categories?: string[];
    date_range?: { start: string; end: string };
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: ReportRequest = await req.json();
    const { action, tenant_id, job_id, template = 'standard', options } = body;

    if (!action || !tenant_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing action or tenant_id' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    switch (action) {
      case 'generate': {
        if (!job_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'job_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get job/project details
        const { data: project, error: projError } = await supabaseAdmin
          .from('projects')
          .select(`
            id, name, address, created_at,
            contact:contact_id(first_name, last_name, email, phone)
          `)
          .eq('id', job_id)
          .single();

        if (projError || !project) {
          return new Response(
            JSON.stringify({ success: false, error: 'Project not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get photos for the project
        let photoQuery = supabaseAdmin
          .from('project_photos')
          .select('*')
          .eq('project_id', job_id)
          .order('created_at', { ascending: true });

        if (options?.include_categories?.length) {
          photoQuery = photoQuery.in('category', options.include_categories);
        }

        if (options?.date_range?.start && options?.date_range?.end) {
          photoQuery = photoQuery
            .gte('created_at', options.date_range.start)
            .lte('created_at', options.date_range.end);
        }

        const { data: photos } = await photoQuery;

        // Get tenant branding
        const { data: tenant } = await supabaseAdmin
          .from('tenants')
          .select('name, logo_url, primary_color, settings')
          .eq('id', tenant_id)
          .single();

        // Group photos by category for report
        const groupedPhotos: Record<string, unknown[]> = {};
        photos?.forEach(photo => {
          const category = photo.category || 'uncategorized';
          if (!groupedPhotos[category]) groupedPhotos[category] = [];
          groupedPhotos[category].push({
            id: photo.id,
            url: photo.file_url,
            caption: photo.caption,
            annotations: options?.include_annotations ? photo.annotations : undefined,
            metadata: options?.include_metadata ? {
              taken_at: photo.taken_at,
              location: photo.location,
              file_size: photo.file_size
            } : undefined
          });
        });

        // Generate report structure
        const report = {
          template,
          generated_at: new Date().toISOString(),
          project: {
            id: project.id,
            name: project.name,
            address: project.address,
            contact: project.contact
          },
          branding: {
            company_name: tenant?.name,
            logo_url: tenant?.logo_url,
            primary_color: tenant?.primary_color || '#2563eb'
          },
          sections: generateSections(template, groupedPhotos, photos?.length || 0),
          photo_count: photos?.length || 0,
          categories: Object.keys(groupedPhotos)
        };

        console.log(`[photo-report-generator] Generated ${template} report for job ${job_id} with ${photos?.length || 0} photos`);
        return new Response(
          JSON.stringify({ success: true, data: report }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'preview': {
        if (!job_id) {
          return new Response(
            JSON.stringify({ success: false, error: 'job_id required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get photo count and categories for preview
        const { data: photos } = await supabaseAdmin
          .from('project_photos')
          .select('id, category, file_url')
          .eq('project_id', job_id)
          .limit(10);

        const categories = [...new Set(photos?.map(p => p.category || 'uncategorized'))];
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            data: {
              total_photos: photos?.length || 0,
              categories,
              sample_photos: photos?.slice(0, 4).map(p => p.file_url),
              available_templates: ['standard', 'before_after', 'timeline', 'damage']
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_templates': {
        const templates = [
          {
            id: 'standard',
            name: 'Standard Photo Report',
            description: 'All photos organized by category with captions'
          },
          {
            id: 'before_after',
            name: 'Before & After Comparison',
            description: 'Side-by-side comparison of before and after photos'
          },
          {
            id: 'timeline',
            name: 'Project Timeline',
            description: 'Chronological view of project progress'
          },
          {
            id: 'damage',
            name: 'Damage Documentation',
            description: 'Focused on damage photos with detailed annotations'
          }
        ];

        return new Response(
          JSON.stringify({ success: true, data: templates }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }

  } catch (error) {
    console.error('[photo-report-generator] Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function generateSections(template: string, groupedPhotos: Record<string, unknown[]>, totalPhotos: number) {
  switch (template) {
    case 'before_after':
      return [
        { title: 'Before', photos: groupedPhotos['before'] || [] },
        { title: 'After', photos: groupedPhotos['after'] || [] }
      ];
    case 'timeline':
      return [
        { title: 'Project Timeline', photos: Object.values(groupedPhotos).flat(), layout: 'timeline' }
      ];
    case 'damage':
      return [
        { title: 'Damage Documentation', photos: groupedPhotos['damage'] || [], layout: 'detailed' }
      ];
    default:
      return Object.entries(groupedPhotos).map(([category, photos]) => ({
        title: category.charAt(0).toUpperCase() + category.slice(1),
        photos,
        layout: 'grid'
      }));
  }
}
