import { useState, useCallback } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'

// Output format matching AI Overlay Objective specification
// ENHANCED: Phase 5 - Added visualEvidence and snappedToTarget
export interface RoofOverlayOutput {
  perimeter: [number, number][]; // [[lng, lat], ...]
  ridges: RoofOverlayLine[];
  hips: RoofOverlayLine[];
  valleys: RoofOverlayLine[];
  metadata: {
    roofType: string;
    qualityScore: number;
    dataSourcesPriority: string[];
    requiresManualReview: boolean;
    totalAreaSqft?: number;
    processedAt: string;
    alignmentAttempts?: number; // Phase 4: How many iterations to reach alignment
  };
}

export interface RoofOverlayLine {
  start: [number, number]; // [lng, lat]
  end: [number, number];   // [lng, lat]
  confidence: number;
  requiresReview: boolean;
  source?: string;
  visualEvidence?: string; // Phase 5: What the AI saw (e.g., "bright ridge highlight")
  snappedToTarget?: boolean; // Phase 3: Whether endpoint is properly snapped
}

interface UseRoofOverlayOptions {
  onSuccess?: (data: RoofOverlayOutput) => void;
  onError?: (error: string) => void;
}

export function useRoofOverlay(options: UseRoofOverlayOptions = {}) {
  const [loading, setLoading] = useState(false)
  const [overlayData, setOverlayData] = useState<RoofOverlayOutput | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generateOverlay = useCallback(async (
    lat: number,
    lng: number,
    address?: string,
    imageUrl?: string
  ) => {
    setLoading(true)
    setError(null)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('generate-roof-overlay', {
        body: { lat, lng, address, imageUrl }
      })

      if (fnError) {
        throw new Error(fnError.message || 'Failed to generate roof overlay')
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Overlay generation failed')
      }

      const overlayResult = data.data as RoofOverlayOutput
      setOverlayData(overlayResult)
      
      // Show quality feedback
      if (overlayResult.metadata.requiresManualReview) {
        toast.warning('Overlay generated but requires manual review', {
          description: `Quality score: ${overlayResult.metadata.qualityScore}%`
        })
      } else {
        toast.success('Roof overlay generated successfully', {
          description: `${overlayResult.ridges.length} ridges, ${overlayResult.hips.length} hips, ${overlayResult.valleys.length} valleys detected`
        })
      }

      options.onSuccess?.(overlayResult)
      return overlayResult

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMessage)
      toast.error('Failed to generate overlay', { description: errorMessage })
      options.onError?.(errorMessage)
      return null
    } finally {
      setLoading(false)
    }
  }, [options])

  const clearOverlay = useCallback(() => {
    setOverlayData(null)
    setError(null)
  }, [])

  return {
    loading,
    overlayData,
    error,
    generateOverlay,
    clearOverlay
  }
}

// Helper to convert overlay to WKT-style linear features for existing components
export function overlayToLinearFeatures(overlay: RoofOverlayOutput): Array<{
  type: string;
  wkt: string;
  lengthFt: number;
}> {
  const features: Array<{ type: string; wkt: string; lengthFt: number }> = []

  const lineToWKT = (line: RoofOverlayLine): string => {
    return `LINESTRING(${line.start[0]} ${line.start[1]}, ${line.end[0]} ${line.end[1]})`
  }

  const calculateLengthFt = (line: RoofOverlayLine): number => {
    const dlng = line.end[0] - line.start[0]
    const dlat = line.end[1] - line.start[1]
    // Approximate conversion at US latitudes
    const metersPerDegLat = 111320
    const metersPerDegLng = 111320 * Math.cos(((line.start[1] + line.end[1]) / 2) * Math.PI / 180)
    const meters = Math.sqrt((dlng * metersPerDegLng) ** 2 + (dlat * metersPerDegLat) ** 2)
    return meters * 3.28084 // Convert to feet
  }

  overlay.ridges.forEach(ridge => {
    features.push({
      type: 'ridge',
      wkt: lineToWKT(ridge),
      lengthFt: calculateLengthFt(ridge)
    })
  })

  overlay.hips.forEach(hip => {
    features.push({
      type: 'hip',
      wkt: lineToWKT(hip),
      lengthFt: calculateLengthFt(hip)
    })
  })

  overlay.valleys.forEach(valley => {
    features.push({
      type: 'valley',
      wkt: lineToWKT(valley),
      lengthFt: calculateLengthFt(valley)
    })
  })

  return features
}

// Helper to convert perimeter to WKT polygon
export function perimeterToWKT(perimeter: [number, number][]): string {
  if (perimeter.length < 3) return ''
  
  const coords = perimeter.map(([lng, lat]) => `${lng} ${lat}`).join(', ')
  // Close the polygon if not already closed
  const first = perimeter[0]
  const last = perimeter[perimeter.length - 1]
  const isClosed = first[0] === last[0] && first[1] === last[1]
  
  return `POLYGON((${coords}${isClosed ? '' : `, ${first[0]} ${first[1]}`}))`
}
