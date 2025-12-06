import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// County building department URLs to scrape
const COUNTY_SCRAPE_URLS: Record<string, string> = {
  'Miami-Dade': 'https://www.miamidade.gov/global/economy/building/roofing-permits.page',
  'Broward': 'https://www.broward.org/Building/Permits/Pages/RoofPermit.aspx',
  'Palm Beach': 'https://discover.pbcgov.org/pzb/building/Pages/Permits.aspx',
  'Hillsborough': 'https://www.hillsboroughcounty.org/residents/property-owners-and-renters/building-permits',
  'Pinellas': 'https://pinellas.gov/building/',
  'Orange': 'https://www.orangecountyfl.net/PermitsLicenses/BuildingPermits.aspx',
  'Lee': 'https://www.leegov.com/dcd/buildperm',
  'Sarasota': 'https://www.scgov.net/government/building-and-development-services/permitting',
  'Charlotte': 'https://www.charlottecountyfl.gov/departments/community-development/building-construction/permits/',
  'Collier': 'https://www.colliercountyfl.gov/government/growth-management/building-permits',
  'Monroe': 'https://www.monroecounty-fl.gov/170/Building-Department',
  'Brevard': 'https://www.brevardfl.gov/PlanningDevelopment/PermitsAndReviews',
  'Volusia': 'https://www.volusia.org/services/growth-and-resource-management/building-and-code-administration/permits-and-inspections.stml',
  'Martin': 'https://www.martin.fl.us/building',
  'St. Lucie': 'https://www.stlucieco.gov/departments-services/a-z/building-services',
  'Indian River': 'https://www.ircgov.com/Departments/Building/',
  'Duval': 'https://www.coj.net/departments/regulatory-compliance-department/building-inspection-division',
  'Escambia': 'https://myescambia.com/our-services/building-inspections',
  'Bay': 'https://www.co.bay.fl.us/159/Building-Inspection',
  'Manatee': 'https://www.mymanatee.org/departments/building_and_development_services',
};

interface ScrapeRequest {
  county_name?: string;  // Scrape single county
  scrape_all?: boolean;  // Scrape all counties
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const FIRECRAWL_API_KEY = Deno.env.get('FIRECRAWL_API_KEY');
    if (!FIRECRAWL_API_KEY) {
      throw new Error('FIRECRAWL_API_KEY not configured');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } }
    );

    const { county_name, scrape_all }: ScrapeRequest = await req.json();

    // Determine which counties to scrape
    let countiesToScrape: string[] = [];
    
    if (scrape_all) {
      countiesToScrape = Object.keys(COUNTY_SCRAPE_URLS);
    } else if (county_name) {
      if (!COUNTY_SCRAPE_URLS[county_name]) {
        return new Response(
          JSON.stringify({ error: `No scrape URL configured for ${county_name}` }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      countiesToScrape = [county_name];
    } else {
      return new Response(
        JSON.stringify({ error: 'Either county_name or scrape_all must be provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const results: Array<{ county: string; success: boolean; error?: string; data?: any }> = [];

    for (const county of countiesToScrape) {
      try {
        const url = COUNTY_SCRAPE_URLS[county];
        console.log(`Scraping ${county} from ${url}`);

        // Call Firecrawl API
        const firecrawlResponse = await fetch('https://api.firecrawl.dev/v1/scrape', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url,
            formats: ['markdown', 'html'],
            onlyMainContent: true,
            waitFor: 3000,
          }),
        });

        if (!firecrawlResponse.ok) {
          const errorText = await firecrawlResponse.text();
          throw new Error(`Firecrawl error: ${errorText}`);
        }

        const firecrawlData = await firecrawlResponse.json();
        
        if (!firecrawlData.success) {
          throw new Error('Firecrawl scrape failed');
        }

        // Extract permit information from scraped content
        const content = firecrawlData.data?.markdown || '';
        const extractedData = extractPermitInfo(content, county);

        // Get county ID
        const { data: countyData, error: countyError } = await supabaseClient
          .from('florida_counties')
          .select('id')
          .eq('name', county)
          .single();

        if (countyError || !countyData) {
          throw new Error(`County ${county} not found in database`);
        }

        // Update or insert permit requirements
        const { error: upsertError } = await supabaseClient
          .from('county_permit_requirements')
          .upsert({
            county_id: countyData.id,
            permit_type: 'residential_reroof',
            online_submission: extractedData.online_submission,
            permit_portal_url: url,
            required_documents: extractedData.required_documents,
            base_fee: extractedData.base_fee,
            typical_processing_days: extractedData.processing_days,
            department_name: extractedData.department_name,
            department_phone: extractedData.department_phone,
            notes: `Auto-scraped on ${new Date().toISOString()}`,
            last_scraped_at: new Date().toISOString(),
            scrape_source_url: url,
          }, {
            onConflict: 'county_id,permit_type',
          });

        if (upsertError) {
          throw new Error(`Database upsert failed: ${upsertError.message}`);
        }

        results.push({
          county,
          success: true,
          data: extractedData,
        });

        console.log(`Successfully scraped ${county}`);

        // Rate limiting - wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error scraping ${county}:`, error);
        results.push({
          county,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return new Response(
      JSON.stringify({
        success: true,
        message: `Scraped ${successCount}/${results.length} counties successfully`,
        results,
        summary: {
          total: results.length,
          success: successCount,
          failed: failCount,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error in scrape-county-permits:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
};

// Extract permit information from scraped markdown content
function extractPermitInfo(content: string, countyName: string): {
  online_submission: boolean;
  required_documents: string[];
  base_fee: number | null;
  processing_days: number | null;
  department_name: string | null;
  department_phone: string | null;
} {
  const lowerContent = content.toLowerCase();
  
  // Detect online submission
  const online_submission = 
    lowerContent.includes('apply online') ||
    lowerContent.includes('online portal') ||
    lowerContent.includes('submit online') ||
    lowerContent.includes('e-permits') ||
    lowerContent.includes('epermit');

  // Extract required documents (common patterns)
  const commonDocs = [
    'Permit Application',
    'Roof Plan',
    'Product Approval Numbers',
    'Notice of Commencement',
    'Contractor License',
    'Wind Mitigation Form',
  ];

  const required_documents: string[] = [];
  
  if (lowerContent.includes('permit application') || lowerContent.includes('application form')) {
    required_documents.push('Permit Application');
  }
  if (lowerContent.includes('roof plan') || lowerContent.includes('roofing plan')) {
    required_documents.push('Roof Plan with dimensions');
  }
  if (lowerContent.includes('noa') || lowerContent.includes('product approval')) {
    required_documents.push('Product Approval Numbers (NOA)');
  }
  if (lowerContent.includes('notice of commencement') || lowerContent.includes('noc')) {
    required_documents.push('Notice of Commencement');
  }
  if (lowerContent.includes('contractor license') || lowerContent.includes('contractor certification')) {
    required_documents.push('Contractor License');
  }
  if (lowerContent.includes('wind mitigation')) {
    required_documents.push('Wind Mitigation Form');
  }
  if (lowerContent.includes('hvhz') || lowerContent.includes('high velocity hurricane')) {
    required_documents.push('HVHZ Compliance Documentation');
  }
  if (lowerContent.includes('engineer') || lowerContent.includes('sealed drawing')) {
    required_documents.push('Engineered sealed calculations');
  }

  // If no docs found, use defaults
  if (required_documents.length === 0) {
    required_documents.push('Permit Application', 'Roof Plan', 'Product Specifications', 'Contractor License');
  }

  // Extract fee (look for dollar amounts)
  let base_fee: number | null = null;
  const feeMatch = content.match(/\$(\d{2,3}(?:,\d{3})?(?:\.\d{2})?)/);
  if (feeMatch) {
    base_fee = parseFloat(feeMatch[1].replace(',', ''));
  }

  // Extract processing time
  let processing_days: number | null = null;
  const daysMatch = content.match(/(\d+)\s*(?:business\s*)?days?/i);
  if (daysMatch) {
    processing_days = parseInt(daysMatch[1]);
    if (processing_days > 60) processing_days = null; // Sanity check
  }

  // Extract phone number
  let department_phone: string | null = null;
  const phoneMatch = content.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
  if (phoneMatch) {
    department_phone = phoneMatch[0];
  }

  // Department name based on county
  const department_name = `${countyName} County Building Department`;

  return {
    online_submission,
    required_documents,
    base_fee,
    processing_days,
    department_name,
    department_phone,
  };
}

serve(handler);
