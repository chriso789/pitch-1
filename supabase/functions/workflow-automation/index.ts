import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    
    const supabase = createClient(supabaseUrl, serviceKey);

    // Fetch active tasks
    const { data: tasks, error: tasksError } = await supabase
      .from('workflow_tasks')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (tasksError) throw tasksError;

    const results = [];

    for (const task of tasks || []) {
      console.log(`Processing task: ${task.task_name} (Phase: ${task.current_phase})`);

      // Determine next action using AI
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
              content: `You are an autonomous workflow automation AI. Analyze the current phase and determine the next action.
              
Available phases: planning, implementation, testing, deployment, monitoring, optimization

Your response must be a JSON object with:
{
  "should_progress": boolean,
  "next_phase": "phase_name" or null,
  "reasoning": "explanation of decision",
  "actions_taken": ["action1", "action2"],
  "completion_percentage": number (0-100)
}`
            },
            {
              role: 'user',
              content: `Task: ${task.task_name}
Description: ${task.description || 'N/A'}
Current Phase: ${task.current_phase}
Context: ${JSON.stringify(task.ai_context)}
Completion Criteria: ${JSON.stringify(task.completion_criteria)}

Determine if this task should progress to the next phase and what actions should be taken.`
            }
          ]
        })
      });

      if (!aiResponse.ok) {
        console.error('AI gateway error:', await aiResponse.text());
        continue;
      }

      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content;
      
      if (!content) {
        console.error('No AI response content');
        continue;
      }

      // Parse AI decision
      let decision;
      try {
        decision = JSON.parse(content);
      } catch (e) {
        console.error('Failed to parse AI response:', content);
        continue;
      }

      // Log to history
      await supabase
        .from('workflow_phase_history')
        .insert({
          tenant_id: task.tenant_id,
          task_id: task.id,
          from_phase: task.current_phase,
          to_phase: decision.next_phase || task.current_phase,
          ai_reasoning: decision.reasoning,
          actions_taken: decision.actions_taken || []
        });

      // Update task if progression needed
      if (decision.should_progress && decision.next_phase) {
        await supabase
          .from('workflow_tasks')
          .update({
            current_phase: decision.next_phase,
            ai_context: {
              ...task.ai_context,
              last_ai_update: new Date().toISOString(),
              completion_percentage: decision.completion_percentage
            },
            updated_at: new Date().toISOString()
          })
          .eq('id', task.id);

        console.log(`✅ Task ${task.task_name} progressed: ${task.current_phase} → ${decision.next_phase}`);
      }

      results.push({
        task_id: task.id,
        task_name: task.task_name,
        progressed: decision.should_progress,
        from_phase: task.current_phase,
        to_phase: decision.next_phase,
        reasoning: decision.reasoning
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        tasks_processed: tasks?.length || 0,
        results
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error: any) {
    console.error('Workflow automation error:', error);
    
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