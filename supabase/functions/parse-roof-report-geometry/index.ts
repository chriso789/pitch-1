import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ParsedMeasurements {
  totalArea: number;
  facetCount: number;
  pitch: string;
  linear: {
    eaves: number;
    valleys: number;
    hips: number;
    ridges: number;
    rakes: number;
    wallFlashing: number;
    stepFlashing: number;
  };
  wasteTable: {
    [key: string]: { area: number; squares: number };
  };
  materials: {
    shingleBundles: number;
    starterBundles: number;
    iceWaterRolls: number;
    syntheticRolls: number;
    cappingBundles: number;
    valleySheets: number;
    dripEdgeSheets: number;
  };
  source: string;
  reportDate?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { reportText, diagramImageBase64 } = await req.json();
    
    if (!reportText) {
      throw new Error('Report text is required');
    }

    console.log('Parsing roof report text...');
    
    // Parse measurements from text using regex patterns
    const measurements = parseReportText(reportText);
    
    // If diagram image provided, analyze it with AI to extract geometry
    let diagramGeometry = null;
    if (diagramImageBase64) {
      diagramGeometry = await analyzeReportDiagram(diagramImageBase64);
    }

    return new Response(JSON.stringify({
      success: true,
      measurements,
      diagramGeometry,
      source: 'roofr_pdf_import'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Parse error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function parseReportText(text: string): ParsedMeasurements {
  // Parse total area
  const areaMatch = text.match(/Total roof area[:\s]*(\d[\d,]*)\s*sqft/i);
  const totalArea = areaMatch ? parseInt(areaMatch[1].replace(/,/g, '')) : 0;

  // Parse facet count
  const facetMatch = text.match(/(\d+)\s*facets/i);
  const facetCount = facetMatch ? parseInt(facetMatch[1]) : 0;

  // Parse predominant pitch
  const pitchMatch = text.match(/Predominant pitch[:\s]*(\d+\/\d+)/i);
  const pitch = pitchMatch ? pitchMatch[1] : '6/12';

  // Parse linear measurements (format: "309ft 4in" or "309.3" or "77ft 11in")
  const parseLinear = (pattern: RegExp): number => {
    const match = text.match(pattern);
    if (!match) return 0;
    
    const value = match[1];
    // Handle "ft in" format
    const ftInMatch = value.match(/(\d+)ft\s*(\d+)in/);
    if (ftInMatch) {
      return parseInt(ftInMatch[1]) + parseInt(ftInMatch[2]) / 12;
    }
    // Handle plain number
    return parseFloat(value.replace(/[^\d.]/g, '')) || 0;
  };

  const linear = {
    eaves: parseLinear(/(?:Total\s+)?[Ee]aves[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    valleys: parseLinear(/(?:Total\s+)?[Vv]alleys[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    hips: parseLinear(/(?:Total\s+)?[Hh]ips[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    ridges: parseLinear(/(?:Total\s+)?[Rr]idges[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    rakes: parseLinear(/(?:Total\s+)?[Rr]akes[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    wallFlashing: parseLinear(/[Ww]all flashing[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
    stepFlashing: parseLinear(/[Ss]tep flashing[:\s]*(\d+(?:ft\s*\d+in|\d*\.?\d+))/),
  };

  // Parse waste table
  const wasteTable: { [key: string]: { area: number; squares: number } } = {};
  const wastePatterns = [
    { key: '0', pattern: /Waste\s*%[^|]*\|?\s*0%[^|]*\|?\s*([\d,]+)\s*sqft/ },
    { key: '9', pattern: /9%[^|]*\|?\s*([\d,]+)\s*sqft/ },
    { key: '10', pattern: /10%[^|]*\|?\s*([\d,]+)\s*sqft/ },
    { key: '12', pattern: /12%[^|]*\|?\s*([\d,]+)\s*sqft/ },
    { key: '15', pattern: /15%[^|]*\|?\s*([\d,]+)\s*sqft/ },
  ];

  // Simpler approach - extract from summary section
  const squares = totalArea / 100;
  wasteTable['0'] = { area: totalArea, squares };
  wasteTable['10'] = { area: Math.round(totalArea * 1.10), squares: Math.round(squares * 1.10 * 10) / 10 };
  wasteTable['15'] = { area: Math.round(totalArea * 1.15), squares: Math.round(squares * 1.15 * 10) / 10 };

  // Parse materials (simplified - can be enhanced)
  const materials = {
    shingleBundles: Math.ceil(squares * 1.10 * 3), // 3 bundles per square with 10% waste
    starterBundles: Math.ceil((linear.eaves + linear.rakes) / 100),
    iceWaterRolls: Math.ceil((linear.eaves + linear.valleys) / 60),
    syntheticRolls: Math.ceil(totalArea / 1000),
    cappingBundles: Math.ceil((linear.hips + linear.ridges) / 25),
    valleySheets: Math.ceil(linear.valleys / 8),
    dripEdgeSheets: Math.ceil((linear.eaves + linear.rakes) / 10),
  };

  return {
    totalArea,
    facetCount,
    pitch,
    linear,
    wasteTable,
    materials,
    source: 'roofr'
  };
}

async function analyzeReportDiagram(imageBase64: string): Promise<any> {
  const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
  if (!LOVABLE_API_KEY) {
    console.log('No LOVABLE_API_KEY, skipping diagram analysis');
    return null;
  }

  try {
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analyze this roof diagram from a professional measurement report. Extract:
1. The approximate shape/layout of the roof (count facets numbered 1-N)
2. The relative positions and shapes of each facet
3. Any visible measurements on the diagram edges
4. The compass orientation if shown

Return as JSON with this structure:
{
  "facetCount": number,
  "facets": [
    { "id": 1, "shape": "rectangle|triangle|trapezoid", "relativePosition": "north|south|east|west|center" }
  ],
  "hasCompass": boolean,
  "orientation": "north-up|other",
  "diagramType": "schematic|satellite-overlay"
}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${imageBase64}` }
            }
          ]
        }],
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      console.error('AI diagram analysis failed:', response.status);
      return null;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    // Try to parse JSON from response
    const jsonMatch = content?.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    return null;
  } catch (error) {
    console.error('Diagram analysis error:', error);
    return null;
  }
}
