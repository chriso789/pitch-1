import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnrichmentResult {
  owner_name?: string;
  phone_numbers: string[];
  emails: string[];
  property_data: Record<string, any>;
  confidence: number;
  sources: string[];
  total_cost: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    const SEARCHBUG_API_KEY = Deno.env.get('SEARCHBUG_API_KEY');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { data: { user } } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: corsHeaders });
    }

    const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', user.id).single();
    if (!profile) {
      return new Response(JSON.stringify({ error: 'Profile not found' }), { status: 404, headers: corsHeaders });
    }

    const body = await req.json();
    const { property_id } = body;

    if (!property_id) {
      return new Response(JSON.stringify({ error: 'Missing property_id' }), { status: 400, headers: corsHeaders });
    }

    const { data: property, error: propError } = await supabase
      .from('canvassiq_properties')
      .select('*')
      .eq('id', property_id)
      .eq('tenant_id', profile.tenant_id)
      .single();

    if (propError || !property) {
      return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404, headers: corsHeaders });
    }

    const result: EnrichmentResult = {
      phone_numbers: [],
      emails: [],
      property_data: {},
      confidence: 0,
      sources: [],
      total_cost: 0
    };

    const startTime = Date.now();

    // Step 1: Try Firecrawl for county property appraiser data (FREE)
    if (FIRECRAWL_API_KEY) {
      try {
        const state = property.address?.state?.toLowerCase();
      const countyUrls: Record<string, string> = {
          // Florida
          'hillsborough': 'https://www.hcpafl.org',
          'pinellas': 'https://www.pcpao.org',
          'orange': 'https://www.ocpafl.org',
          'miami-dade': 'https://www.miamidade.gov/pa',
          'broward': 'https://web.bcpa.net',
          'palm beach': 'https://www.pbcgov.com/papa',
          'duval': 'https://www.coj.net/departments/property-appraiser',
          'lee': 'https://www.leepa.org',
          'brevard': 'https://www.bcpao.us',
          'sarasota': 'https://www.sc-pa.com',
          'manatee': 'https://www.manateepao.com',
          'polk': 'https://www.polkpa.org',
          'osceola': 'https://www.property-appraiser.org',
          'seminole': 'https://www.scpafl.org',
          'pasco': 'https://www.pascopa.com',
          'lake': 'https://www.lakecopropappr.com',
          'collier': 'https://www.collierappraiser.com',
          'charlotte': 'https://www.ccappraiser.com',
          'volusia': 'https://www.volusia.org/services/growth-and-resource-management/property-appraiser',
          // Texas
          'harris': 'https://www.hcad.org',
          'dallas': 'https://www.dallascad.org',
          'tarrant': 'https://www.tad.org',
          'bexar': 'https://www.bcad.org',
          'travis': 'https://www.traviscad.org',
          // Georgia
          'fulton': 'https://www.fultoncountyga.gov/property',
          'gwinnett': 'https://www.gwinnettcounty.com/taxcommissioner',
          'cobb': 'https://www.cobbassessor.org',
          // North Carolina
          'mecklenburg': 'https://meckcama.co.mecklenburg.nc.us',
          'wake': 'https://services.wakegov.com/realestate',
          // Colorado
          'denver': 'https://www.denvergov.org/property',
          'el paso': 'https://assessor.elpasoco.com',
          // Arizona
          'maricopa': 'https://mcassessor.maricopa.gov',
        };

        const county = property.address?.county?.toLowerCase();
        if (county && countyUrls[county]) {
          const firecrawlRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              url: `${countyUrls[county]}/search?address=${encodeURIComponent(property.address?.formatted || '')}`,
              formats: [{ type: 'json', schema: {
                owner_name: 'string',
                mailing_address: 'string',
                assessed_value: 'number',
                year_built: 'number'
              }}],
              waitFor: 3000
            })
          });

          if (firecrawlRes.ok) {
            const firecrawlData = await firecrawlRes.json();
            if (firecrawlData.success && firecrawlData.json) {
              result.owner_name = firecrawlData.json.owner_name;
              result.property_data = { ...result.property_data, ...firecrawlData.json };
              result.confidence += 40;
              result.sources.push('firecrawl');

              await supabase.from('canvassiq_enrichment_logs').insert({
                tenant_id: profile.tenant_id,
                property_id,
                user_id: user.id,
                provider: 'firecrawl',
                success: true,
                confidence: 40,
                cost: 0,
                duration_ms: Date.now() - startTime
              });
            }
          }
        }
      } catch (e) {
        console.error('Firecrawl error:', e);
      }
    }

    // Step 2: If confidence < 70%, try SearchBug (PAID - $0.35)
    if (result.confidence < 70 && SEARCHBUG_API_KEY) {
      try {
        const address = property.address?.formatted || '';
        const searchBugRes = await fetch(`https://api.searchbug.com/api/property.aspx?PI_API_KEY=${SEARCHBUG_API_KEY}&action=property&address=${encodeURIComponent(address)}`);
        
        if (searchBugRes.ok) {
          const sbData = await searchBugRes.json();
          if (sbData.results?.[0]) {
            const sb = sbData.results[0];
            result.owner_name = result.owner_name || sb.owner_name;
            if (sb.phone) result.phone_numbers.push(sb.phone);
            if (sb.email) result.emails.push(sb.email);
            result.property_data = { ...result.property_data, ...sb };
            result.confidence += 50;
            result.sources.push('searchbug');
            result.total_cost += 0.35;

            await supabase.from('canvassiq_enrichment_logs').insert({
              tenant_id: profile.tenant_id,
              property_id,
              user_id: user.id,
              provider: 'searchbug',
              success: true,
              confidence: 50,
              cost: 0.35,
              duration_ms: Date.now() - startTime
            });
          }
        }
      } catch (e) {
        console.error('SearchBug error:', e);
      }
    }

    // Update property with enrichment data
    await supabase.from('canvassiq_properties').update({
      owner_name: result.owner_name,
      phone_numbers: result.phone_numbers,
      emails: result.emails,
      property_data: result.property_data,
      enrichment_source: result.sources,
      enrichment_cost: result.total_cost,
      enrichment_confidence: result.confidence,
      enrichment_last_at: new Date().toISOString(),
      firecrawl_data: result.sources.includes('firecrawl') ? result.property_data : null,
      searchbug_data: result.sources.includes('searchbug') ? result.property_data : null,
      updated_at: new Date().toISOString()
    }).eq('id', property_id);

    console.log(`Enriched property ${property_id}: confidence=${result.confidence}%, cost=$${result.total_cost}`);

    return new Response(JSON.stringify({ success: true, result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
