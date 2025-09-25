import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { corsHeaders } from '../_shared/cors.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;

interface LeadScoringRequest {
  contact_id?: string;
  contact_data?: any;
  bulk_score?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from request
    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's profile and tenant
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(JSON.stringify({ error: 'No tenant found' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { contact_id, contact_data, bulk_score } = await req.json() as LeadScoringRequest;

    if (bulk_score) {
      // Bulk scoring for all contacts
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_deleted', false)
        .is('lead_score', null);

      if (contactsError) {
        throw new Error(`Failed to fetch contacts: ${contactsError.message}`);
      }

      const scoredContacts = [];
      
      for (const contact of contacts || []) {
        const score = await calculateAILeadScore(contact, profile.tenant_id);
        
        // Update contact with new score
        await supabase
          .from('contacts')
          .update({
            lead_score: score.score,
            qualification_status: score.qualification_status,
            scoring_details: score.details,
            last_scored_at: new Date().toISOString()
          })
          .eq('id', contact.id)
          .eq('tenant_id', profile.tenant_id);

        scoredContacts.push({ contact_id: contact.id, score: score.score });
      }

      return new Response(JSON.stringify({
        success: true,
        scored_contacts: scoredContacts.length,
        results: scoredContacts
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Single contact scoring
    let contact;
    if (contact_id) {
      const { data: contactData, error: contactError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contact_id)
        .eq('tenant_id', profile.tenant_id)
        .single();

      if (contactError || !contactData) {
        return new Response(JSON.stringify({ error: 'Contact not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      contact = contactData;
    } else if (contact_data) {
      contact = contact_data;
    } else {
      return new Response(JSON.stringify({ error: 'Contact ID or contact data required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const score = await calculateAILeadScore(contact, profile.tenant_id);

    // Update contact if we have an ID
    if (contact_id) {
      await supabase
        .from('contacts')
        .update({
          lead_score: score.score,
          qualification_status: score.qualification_status,
          scoring_details: score.details,
          last_scored_at: new Date().toISOString()
        })
        .eq('id', contact_id)
        .eq('tenant_id', profile.tenant_id);

      // Log scoring history
      await supabase
        .from('lead_scoring_history')
        .insert({
          tenant_id: profile.tenant_id,
          contact_id: contact_id,
          previous_score: contact.lead_score || 0,
          new_score: score.score,
          score_change: score.score - (contact.lead_score || 0),
          scoring_method: 'ai_enhanced',
          scored_by: user.id,
          scoring_details: score.details
        });
    }

    return new Response(JSON.stringify({
      success: true,
      contact_id: contact_id,
      score: score.score,
      qualification_status: score.qualification_status,
      details: score.details,
      recommendations: score.recommendations
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in ai-lead-scorer:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateAILeadScore(contact: any, tenantId: string): Promise<{
  score: number;
  qualification_status: string;
  details: any;
  recommendations: string[];
}> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Get scoring rules from database
  const { data: rules } = await supabase
    .from('lead_scoring_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  // Calculate base score using traditional rules
  let baseScore = 0;
  const appliedRules = [];

  for (const rule of rules || []) {
    const fieldValue = contact[rule.field_name] || contact.metadata?.[rule.field_name];
    let conditionMet = false;

    switch (rule.condition_type) {
      case 'equals':
        conditionMet = fieldValue === rule.condition_value.value;
        break;
      case 'contains':
        conditionMet = fieldValue?.toString().toLowerCase().includes(rule.condition_value.value.toLowerCase());
        break;
      case 'greater_than':
        conditionMet = parseFloat(fieldValue) > parseFloat(rule.condition_value.value);
        break;
      case 'less_than':
        conditionMet = parseFloat(fieldValue) < parseFloat(rule.condition_value.value);
        break;
      case 'range':
        const value = parseFloat(fieldValue);
        conditionMet = value >= parseFloat(rule.condition_value.min) && value <= parseFloat(rule.condition_value.max);
        break;
    }

    if (conditionMet) {
      baseScore += rule.points;
      appliedRules.push({
        rule_name: rule.rule_name,
        points: rule.points,
        field: rule.field_name,
        value: fieldValue
      });
    }
  }

  // Enhanced AI scoring using OpenAI
  const aiPrompt = `
    Analyze this lead and provide an enhanced lead score from 0-100.
    
    Contact Information:
    - Name: ${contact.first_name} ${contact.last_name}
    - Email: ${contact.email}
    - Phone: ${contact.phone}
    - Address: ${contact.address_street}, ${contact.address_city}, ${contact.address_state}
    - Lead Source: ${contact.lead_source}
    - Metadata: ${JSON.stringify(contact.metadata || {})}
    
    Current Base Score: ${baseScore}
    Applied Rules: ${JSON.stringify(appliedRules)}
    
    Consider these factors:
    1. Urgency indicators in communications
    2. Property value and location quality
    3. Lead source quality and conversion rates
    4. Demographic and behavioral signals
    5. Seasonal timing and market conditions
    
    Respond with a JSON object containing:
    {
      "enhanced_score": number (0-100),
      "confidence": number (0-1),
      "key_factors": [array of strings],
      "red_flags": [array of potential concerns],
      "recommendations": [array of action items],
      "qualification_status": "hot_lead" | "warm_lead" | "cold_lead" | "unqualified"
    }
  `;

  try {
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: 'You are an expert lead scoring analyst for a roofing company. Provide accurate, data-driven lead assessments.'
          },
          {
            role: 'user',
            content: aiPrompt
          }
        ],
        temperature: 0.3,
        max_tokens: 1000
      }),
    });

    const aiResult = await aiResponse.json();
    const aiAnalysis = JSON.parse(aiResult.choices[0].message.content);

    // Combine base score with AI enhancement
    const finalScore = Math.min(100, Math.max(0, 
      Math.round((baseScore * 0.6) + (aiAnalysis.enhanced_score * 0.4))
    ));

    return {
      score: finalScore,
      qualification_status: aiAnalysis.qualification_status,
      details: {
        base_score: baseScore,
        ai_enhanced_score: aiAnalysis.enhanced_score,
        applied_rules: appliedRules,
        ai_confidence: aiAnalysis.confidence,
        key_factors: aiAnalysis.key_factors,
        red_flags: aiAnalysis.red_flags,
        scoring_timestamp: new Date().toISOString()
      },
      recommendations: aiAnalysis.recommendations
    };

  } catch (error) {
    console.error('AI scoring failed, using base score:', error);
    
    // Fallback to base score if AI fails
    let qualificationStatus = 'unqualified';
    if (baseScore >= 80) qualificationStatus = 'hot_lead';
    else if (baseScore >= 60) qualificationStatus = 'warm_lead';
    else if (baseScore >= 40) qualificationStatus = 'cold_lead';

    return {
      score: baseScore,
      qualification_status: qualificationStatus,
      details: {
        base_score: baseScore,
        applied_rules: appliedRules,
        ai_fallback: true,
        scoring_timestamp: new Date().toISOString()
      },
      recommendations: ['Follow up based on lead score', 'Review contact details for accuracy']
    };
  }
}