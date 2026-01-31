/**
 * SVG OVERLAY GENERATOR - Phase 6
 * 
 * Generates annotated SVG overlays with:
 * - Facet polygons with color coding
 * - Linear features (ridge, hip, valley, eave, rake)
 * - Length labels
 * - Facet number labels
 * - North arrow compass
 * - Legend
 */

// ============= Types =============

export interface ImageBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  centerLat: number;
  centerLng: number;
}

export interface OverlayFacet {
  id: string;
  polygon: Array<{ lat: number; lng: number }>;
  areaSqft: number;
  pitch?: string;
}

export interface OverlayLinearFeature {
  type: 'ridge' | 'hip' | 'valley' | 'eave' | 'rake';
  start: { lat: number; lng: number };
  end: { lat: number; lng: number };
  lengthFt: number;
}

export interface OverlayConfig {
  width: number;
  height: number;
  showFacets?: boolean;
  showLinearFeatures?: boolean;
  showLengthLabels?: boolean;
  showFacetLabels?: boolean;
  showNorthArrow?: boolean;
  showLegend?: boolean;
  showFootprint?: boolean;
}

// ============= Color Palettes =============

const FACET_COLORS = [
  'rgba(59, 130, 246, 0.35)',   // Blue
  'rgba(239, 68, 68, 0.35)',    // Red
  'rgba(34, 197, 94, 0.35)',    // Green
  'rgba(251, 191, 36, 0.35)',   // Yellow
  'rgba(139, 92, 246, 0.35)',   // Purple
  'rgba(236, 72, 153, 0.35)',   // Pink
  'rgba(20, 184, 166, 0.35)',   // Teal
  'rgba(249, 115, 22, 0.35)',   // Orange
];

const LINE_COLORS: Record<string, string> = {
  ridge: '#90EE90',   // Light green
  hip: '#9B59B6',     // Purple
  valley: '#DC3545',  // Red
  eave: '#006400',    // Dark green
  rake: '#17A2B8',    // Cyan
};

const LINE_STROKE_WIDTHS: Record<string, number> = {
  ridge: 4,
  hip: 3,
  valley: 3,
  eave: 2,
  rake: 2,
};

// ============= Main Generator Function =============

export function generateSVGOverlay(
  footprint: Array<{ lat: number; lng: number }>,
  linearFeatures: OverlayLinearFeature[],
  facets: OverlayFacet[],
  bounds: ImageBounds,
  config: OverlayConfig
): string {
  const {
    width,
    height,
    showFacets = true,
    showLinearFeatures = true,
    showLengthLabels = true,
    showFacetLabels = true,
    showNorthArrow = true,
    showLegend = true,
    showFootprint = true,
  } = config;
  
  // GPS to pixel conversion
  const gpsToPixel = (coord: { lat: number; lng: number }): { x: number; y: number } => {
    const x = ((coord.lng - bounds.west) / (bounds.east - bounds.west)) * width;
    const y = ((bounds.north - coord.lat) / (bounds.north - bounds.south)) * height;
    return { x, y };
  };
  
  // Calculate polygon centroid
  const getCentroid = (polygon: Array<{ lat: number; lng: number }>): { lat: number; lng: number } => {
    const n = polygon.length;
    if (n === 0) return { lat: 0, lng: 0 };
    const sumLat = polygon.reduce((sum, p) => sum + p.lat, 0);
    const sumLng = polygon.reduce((sum, p) => sum + p.lng, 0);
    return { lat: sumLat / n, lng: sumLng / n };
  };
  
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`;
  
  // Add defs for drop shadows
  svg += `
    <defs>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="1" dy="1" stdDeviation="1" flood-opacity="0.3"/>
      </filter>
      <filter id="textShadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0.5" dy="0.5" stdDeviation="0.5" flood-opacity="0.5"/>
      </filter>
    </defs>
  `;
  
  // ========================================
  // Draw Facets
  // ========================================
  if (showFacets && facets.length > 0) {
    svg += '<!-- Facets -->';
    facets.forEach((facet, idx) => {
      if (!facet.polygon || facet.polygon.length < 3) return;
      
      const points = facet.polygon.map(p => {
        const px = gpsToPixel(p);
        return `${px.x.toFixed(1)},${px.y.toFixed(1)}`;
      }).join(' ');
      
      const color = FACET_COLORS[idx % FACET_COLORS.length];
      
      svg += `
        <polygon 
          points="${points}" 
          fill="${color}" 
          stroke="#343A40" 
          stroke-width="2"
          data-facet-id="${facet.id}"
        />
      `;
      
      // Facet label at centroid
      if (showFacetLabels) {
        const centroid = getCentroid(facet.polygon);
        const cpx = gpsToPixel(centroid);
        
        svg += `
          <circle cx="${cpx.x.toFixed(1)}" cy="${cpx.y.toFixed(1)}" r="12" fill="#343A40"/>
          <text 
            x="${cpx.x.toFixed(1)}" 
            y="${(cpx.y + 4).toFixed(1)}" 
            text-anchor="middle" 
            fill="white" 
            font-size="12" 
            font-weight="bold"
            font-family="Arial, sans-serif"
          >${idx + 1}</text>
        `;
      }
    });
  }
  
  // ========================================
  // Draw Linear Features
  // ========================================
  if (showLinearFeatures && linearFeatures.length > 0) {
    svg += '<!-- Linear Features -->';
    
    // Group by type for layering (draw eaves first, ridges last)
    const drawOrder = ['eave', 'rake', 'valley', 'hip', 'ridge'];
    
    drawOrder.forEach(featureType => {
      const features = linearFeatures.filter(lf => lf.type === featureType);
      
      features.forEach((lf, idx) => {
        const startPx = gpsToPixel(lf.start);
        const endPx = gpsToPixel(lf.end);
        const color = LINE_COLORS[lf.type] || '#FFFFFF';
        const strokeWidth = LINE_STROKE_WIDTHS[lf.type] || 2;
        
        // Draw line
        svg += `
          <line 
            x1="${startPx.x.toFixed(1)}" 
            y1="${startPx.y.toFixed(1)}" 
            x2="${endPx.x.toFixed(1)}" 
            y2="${endPx.y.toFixed(1)}" 
            stroke="${color}" 
            stroke-width="${strokeWidth}"
            stroke-linecap="round"
            filter="url(#shadow)"
            data-feature-type="${lf.type}"
            data-length="${lf.lengthFt.toFixed(1)}"
          />
        `;
        
        // Length label at midpoint
        if (showLengthLabels && lf.lengthFt >= 3) {
          const midX = (startPx.x + endPx.x) / 2;
          const midY = (startPx.y + endPx.y) / 2;
          
          // Calculate angle for label rotation
          const angle = Math.atan2(endPx.y - startPx.y, endPx.x - startPx.x) * 180 / Math.PI;
          const displayAngle = (angle > 90 || angle < -90) ? angle + 180 : angle;
          
          svg += `
            <g transform="translate(${midX.toFixed(1)}, ${(midY - 8).toFixed(1)})">
              <rect 
                x="-16" 
                y="-8" 
                width="32" 
                height="14" 
                fill="rgba(255,255,255,0.85)" 
                rx="3"
              />
              <text 
                x="0" 
                y="3" 
                text-anchor="middle" 
                fill="${color}" 
                font-size="10" 
                font-weight="bold"
                font-family="Arial, sans-serif"
                filter="url(#textShadow)"
              >${lf.lengthFt.toFixed(0)}'</text>
            </g>
          `;
        }
      });
    });
  }
  
  // ========================================
  // Draw Footprint Outline
  // ========================================
  if (showFootprint && footprint.length >= 3) {
    svg += '<!-- Footprint Outline -->';
    
    const perimeterPoints = footprint.map(p => {
      const px = gpsToPixel(p);
      return `${px.x.toFixed(1)},${px.y.toFixed(1)}`;
    }).join(' ');
    
    svg += `
      <polygon 
        points="${perimeterPoints}" 
        fill="none" 
        stroke="#343A40" 
        stroke-width="3"
        stroke-linejoin="round"
      />
    `;
  }
  
  // ========================================
  // North Arrow
  // ========================================
  if (showNorthArrow) {
    svg += '<!-- North Arrow -->';
    const arrowX = width - 40;
    const arrowY = 40;
    
    svg += `
      <g transform="translate(${arrowX}, ${arrowY})">
        <circle cx="0" cy="0" r="20" fill="rgba(255,255,255,0.9)" stroke="#343A40" stroke-width="1"/>
        <polygon points="0,-15 5,-5 0,-8 -5,-5" fill="#ef4444"/>
        <polygon points="0,15 5,5 0,8 -5,5" fill="#343A40"/>
        <text x="0" y="-22" text-anchor="middle" fill="#ef4444" font-size="12" font-weight="bold" font-family="Arial, sans-serif">N</text>
      </g>
    `;
  }
  
  // ========================================
  // Legend
  // ========================================
  if (showLegend) {
    svg += '<!-- Legend -->';
    const legendX = 15;
    const legendY = height - 100;
    const lineHeight = 18;
    
    svg += `
      <g transform="translate(${legendX}, ${legendY})">
        <rect x="-5" y="-5" width="90" height="95" fill="rgba(255,255,255,0.9)" rx="5" stroke="#e5e7eb"/>
        <text x="0" y="10" fill="#343A40" font-size="11" font-weight="bold" font-family="Arial, sans-serif">Legend</text>
    `;
    
    const legendItems = [
      { type: 'ridge', label: 'Ridge' },
      { type: 'hip', label: 'Hip' },
      { type: 'valley', label: 'Valley' },
      { type: 'eave', label: 'Eave' },
      { type: 'rake', label: 'Rake' },
    ];
    
    legendItems.forEach((item, idx) => {
      const y = 25 + idx * lineHeight;
      const color = LINE_COLORS[item.type];
      
      svg += `
        <line x1="0" y1="${y}" x2="20" y2="${y}" stroke="${color}" stroke-width="3"/>
        <text x="25" y="${y + 4}" fill="#343A40" font-size="10" font-family="Arial, sans-serif">${item.label}</text>
      `;
    });
    
    svg += '</g>';
  }
  
  svg += '</svg>';
  return svg;
}

// ============= Helper Functions =============

/**
 * Calculate image bounds from coordinates and zoom level
 */
export function calculateImageBounds(
  centerLat: number,
  centerLng: number,
  zoom: number,
  imageWidth: number,
  imageHeight: number
): ImageBounds {
  const metersPerPixel = (156543.03392 * Math.cos(centerLat * Math.PI / 180)) / Math.pow(2, zoom);
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos(centerLat * Math.PI / 180);
  
  const halfWidthMeters = (imageWidth / 2) * metersPerPixel;
  const halfHeightMeters = (imageHeight / 2) * metersPerPixel;
  
  const halfWidthDegrees = halfWidthMeters / metersPerDegreeLng;
  const halfHeightDegrees = halfHeightMeters / metersPerDegreeLat;
  
  return {
    north: centerLat + halfHeightDegrees,
    south: centerLat - halfHeightDegrees,
    east: centerLng + halfWidthDegrees,
    west: centerLng - halfWidthDegrees,
    centerLat,
    centerLng,
  };
}

/**
 * Convert linear features from WKT array to overlay format
 */
export function linearFeaturesFromWKT(
  wktFeatures: Array<{ type: string; wkt: string; length_ft?: number }>
): OverlayLinearFeature[] {
  return wktFeatures.map(f => {
    // Parse WKT LINESTRING(lng1 lat1, lng2 lat2)
    const match = f.wkt?.match(/LINESTRING\(([^)]+)\)/);
    if (!match) return null;
    
    const coords = match[1].split(',').map(pair => {
      const [lng, lat] = pair.trim().split(' ').map(Number);
      return { lat, lng };
    });
    
    if (coords.length < 2) return null;
    
    return {
      type: f.type.toLowerCase() as OverlayLinearFeature['type'],
      start: coords[0],
      end: coords[coords.length - 1],
      lengthFt: f.length_ft || 0,
    };
  }).filter(Boolean) as OverlayLinearFeature[];
}

/**
 * Generate inline SVG data URI for embedding in HTML/PDF
 */
export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Generate base64 encoded SVG for embedding
 */
export function svgToBase64(svg: string): string {
  // Convert SVG string to base64
  const base64 = btoa(unescape(encodeURIComponent(svg)));
  return `data:image/svg+xml;base64,${base64}`;
}
