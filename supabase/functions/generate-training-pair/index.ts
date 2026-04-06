import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.49.1';

import {
  flattenGeometrySegments,
  cleanupGeometry,
  type VendorGeometry,
  type GroupedGeometry,
} from '../_shared/geometry-alignment.ts';

import {
  alignVendorToAerial,
  extractFootprintPixelCoords,
  generateAlignmentPreview,
  type ImageBounds,
  type ImageDims,
} from '../_shared/spatial-alignment-engine.ts';

import {
  packTrainingPair,
  type TrainingLabels,
} from '../_shared/training-mask-generator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Safely coerce any value to an array — handles undefined, objects, and arrays. */
function ensureArray(input: unknown): unknown[] {
  if (!input) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === 'object') return Object.values(input as Record<string, unknown>);
  return [];
}

interface TrainingPairRequest {
  lat: number;
  lng: number;
  address: string;
  vendorGeometry: VendorGeometry;
  vendorTruth?: {
    areaSqft?: number;
    facetCount?: number;
    predominantPitch?: string;
    ridgeFt?: number;
    hipFt?: number;
    valleyFt?: number;
    eaveFt?: number;
    rakeFt?: number;
    source?: string;
  };
  /** Pre-resolved footprint vertices as [lng, lat][] */
  footprintVertices?: [number, number][];
  /** Pre-fetched aerial image info */
  aerialImage?: {
    url: string;
    bounds: ImageBounds;
    width: number;
    height: number;
  };
  tenantId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body: TrainingPairRequest = await req.json();

    if (!body.lat || !body.lng || !body.address) {
      return new Response(JSON.stringify({ success: false, error: 'lat, lng, and address are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!body.vendorGeometry) {
      return new Response(JSON.stringify({ success: false, error: 'vendorGeometry is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🎯 Generating training pair for: ${body.address}`);
    console.log('DEBUG INPUT:', {
      vendorGeometryType: typeof body.vendorGeometry,
      ridgeType: typeof body.vendorGeometry?.ridge,
      ridgeIsArray: Array.isArray(body.vendorGeometry?.ridge),
      footprintType: typeof body.footprintVertices,
      footprintIsArray: Array.isArray(body.footprintVertices),
    });

    // ----- Step 1: Resolve aerial image -----
    let aerialImage = body.aerialImage;
    if (!aerialImage) {
      console.log('📸 Fetching Mapbox aerial image...');
      const mapboxToken = Deno.env.get('MAPBOX_PUBLIC_TOKEN') || Deno.env.get('MAPBOX_ACCESS_TOKEN');
      if (!mapboxToken) {
        throw new Error('MAPBOX_PUBLIC_TOKEN or MAPBOX_ACCESS_TOKEN required');
      }

      const zoom = 20;
      const width = 1280;
      const height = 1280;

      const mapboxUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/` +
        `${body.lng},${body.lat},${zoom}/${width}x${height}@2x?access_token=${mapboxToken}`;

      // Calculate bounds
      const metersPerPixel = 156543.03392 * Math.cos(body.lat * Math.PI / 180) / Math.pow(2, zoom);
      const widthInMeters = width * metersPerPixel;
      const heightInMeters = height * metersPerPixel;
      const latOffset = (heightInMeters / 2) / 111320;
      const lngOffset = (widthInMeters / 2) / (111320 * Math.cos(body.lat * Math.PI / 180));

      aerialImage = {
        url: mapboxUrl,
        bounds: {
          topLeft: { lat: body.lat + latOffset, lng: body.lng - lngOffset },
          topRight: { lat: body.lat + latOffset, lng: body.lng + lngOffset },
          bottomLeft: { lat: body.lat - latOffset, lng: body.lng - lngOffset },
          bottomRight: { lat: body.lat - latOffset, lng: body.lng + lngOffset },
        },
        width,
        height,
      };
    }

    const imageDims: ImageDims = { width: aerialImage.width, height: aerialImage.height };

    // ----- Step 2: Resolve footprint -----
    let footprintVertices = ensureArray(body.footprintVertices) as [number, number][];
    if (!footprintVertices || footprintVertices.length === 0) {
      // Try to call footprint-resolver via Supabase
      console.log('🏠 Resolving footprint...');
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

      const fpResponse = await fetch(`${supabaseUrl}/functions/v1/measure`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lat: body.lat,
          lng: body.lng,
          address: body.address,
          vendorGeometry: body.vendorGeometry,
          vendorTruth: body.vendorTruth,
        }),
      });

      if (fpResponse.ok) {
        const result = await fpResponse.json();
        if (result.footprint?.vertices) {
          footprintVertices = result.footprint.vertices;
          console.log(`✅ Footprint resolved: ${footprintVertices!.length} vertices`);
        }
      }

      if (!footprintVertices) {
        throw new Error('Could not resolve footprint. Provide footprintVertices directly.');
      }
    }

    // ----- Step 3: Run spatial alignment -----
    console.log('🔄 Running spatial alignment...');
    const grouped = flattenGeometrySegments(body.vendorGeometry);
    const cleaned = cleanupGeometry(grouped);

    const alignmentResult = alignVendorToAerial({
      vendorGeometry: cleaned,
      footprintVertices,
      imageBounds: aerialImage.bounds,
      imageDims,
    });

    console.log(`✅ Alignment: quality=${alignmentResult.quality.grade}, residual=${alignmentResult.residualError.toFixed(2)}px`);

    // ----- Step 4: Generate training pair -----
    console.log('📦 Generating training pair...');

    const footprintPixels = extractFootprintPixelCoords(
      footprintVertices,
      aerialImage.bounds,
      imageDims,
    );

    const labels: TrainingLabels = {
      totalAreaSqft: body.vendorTruth?.areaSqft ?? null,
      facetCount: body.vendorTruth?.facetCount ?? null,
      predominantPitch: body.vendorTruth?.predominantPitch ?? null,
      lineLengths: {
        ridge: body.vendorTruth?.ridgeFt ?? null,
        valley: body.vendorTruth?.valleyFt ?? null,
        hip: body.vendorTruth?.hipFt ?? null,
        eave: body.vendorTruth?.eaveFt ?? null,
        rake: body.vendorTruth?.rakeFt ?? null,
      },
    };

    const trainingPair = packTrainingPair({
      aerialImageUrl: aerialImage.url,
      width: aerialImage.width,
      height: aerialImage.height,
      footprintPixels,
      alignedGeometry: alignmentResult.alignedGeometry,
      labels,
      metadata: {
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        vendorSource: body.vendorTruth?.source ?? null,
        alignmentQuality: alignmentResult.quality.normalizedError,
        confidenceScore: alignmentResult.quality.grade === 'good' ? 0.9 :
          alignmentResult.quality.grade === 'acceptable' ? 0.6 : 0.3,
        generatedAt: new Date().toISOString(),
      },
    });

    // ----- Step 5: Generate alignment preview -----
    const preview = generateAlignmentPreview(
      alignmentResult.alignedGeometry,
      footprintPixels,
      imageDims,
    );

    // ----- Step 6: Store in database -----
    let trainingPairId: string | null = null;
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const sb = createClient(supabaseUrl, supabaseKey);

      const { data, error } = await sb.from('training_pairs').insert({
        address: body.address,
        lat: body.lat,
        lng: body.lng,
        aerial_image_url: aerialImage.url,
        vendor_source: body.vendorTruth?.source ?? null,
        alignment_quality: alignmentResult.quality.normalizedError,
        alignment_matrix: alignmentResult.affineMatrix,
        labels,
        confidence_score: trainingPair.metadata.confidenceScore,
        tenant_id: body.tenantId ?? null,
      }).select('id').single();

      if (error) {
        console.error('DB insert error:', error.message);
      } else {
        trainingPairId = data.id;
        console.log(`✅ Stored training pair: ${trainingPairId}`);
      }
    } catch (dbErr) {
      console.warn('⚠️ Could not store training pair in DB:', dbErr);
    }

    return new Response(JSON.stringify({
      success: true,
      trainingPairId,
      alignment: {
        quality: alignmentResult.quality,
        residualError: alignmentResult.residualError,
        affineMatrix: alignmentResult.affineMatrix,
        srcPointCount: alignmentResult.srcPoints.length,
        dstPointCount: alignmentResult.dstPoints.length,
      },
      trainingPair,
      preview,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Training pair generation failed:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
