import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RegridParcel {
  type: string;
  properties: {
    parcelnumb?: string;
    owner?: string;
    address?: string;
    saddress?: string;
    city?: string;
    state2?: string;
    szip?: string;
    ll_gisacre?: number;
    ll_gissqft?: number;
    yearbuilt?: number;
    usecode?: string;
    struct?: boolean;
  };
  geometry: {
    type: string;
    coordinates: number[][][] | number[][][][];
  };
}

interface RegridResponse {
  type: string;
  features: RegridParcel[];
}

function polygonToWKT(coordinates: number[][][] | number[][][][], geometryType: string): string {
  if (geometryType === "MultiPolygon") {
    const multiCoords = coordinates as number[][][][];
    const polygons = multiCoords.map((polygon) => {
      const rings = polygon.map((ring) => 
        ring.map((coord) => `${coord[0]} ${coord[1]}`).join(", ")
      );
      return `((${rings.join("), (")}))`;
    });
    return `MULTIPOLYGON(${polygons.join(", ")})`;
  } else {
    const polyCoords = coordinates as number[][][];
    const rings = polyCoords.map((ring) => 
      ring.map((coord) => `${coord[0]} ${coord[1]}`).join(", ")
    );
    return `POLYGON((${rings.join("), (")}))`;
  }
}

function countVertices(coordinates: number[][][] | number[][][][], geometryType: string): number {
  if (geometryType === "MultiPolygon") {
    const multiCoords = coordinates as number[][][][];
    return multiCoords.reduce((sum, polygon) => 
      sum + polygon.reduce((ringSum, ring) => ringSum + ring.length, 0), 0);
  } else {
    const polyCoords = coordinates as number[][][];
    return polyCoords.reduce((sum, ring) => sum + ring.length, 0);
  }
}

function calculateCentroid(coordinates: number[][][] | number[][][][], geometryType: string): { lat: number; lng: number } {
  let allPoints: number[][] = [];
  
  if (geometryType === "MultiPolygon") {
    const multiCoords = coordinates as number[][][][];
    multiCoords.forEach((polygon) => {
      polygon.forEach((ring) => {
        allPoints = allPoints.concat(ring);
      });
    });
  } else {
    const polyCoords = coordinates as number[][][];
    polyCoords.forEach((ring) => {
      allPoints = allPoints.concat(ring);
    });
  }
  
  const sumLng = allPoints.reduce((sum, p) => sum + p[0], 0);
  const sumLat = allPoints.reduce((sum, p) => sum + p[1], 0);
  
  return {
    lng: sumLng / allPoints.length,
    lat: sumLat / allPoints.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const REGRID_API_KEY = Deno.env.get("REGRID_API_KEY");
    if (!REGRID_API_KEY) {
      throw new Error("REGRID_API_KEY not configured");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { lat, lng, address } = await req.json();

    if (!lat || !lng) {
      throw new Error("lat and lng are required");
    }

    console.log(`[Regrid] Fetching footprint for lat=${lat}, lng=${lng}, address=${address || "N/A"}`);

    // Try the v2 API first (newer format)
    let regridUrl = `https://app.regrid.com/api/v2/parcels/point?lat=${lat}&lon=${lng}&return_geometry=true`;
    
    let response = await fetch(regridUrl, {
      headers: {
        "Authorization": `Token ${REGRID_API_KEY}`,
        "Accept": "application/json",
      },
    });

    // If v2 fails, try v1 API format
    if (!response.ok) {
      console.log(`[Regrid] v2 API returned ${response.status}, trying v1 format...`);
      regridUrl = `https://app.regrid.com/api/v1/parcel/point/${lng}/${lat}`;
      
      response = await fetch(regridUrl, {
        headers: {
          "Authorization": `Token ${REGRID_API_KEY}`,
          "Accept": "application/json",
        },
      });
    }
    
    // If both fail, try address search as last resort
    if (!response.ok && address) {
      console.log(`[Regrid] Point lookup failed, trying address search...`);
      const encodedAddress = encodeURIComponent(address);
      regridUrl = `https://app.regrid.com/api/v2/parcels/address?query=${encodedAddress}&return_geometry=true`;
      
      response = await fetch(regridUrl, {
        headers: {
          "Authorization": `Token ${REGRID_API_KEY}`,
          "Accept": "application/json",
        },
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Regrid] All API attempts failed: ${response.status} - ${errorText}`);
      
      // Return a graceful failure instead of throwing
      return new Response(
        JSON.stringify({
          success: false,
          error: "Regrid API unavailable for this location",
          suggestion: "Try using manual footprint tracing or a different address",
          details: `API returned ${response.status}`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const data: RegridResponse = await response.json();
    console.log(`[Regrid] Found ${data.features?.length || 0} parcels`);

    if (!data.features || data.features.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "No parcel found at this location",
          suggestion: "Try a nearby address or verify the coordinates",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the first (closest) parcel
    const parcel = data.features[0];
    const geometry = parcel.geometry;
    const properties = parcel.properties;

    // Convert to WKT
    const wkt = polygonToWKT(geometry.coordinates, geometry.type);
    const vertexCount = countVertices(geometry.coordinates, geometry.type);
    const centroid = calculateCentroid(geometry.coordinates, geometry.type);

    // Extract building footprint from parcel geometry
    const result = {
      success: true,
      parcel: {
        apn: properties.parcelnumb,
        owner: properties.owner,
        address: properties.saddress || properties.address,
        city: properties.city,
        state: properties.state2,
        zip: properties.szip,
        acreage: properties.ll_gisacre,
        sqft: properties.ll_gissqft,
        yearBuilt: properties.yearbuilt,
        useCode: properties.usecode,
        hasStructure: properties.struct,
      },
      footprint: {
        wkt,
        vertexCount,
        geometryType: geometry.type,
        centroid,
        // Raw GeoJSON for frontend visualization
        geojson: geometry,
      },
      source: "regrid",
      timestamp: new Date().toISOString(),
    };

    console.log(`[Regrid] Success: ${vertexCount} vertices, APN=${properties.parcelnumb}`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[Regrid] Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
