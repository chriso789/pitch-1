import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

    console.log('Verifying website:', normalizedUrl);

    // Fetch the website with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(normalizedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; PitchCRM/1.0; Website Verification)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
      clearTimeout(timeoutId);
    } catch (fetchError: any) {
      console.error('Fetch error:', fetchError.message);
      return new Response(
        JSON.stringify({ 
          error: 'Could not reach website', 
          verified: false,
          domain: parsedUrl.hostname 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
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

    // Extract favicon
    let favicon = '';
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i) ||
                         html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i);
    
    if (faviconMatch) {
      favicon = faviconMatch[1];
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

    console.log('Website verified:', { title, domain: parsedUrl.hostname, favicon });

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
