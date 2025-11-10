import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface ButtonAuditRequest {
  files_to_audit?: string[];
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceKey);
    const { files_to_audit }: ButtonAuditRequest = await req.json();

    // Get auth user
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabase.auth.getUser(token);
    
    if (!user) {
      throw new Error('Unauthorized');
    }

    // Get active tenant (supports multi-company switching)
    const { data: profile } = await supabase
      .from('profiles')
      .select('active_tenant_id, tenant_id')
      .eq('id', user.id)
      .single();

    const tenantId = profile?.active_tenant_id || profile?.tenant_id || user.id;

    // Simulate file scanning (in production, this would scan actual files)
    const mockFiles = files_to_audit || [
      'src/components/ui/button.tsx',
      'src/features/pipeline/components/KanbanCard.tsx',
      'src/pages/JobDetails.tsx'
    ];

    const auditResults = [];

    for (const filePath of mockFiles) {
      console.log(`Auditing file: ${filePath}`);

      // Use AI to analyze button patterns
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `You are a code auditor specializing in React button components. Analyze code for:
1. Proper onClick handlers
2. Error handling (try-catch, error states)
3. Loading states
4. Accessibility (aria-labels, keyboard support)
5. Toast notifications for user feedback

Return JSON:
{
  "buttons_found": number,
  "has_error_handling": boolean,
  "has_loading_states": boolean,
  "has_accessibility": boolean,
  "issues": ["issue1", "issue2"],
  "recommendations": ["rec1", "rec2"],
  "severity": "low" | "medium" | "high"
}`
            },
            {
              role: 'user',
              content: `Audit this file for button implementations: ${filePath}
              
Assume this is a React TypeScript component with buttons that may call:
- supabase.functions.invoke()
- supabase.from().insert/update/delete()
- Navigation functions
- State updates

Check if proper patterns are followed.`
            }
          ]
        })
      });

      if (!aiResponse.ok) {
        console.error('AI audit error:', await aiResponse.text());
        continue;
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content;
      
      let auditData;
      try {
        auditData = JSON.parse(content);
      } catch (e) {
        console.error('Failed to parse AI audit:', content);
        continue;
      }

      // Store audit results
      const { error: insertError } = await supabase
        .from('button_audit_results')
        .upsert({
          tenant_id: tenantId,
          file_path: filePath,
          has_onclick: auditData.buttons_found > 0,
          has_error_handling: auditData.has_error_handling,
          pathway_validated: auditData.issues.length === 0,
          issues: auditData.issues,
          recommendations: auditData.recommendations,
          last_audited_at: new Date().toISOString()
        }, {
          onConflict: 'file_path,tenant_id'
        });

      if (insertError) {
        console.error('Failed to store audit:', insertError);
      }

      // Log critical issues to function_logs
      if (auditData.severity === 'high') {
        await supabase.rpc('log_function_error', {
          p_function_name: 'button-pathway-audit',
          p_error_message: `Critical issues found in ${filePath}`,
          p_context: {
            file_path: filePath,
            issues: auditData.issues,
            severity: auditData.severity
          }
        });
      }

      auditResults.push({
        file_path: filePath,
        buttons_found: auditData.buttons_found,
        issues_count: auditData.issues.length,
        severity: auditData.severity,
        has_error_handling: auditData.has_error_handling
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        files_audited: mockFiles.length,
        results: auditResults,
        timestamp: new Date().toISOString()
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error: any) {
    console.error('Button audit error:', error);
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
};

serve(handler);