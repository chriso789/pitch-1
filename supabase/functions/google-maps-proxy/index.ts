import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Initialize Supabase client for caching
const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Generate cache key from satellite image parameters
function generateCacheKey(params: URLSearchParams): string {
  const center = params.get('center') || '';
  const zoom = params.get('zoom') || '20';
  const size = params.get('size') || '640x480';
  const maptype = params.get('maptype') || 'satellite';
  
  return `${center}_z${zoom}_${size}_${maptype}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

// Check if image exists in cache
async function getCachedImage(cacheKey: string): Promise<{ url: string; cached: boolean } | null> {
  try {
    // Check cache metadata
    const { data: cacheData, error: cacheError } = await supabase
      .from('satellite_image_cache')
      .select('storage_path')
      .eq('cache_key', cacheKey)
      .single();

    if (cacheError || !cacheData) {
      console.log('Cache miss:', cacheKey);
      return null;
    }

    // Get public URL for cached image
    const { data: urlData } = supabase.storage
      .from('satellite-cache')
      .getPublicUrl(cacheData.storage_path);

    if (urlData?.publicUrl) {
      // Update access statistics
      await supabase.rpc('update_cache_access_stats', { p_cache_key: cacheKey });
      
      console.log('Cache hit:', cacheKey);
      return { url: urlData.publicUrl, cached: true };
    }

    return null;
  } catch (error) {
    console.error('Error checking cache:', error);
    return null;
  }
}

// Store image in cache
async function cacheImage(cacheKey: string, imageBuffer: ArrayBuffer, params: URLSearchParams): Promise<string | null> {
  try {
    const fileName = `${cacheKey}.png`;
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('satellite-cache')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        cacheControl: '31536000', // 1 year
        upsert: true
      });

    if (uploadError) {
      console.error('Error uploading to cache:', uploadError);
      return null;
    }

    // Extract parameters for metadata
    const center = params.get('center')?.split(',') || ['0', '0'];
    const lat = parseFloat(center[0]);
    const lng = parseFloat(center[1]);
    const zoom = parseInt(params.get('zoom') || '20');
    const size = params.get('size')?.split('x') || ['640', '480'];
    const width = parseInt(size[0]);
    const height = parseInt(size[1]);
    const maptype = params.get('maptype') || 'satellite';

    // Store metadata
    const { error: metadataError } = await supabase
      .from('satellite_image_cache')
      .insert({
        cache_key: cacheKey,
        storage_path: fileName,
        lat,
        lng,
        zoom,
        width,
        height,
        maptype,
        file_size_bytes: imageBuffer.byteLength
      });

    if (metadataError) {
      console.error('Error storing cache metadata:', metadataError);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('satellite-cache')
      .getPublicUrl(fileName);

    console.log('Image cached:', cacheKey);
    return urlData?.publicUrl || null;
  } catch (error) {
    console.error('Error caching image:', error);
    return null;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { endpoint, params } = await req.json();
    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    
    if (!apiKey) {
      throw new Error('Google Places API key not configured');
    }

    // Ensure params is a plain object for URLSearchParams
    const searchParams = params && typeof params === 'object' ? new URLSearchParams(params) : '';
    let url = '';
    
    switch (endpoint) {
      case 'autocomplete':
        url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?key=${apiKey}&${searchParams}`;
        break;
      case 'details':
        url = `https://maps.googleapis.com/maps/api/place/details/json?key=${apiKey}&${searchParams}`;
        break;
      case 'geocode':
        url = `https://maps.googleapis.com/maps/api/geocode/json?key=${apiKey}&${searchParams}`;
        break;
      case 'directions':
        url = `https://maps.googleapis.com/maps/api/directions/json?key=${apiKey}&${searchParams}`;
        break;
      case 'satellite':
        // Generate cache key from parameters
        const cacheKey = generateCacheKey(searchParams);
        
        // Check cache first
        const cachedResult = await getCachedImage(cacheKey);
        if (cachedResult) {
          console.log('Returning cached image:', cacheKey);
          return new Response(JSON.stringify({ 
            image_url: cachedResult.url,
            cached: true,
            status: 'success'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Cache miss - fetch from Google Maps
        console.log('Fetching from Google Maps:', cacheKey);
        url = `https://maps.googleapis.com/maps/api/staticmap?key=${apiKey}&${searchParams}`;
        
        const imageResponse = await fetch(url);
        if (!imageResponse.ok) {
          throw new Error('Failed to fetch satellite image');
        }
        
        const imageBuffer = await imageResponse.arrayBuffer();
        
        // Store in cache for future requests
        const cachedUrl = await cacheImage(cacheKey, imageBuffer, searchParams);
        
        if (cachedUrl) {
          // Return cached URL instead of base64
          return new Response(JSON.stringify({ 
            image_url: cachedUrl,
            cached: false,
            status: 'success'
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // Fallback to base64 if caching fails
        const uint8Array = new Uint8Array(imageBuffer);
        const chunkSize = 8192;
        let binary = '';
        
        for (let i = 0; i < uint8Array.length; i += chunkSize) {
          const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
          binary += String.fromCharCode.apply(null, Array.from(chunk));
        }
        
        const base64Image = btoa(binary);
        
        return new Response(JSON.stringify({ 
          image: base64Image,
          cached: false,
          status: 'success'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        break;
      case 'elevation':
        // Elevation API for roof pitch calculation
        url = `https://maps.googleapis.com/maps/api/elevation/json?key=${apiKey}&${searchParams}`;
        break;
      case 'streetview':
        // Street View Static API for roof angle analysis
        url = `https://maps.googleapis.com/maps/api/streetview?key=${apiKey}&${searchParams}`;
        break;
      case 'places':
        // Places API for property boundary detection
        url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?key=${apiKey}&${searchParams}`;
        break;
      default:
        throw new Error('Invalid endpoint');
    }

    const response = await fetch(url);
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});