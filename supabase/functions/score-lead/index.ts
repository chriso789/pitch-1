import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadScoringRequest {
  contactId: string;
  contactData?: any;
  recalculateAll?: boolean;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    const { contactId, contactData, recalculateAll = false }: LeadScoringRequest = await req.json();

    console.log('Processing lead scoring request:', { contactId, recalculateAll });

    if (recalculateAll) {
      // Recalculate scores for all leads
      const { data: contacts, error: contactsError } = await supabase
        .from('contacts')
        .select('*');

      if (contactsError) {
        throw new Error(`Failed to fetch contacts: ${contactsError.message}`);
      }

      const results = [];
      
      for (const contact of contacts) {
        const score = await calculateLeadScore(supabase, contact, contact.tenant_id);
        
        // Update contact score
        const { error: updateError } = await supabase
          .from('contacts')
          .update({
            lead_score: score.total_score,
            last_scored_at: new Date().toISOString(),
            scoring_details: score.scoring_details,
            qualification_status: await determineQualificationStatus(supabase, score.total_score, contact.tenant_id)
          })
          .eq('id', contact.id);

        if (updateError) {
          console.error(`Failed to update contact ${contact.id}:`, updateError);
        } else {
          results.push({
            contactId: contact.id,
            oldScore: contact.lead_score || 0,
            newScore: score.total_score,
            scoringDetails: score.scoring_details
          });
        }
      }

      return new Response(JSON.stringify({ 
        success: true, 
        message: `Recalculated scores for ${results.length} contacts`,
        results 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } else {
      // Score specific contact
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('*')
        .eq('id', contactId)
        .maybeSingle();

      if (contactError || !contact) {
        throw new Error(`Contact not found: ${contactId}`);
      }

      // Use provided contactData or existing contact data
      const dataToScore = contactData || contact;
      const score = await calculateLeadScore(supabase, dataToScore, contact.tenant_id);

      // Record score change in history
      if (contact.lead_score !== score.total_score) {
        await supabase
          .from('lead_scoring_history')
          .insert({
            tenant_id: contact.tenant_id,
            contact_id: contact.id,
            old_score: contact.lead_score || 0,
            new_score: score.total_score,
            score_change: score.total_score - (contact.lead_score || 0),
            reason: 'Automatic scoring',
            scoring_details: score.scoring_details
          });
      }

      // Update contact score and qualification status
      const qualificationStatus = await determineQualificationStatus(supabase, score.total_score, contact.tenant_id);
      
      const { error: updateError } = await supabase
        .from('contacts')
        .update({
          lead_score: score.total_score,
          last_scored_at: new Date().toISOString(),
          scoring_details: score.scoring_details,
          qualification_status: qualificationStatus
        })
        .eq('id', contactId);

      if (updateError) {
        throw updateError;
      }

      return new Response(JSON.stringify({ 
        success: true,
        contactId,
        oldScore: contact.lead_score || 0,
        newScore: score.total_score,
        qualificationStatus,
        scoringDetails: score.scoring_details
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

  } catch (error) {
    console.error('Error in score-lead function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : String(error) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function calculateLeadScore(supabase: any, contactData: any, tenantId: string) {
  // Get all active scoring rules for the tenant
  const { data: rules, error } = await supabase
    .from('lead_scoring_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to fetch scoring rules: ${error.message}`);
  }

  let totalScore = 0;
  const scoringDetails: any = {
    appliedRules: [],
    totalRules: rules.length,
    calculatedAt: new Date().toISOString()
  };

  for (const rule of rules) {
    const fieldValue = getFieldValue(contactData, rule.field_name);
    const conditionMet = evaluateCondition(fieldValue, rule.condition_type, rule.condition_value);
    
    if (conditionMet) {
      totalScore += rule.points;
      scoringDetails.appliedRules.push({
        ruleName: rule.rule_name,
        ruleType: rule.rule_type,
        fieldName: rule.field_name,
        fieldValue: fieldValue,
        condition: `${rule.condition_type}: ${JSON.stringify(rule.condition_value)}`,
        points: rule.points
      });
    }
  }

  // Ensure score is within bounds (0-100)
  totalScore = Math.max(0, Math.min(100, totalScore));
  scoringDetails.finalScore = totalScore;

  return {
    total_score: totalScore,
    scoring_details: scoringDetails
  };
}

function getFieldValue(contactData: any, fieldName: string): string | null {
  // Handle nested field access (e.g., 'lead_source_details.campaign')
  const fields = fieldName.split('.');
  let value = contactData;
  
  for (const field of fields) {
    value = value?.[field];
  }
  
  return value?.toString() || null;
}

function evaluateCondition(fieldValue: string | null, conditionType: string, conditionValue: any): boolean {
  if (!fieldValue && conditionType !== 'equals') return false;
  
  try {
    switch (conditionType) {
      case 'equals':
        return fieldValue === conditionValue.value;
      
      case 'contains':
        return fieldValue?.toLowerCase().includes(conditionValue.value?.toLowerCase()) || false;
      
      case 'greater_than':
        return parseFloat(fieldValue || '0') > parseFloat(conditionValue.value || '0');
      
      case 'less_than':
        return parseFloat(fieldValue || '0') < parseFloat(conditionValue.value || '0');
      
      case 'range':
        const numValue = parseFloat(fieldValue || '0');
        const min = parseFloat(conditionValue.min || '0');
        const max = parseFloat(conditionValue.max || '100');
        return numValue >= min && numValue <= max;
      
      default:
        return false;
    }
  } catch (error) {
    console.error('Error evaluating condition:', error);
    return false;
  }
}

async function determineQualificationStatus(supabase: any, score: number, tenantId: string): Promise<string> {
  try {
    const { data: statuses, error } = await supabase
      .from('lead_qualification_statuses')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('priority', { ascending: true });

    if (error || !statuses?.length) {
      // Default qualification logic if no custom statuses
      if (score >= 80) return 'hot';
      if (score >= 60) return 'warm';
      if (score >= 40) return 'qualified';
      return 'unqualified';
    }

    // Find the appropriate qualification status based on score
    for (const status of statuses) {
      if (score >= status.min_score && score <= status.max_score) {
        return status.name.toLowerCase();
      }
    }

    return 'unqualified';
  } catch (error) {
    console.error('Error determining qualification status:', error);
    return 'unqualified';
  }
}