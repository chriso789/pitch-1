import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valid TLDs including .org, .com, .net, etc.
const VALID_TLD_REGEX = /\.[a-z]{2,}$/i;

// Blocked hostnames - known dangerous/internal endpoints
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  'metadata.google.internal',
  '169.254.169.254',
  'metadata.internal',
  'instance-data',
  'metadata',
]);

// Check if IP is private/internal
function isPrivateIP(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  
  // 10.0.0.0/8 (Class A private)
  if (parts[0] === 10) return true;
  // 172.16.0.0/12 (Class B private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16 (Class C private)
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (loopback)
  if (parts[0] === 127) return true;
  // 169.254.0.0/16 (link-local / cloud metadata)
  if (parts[0] === 169 && parts[1] === 254) return true;
  // 0.0.0.0
  if (parts.every(p => p === 0)) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
  
  return false;
}

// Validate URL before fetching - SSRF protection
function validateUrl(url: URL): { valid: boolean; error?: string } {
  const hostname = url.hostname.toLowerCase();
  
  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { valid: false, error: 'URL points to blocked host' };
  }
  
  // Block direct IP addresses that are private
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    if (isPrivateIP(hostname)) {
      return { valid: false, error: 'URL points to private network' };
    }
  }
  
  // Block internal hostname patterns
  if (hostname.endsWith('.internal') || 
      hostname.endsWith('.local') || 
      hostname.endsWith('.localhost') ||
      hostname.includes('.internal.')) {
    return { valid: false, error: 'URL points to internal resource' };
  }
  
  // Block file:// and other dangerous protocols
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { valid: false, error: 'Only HTTP/HTTPS protocols allowed' };
  }
  
  return { valid: true };
}

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

    // SSRF Protection: Validate URL before fetching
    const validation = validateUrl(parsedUrl);
    if (!validation.valid) {
      console.log('SSRF blocked:', parsedUrl.hostname, validation.error);
      return new Response(
        JSON.stringify({ error: validation.error, verified: false }),
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

    // Fetch with retry logic and increased timeout (20s)
    const fetchWithRetry = async (url: string, retries = 2): Promise<Response> => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 20000);

        try {
          const response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.5',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
          });
          clearTimeout(timeoutId);
          return response;
        } catch (error: any) {
          clearTimeout(timeoutId);
          console.log(`Attempt ${attempt + 1} failed for ${url}:`, error.message);
          if (attempt === retries) throw error;
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
      throw new Error('All retries failed');
    };

    let response: Response;
    try {
      response = await fetchWithRetry(normalizedUrl);
    } catch (fetchError: any) {
      console.error('Fetch error for', normalizedUrl, ':', fetchError.message);
      return new Response(
        JSON.stringify({ 
          error: fetchError.name === 'AbortError' ? 'Website took too long to respond' : 'Could not reach website. Please check the URL and try again.', 
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
