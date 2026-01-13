import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { supabaseService } from '../_shared/supabase.ts';
import { corsHeaders } from '../_shared/cors.ts';

const openaiApiKey = Deno.env.get('OPENAI_API_KEY')!;
const openWeatherApiKey = Deno.env.get('OPENWEATHER_API_KEY');

interface LeadScoringRequest {
  contact_id?: string;
  contact_data?: any;
  bulk_score?: boolean;
}

interface WeatherEvent {
  date: string;
  type: string;
  severity: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = supabaseService();

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
        const score = await calculateAILeadScore(supabase, contact, profile.tenant_id);
        
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

    const score = await calculateAILeadScore(supabase, contact, profile.tenant_id);

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

async function fetchWeatherHistory(lat: number, lng: number): Promise<{ events: WeatherEvent[], stormRisk: number }> {
  if (!openWeatherApiKey || !lat || !lng) {
    return { events: [], stormRisk: 0 };
  }

  try {
    // Get current weather for storm indicators
    const response = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${openWeatherApiKey}&units=imperial`
    );
    
    if (!response.ok) {
      console.log('Weather API error:', response.status);
      return { events: [], stormRisk: 0 };
    }

    const data = await response.json();
    const events: WeatherEvent[] = [];
    let stormRisk = 0;

    // Check for storm conditions
    if (data.weather) {
      for (const condition of data.weather) {
        const id = condition.id;
        // Thunderstorm codes: 200-232
        if (id >= 200 && id < 300) {
          events.push({ date: new Date().toISOString(), type: 'thunderstorm', severity: 'high' });
          stormRisk += 20;
        }
        // Rain codes: 500-531
        if (id >= 500 && id < 600) {
          events.push({ date: new Date().toISOString(), type: 'rain', severity: 'medium' });
          stormRisk += 10;
        }
        // Snow codes: 600-622
        if (id >= 600 && id < 700) {
          events.push({ date: new Date().toISOString(), type: 'snow', severity: 'medium' });
          stormRisk += 10;
        }
      }
    }

    // Check wind speed (mph)
    if (data.wind?.speed > 30) {
      events.push({ date: new Date().toISOString(), type: 'high_wind', severity: 'high' });
      stormRisk += 15;
    } else if (data.wind?.speed > 20) {
      events.push({ date: new Date().toISOString(), type: 'moderate_wind', severity: 'medium' });
      stormRisk += 8;
    }

    return { events, stormRisk: Math.min(stormRisk, 50) };
  } catch (error) {
    console.error('Weather fetch error:', error);
    return { events: [], stormRisk: 0 };
  }
}

async function getEngagementScore(supabase: any, contactId: string, tenantId: string): Promise<{
  score: number;
  details: {
    emailOpens: number;
    emailClicks: number;
    callCount: number;
    totalCallDuration: number;
    portalVisits: number;
    lastActivity: string | null;
  };
}> {
  let emailOpens = 0;
  let emailClicks = 0;
  let callCount = 0;
  let totalCallDuration = 0;
  let portalVisits = 0;
  let lastActivity: string | null = null;

  try {
    // Get email engagement
    const { data: emailEvents } = await supabase
      .from('email_engagement_events')
      .select('event_type, created_at')
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });

    if (emailEvents) {
      emailOpens = emailEvents.filter((e: any) => e.event_type === 'open').length;
      emailClicks = emailEvents.filter((e: any) => e.event_type === 'click').length;
      if (emailEvents.length > 0) {
        lastActivity = emailEvents[0].created_at;
      }
    }

    // Get call engagement
    const { data: calls } = await supabase
      .from('call_logs')
      .select('duration_seconds, created_at, status')
      .eq('contact_id', contactId)
      .eq('tenant_id', tenantId);

    if (calls) {
      callCount = calls.filter((c: any) => c.status === 'completed').length;
      totalCallDuration = calls.reduce((sum: number, c: any) => sum + (c.duration_seconds || 0), 0);
      if (calls.length > 0 && (!lastActivity || calls[0].created_at > lastActivity)) {
        lastActivity = calls[0].created_at;
      }
    }

    // Get portal visits
    const { data: portalTokens } = await supabase
      .from('customer_portal_tokens')
      .select('last_used_at')
      .eq('contact_id', contactId)
      .not('last_used_at', 'is', null);

    if (portalTokens) {
      portalVisits = portalTokens.length;
    }

  } catch (error) {
    console.error('Error fetching engagement data:', error);
  }

  // Calculate engagement score (max 30 points)
  let score = 0;
  score += Math.min(emailOpens * 2, 8);      // Max 8 points for email opens
  score += Math.min(emailClicks * 3, 6);     // Max 6 points for email clicks
  score += Math.min(callCount * 3, 9);       // Max 9 points for calls
  score += Math.min(Math.floor(totalCallDuration / 60) * 0.5, 4); // Max 4 points for call duration
  score += Math.min(portalVisits * 1.5, 3);  // Max 3 points for portal visits

  return {
    score: Math.round(score),
    details: { emailOpens, emailClicks, callCount, totalCallDuration, portalVisits, lastActivity }
  };
}

async function calculateAILeadScore(supabase: any, contact: any, tenantId: string): Promise<{
  score: number;
  qualification_status: string;
  details: any;
  recommendations: string[];
}> {
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

  // Get weather history for the contact's location
  const weatherData = await fetchWeatherHistory(
    contact.latitude || contact.verified_address?.lat,
    contact.longitude || contact.verified_address?.lng
  );

  // Get engagement score
  const engagement = await getEngagementScore(supabase, contact.id, tenantId);

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
    
    Weather Data:
    - Recent Weather Events: ${JSON.stringify(weatherData.events)}
    - Storm Risk Score: ${weatherData.stormRisk}/50
    
    Engagement Data:
    - Email Opens: ${engagement.details.emailOpens}
    - Email Clicks: ${engagement.details.emailClicks}
    - Completed Calls: ${engagement.details.callCount}
    - Total Call Duration: ${Math.floor(engagement.details.totalCallDuration / 60)} minutes
    - Portal Visits: ${engagement.details.portalVisits}
    - Last Activity: ${engagement.details.lastActivity || 'None'}
    - Engagement Score: ${engagement.score}/30
    
    Consider these factors:
    1. Urgency indicators - recent storm damage increases urgency
    2. Property value and location quality
    3. Lead source quality and conversion rates
    4. Engagement level - active engagement indicates higher interest
    5. Seasonal timing - storm season increases roofing needs
    6. Recent weather events - hail/wind damage creates immediate opportunity
    
    Respond with a JSON object containing:
    {
      "enhanced_score": number (0-100),
      "confidence": number (0-1),
      "key_factors": [array of strings],
      "red_flags": [array of potential concerns],
      "recommendations": [array of action items],
      "qualification_status": "hot_lead" | "warm_lead" | "cold_lead" | "unqualified",
      "weather_opportunity": boolean,
      "engagement_level": "high" | "medium" | "low" | "none"
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
            content: 'You are an expert lead scoring analyst for a roofing company. Provide accurate, data-driven lead assessments that consider weather events, engagement data, and property information.'
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

    // Combine scores: base (40%) + AI (35%) + weather (15%) + engagement (10%)
    const weatherBonus = weatherData.stormRisk;
    const engagementBonus = engagement.score;
    
    const finalScore = Math.min(100, Math.max(0, 
      Math.round(
        (baseScore * 0.4) + 
        (aiAnalysis.enhanced_score * 0.35) + 
        (weatherBonus * 0.3) +  // Weather can add up to 15 points
        (engagementBonus * 0.33) // Engagement can add up to 10 points
      )
    ));

    return {
      score: finalScore,
      qualification_status: aiAnalysis.qualification_status,
      details: {
        base_score: baseScore,
        ai_enhanced_score: aiAnalysis.enhanced_score,
        weather_score: weatherBonus,
        engagement_score: engagement.score,
        applied_rules: appliedRules,
        ai_confidence: aiAnalysis.confidence,
        key_factors: aiAnalysis.key_factors,
        red_flags: aiAnalysis.red_flags,
        weather_events: weatherData.events,
        weather_opportunity: aiAnalysis.weather_opportunity,
        engagement_level: aiAnalysis.engagement_level,
        engagement_details: engagement.details,
        scoring_timestamp: new Date().toISOString()
      },
      recommendations: aiAnalysis.recommendations
    };

  } catch (error) {
    console.error('AI scoring failed, using base score:', error);
    
    // Fallback to base score with weather and engagement bonuses
    const fallbackScore = Math.min(100, baseScore + weatherData.stormRisk + engagement.score);
    
    let qualificationStatus = 'unqualified';
    if (fallbackScore >= 80) qualificationStatus = 'hot_lead';
    else if (fallbackScore >= 60) qualificationStatus = 'warm_lead';
    else if (fallbackScore >= 40) qualificationStatus = 'cold_lead';

    return {
      score: fallbackScore,
      qualification_status: qualificationStatus,
      details: {
        base_score: baseScore,
        weather_score: weatherData.stormRisk,
        engagement_score: engagement.score,
        applied_rules: appliedRules,
        weather_events: weatherData.events,
        engagement_details: engagement.details,
        ai_fallback: true,
        scoring_timestamp: new Date().toISOString()
      },
      recommendations: [
        weatherData.stormRisk > 10 ? 'Recent weather events detected - prioritize contact' : 'Follow up based on lead score',
        engagement.score > 15 ? 'High engagement - ready for sales conversation' : 'Increase engagement through nurture sequence',
        'Review contact details for accuracy'
      ]
    };
  }
}