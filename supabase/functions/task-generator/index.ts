import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TaskGeneratorRequest {
  input_text: string;
  context?: {
    contact_id?: string;
    pipeline_entry_id?: string;
    project_id?: string;
  };
  source_type: 'voice_note' | 'text_input' | 'meeting_notes' | 'call_summary';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { 
      input_text, 
      context = {}, 
      source_type 
    }: TaskGeneratorRequest = await req.json();
    
    if (!input_text) {
      throw new Error('Input text is required');
    }

    console.log('Generating tasks from:', source_type, 'with text:', input_text.substring(0, 100));

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user context
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('Authorization header required');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('User authentication failed');
    }

    const tenantId = user.user_metadata?.tenant_id;

    // Get context data if available
    let contextInfo = '';
    if (context.contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('first_name, last_name, phone, email')
        .eq('id', context.contact_id)
        .single();
      
      if (contact) {
        contextInfo += `Contact: ${contact.first_name} ${contact.last_name} (${contact.phone})`;
      }
    }

    if (context.pipeline_entry_id) {
      const { data: pipeline } = await supabase
        .from('pipeline_entries')
        .select('status, estimated_value, roof_type')
        .eq('id', context.pipeline_entry_id)
        .single();
      
      if (pipeline) {
        contextInfo += ` Pipeline: ${pipeline.status}, $${pipeline.estimated_value}, ${pipeline.roof_type}`;
      }
    }

    // Create system prompt for task extraction
    const systemPrompt = `You are an AI assistant that extracts actionable tasks from sales conversations and notes for a roofing company.

    Context: ${contextInfo}
    Source: ${source_type}

    Extract specific, actionable tasks from the following text. Look for:
    - Follow-up calls or meetings
    - Estimates to create or send
    - Inspections to schedule
    - Materials to order
    - Permits to obtain
    - Photos to take
    - Documents to prepare
    - Client communications needed

    For each task, determine:
    - Priority (urgent/high/medium/low)
    - Due date (if mentioned or can be inferred)
    - Assignee (if mentioned)
    - Dependencies

    Return JSON format:
    {
      "tasks": [
        {
          "title": "Clear, actionable task title",
          "description": "Detailed description with context",
          "priority": "urgent|high|medium|low",
          "due_date": "YYYY-MM-DD HH:MM:SS" or null,
          "estimated_duration_minutes": number or null,
          "task_type": "call|meeting|estimate|inspection|follow_up|admin|material|other",
          "dependencies": ["other task titles"] or []
        }
      ],
      "communication_summary": "Brief summary of the conversation/notes",
      "next_best_action": "Recommended immediate next step",
      "urgency_flags": ["any urgent items that need immediate attention"]
    }

    If no clear tasks are found, return an empty tasks array but still provide the summary.`;

    // Call OpenAI for task extraction
    const openAIResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: input_text }
        ],
        temperature: 0.3,
        max_tokens: 1500
      }),
    });

    if (!openAIResponse.ok) {
      throw new Error('Failed to extract tasks with AI');
    }

    const aiResult = await openAIResponse.json();
    const extractedData = JSON.parse(aiResult.choices[0].message.content);

    console.log('Extracted tasks:', extractedData.tasks.length);

    // Create tasks in database
    const createdTasks = [];
    for (const taskData of extractedData.tasks) {
      try {
        // Parse due date if provided
        let dueDate = null;
        if (taskData.due_date) {
          dueDate = new Date(taskData.due_date).toISOString();
        }

        const { data: task, error } = await supabase
          .from('tasks')
          .insert({
            tenant_id: tenantId,
            title: taskData.title,
            description: taskData.description,
            priority: taskData.priority,
            due_date: dueDate,
            assigned_to: user.id, // Default to current user
            contact_id: context.contact_id || null,
            pipeline_entry_id: context.pipeline_entry_id || null,
            project_id: context.project_id || null,
            ai_generated: true,
            ai_context: {
              source_type,
              original_text: input_text.substring(0, 500),
              task_type: taskData.task_type,
              estimated_duration_minutes: taskData.estimated_duration_minutes,
              dependencies: taskData.dependencies
            },
            created_by: user.id
          })
          .select()
          .single();

        if (error) {
          console.error('Error creating task:', error);
        } else {
          createdTasks.push(task);
        }
      } catch (error) {
        console.error('Error processing task:', error);
      }
    }

    // Log the communication that generated these tasks
    try {
      await supabase.from('communication_history').insert({
        tenant_id: tenantId,
        contact_id: context.contact_id || null,
        pipeline_entry_id: context.pipeline_entry_id || null,
        project_id: context.project_id || null,
        rep_id: user.id,
        communication_type: source_type,
        direction: 'inbound',
        content: input_text,
        ai_insights: {
          tasks_generated: createdTasks.length,
          communication_summary: extractedData.communication_summary,
          next_best_action: extractedData.next_best_action,
          urgency_flags: extractedData.urgency_flags
        }
      });
    } catch (error) {
      console.error('Failed to log communication:', error);
    }

    return new Response(
      JSON.stringify({
        ...extractedData,
        created_tasks: createdTasks,
        tasks_created_count: createdTasks.length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in task-generator:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});