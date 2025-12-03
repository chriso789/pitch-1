import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valid TLDs including .org, .com, .net, etc.
const VALID_TLD_REGEX = /\.[a-z]{2,}$/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(normalizedUrl);
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format', verified: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if hostname has a valid TLD
    if (!VALID_TLD_REGEX.test(parsedUrl.hostname)) {
      console.log('URL does not have valid TLD:', parsedUrl.hostname);
      return new Response(
        JSON.stringify({ error: 'URL does not appear complete', verified: false }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Verifying website:', normalizedUrl, '| Hostname:', parsedUrl.hostname);

    // Fetch the website with increased timeout (15s)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PitchCRM/1.0; Website Verification)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        redirect: 'follow',
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      console.error('Fetch error for', normalizedUrl, ':', fetchError.message);
      return new Response(
        JSON.stringify({ 
          error: fetchError.name === 'AbortError' ? 'Website took too long to respond' : 'Could not reach website', 
          verified: false,
          domain: parsedUrl.hostname 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      console.log('Website returned status:', response.status);
      return new Response(
        JSON.stringify({ 
          error: `Website returned ${response.status}`, 
          verified: false,
          domain: parsedUrl.hostname 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const html = await response.text();

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : parsedUrl.hostname;

    // Extract favicon - check multiple patterns
    let favicon = '';
    const faviconPatterns = [
      /<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i,
      /<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i,
      /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i,
    ];
    
    for (const pattern of faviconPatterns) {
      const match = html.match(pattern);
      if (match) {
        favicon = match[1];
        break;
      }
    }
    
    if (favicon) {
      // Handle relative URLs
      if (favicon.startsWith('//')) {
        favicon = 'https:' + favicon;
      } else if (favicon.startsWith('/')) {
        favicon = `${parsedUrl.protocol}//${parsedUrl.hostname}${favicon}`;
      } else if (!favicon.startsWith('http')) {
        favicon = `${parsedUrl.protocol}//${parsedUrl.hostname}/${favicon}`;
      }
    } else {
      // Default to /favicon.ico
      favicon = `${parsedUrl.protocol}//${parsedUrl.hostname}/favicon.ico`;
    }

    // Extract description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
    const description = descMatch ? descMatch[1].trim().substring(0, 160) : '';

    console.log('Website verified successfully:', { title, domain: parsedUrl.hostname, favicon: favicon.substring(0, 50) });

    return new Response(
      JSON.stringify({
        verified: true,
        url: normalizedUrl,
        domain: parsedUrl.hostname,
        title,
        favicon,
        description,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error verifying website:', error);
    return new Response(
      JSON.stringify({ error: error.message, verified: false }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
