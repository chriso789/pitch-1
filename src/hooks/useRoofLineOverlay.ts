import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { toast } from 'sonner'

export type RoofLineType = 'ridge' | 'hip' | 'valley' | 'eave' | 'rake'

export interface RoofLine {
  id: string
  type: RoofLineType
  p1: [number, number]
  p2: [number, number]
  confidence: number
  length_px?: number
  length_ft?: number
}

export interface RoofLineOverlay {
  id: string
  tenant_id: string
  measurement_id: string
  parent_overlay_id: string | null
  version: number
  source: 'auto' | 'corrected' | 'manual'
  image_url: string | null
  storage_path: string | null
  base_image_url: string | null
  image_width: number | null
  image_height: number | null
  meters_per_pixel: number | null
  center_lat: number | null
  center_lng: number | null
  zoom: number | null
  lines: RoofLine[]
  totals_ft: Partial<Record<RoofLineType | 'perimeter', number>>
  model_version: string | null
  created_at: string
}

export function useRoofLineOverlay(measurementId?: string | null) {
  const [overlay, setOverlay] = useState<RoofLineOverlay | null>(null)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)

  const load = useCallback(async () => {
    if (!measurementId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('roof_line_overlays')
      .select('*')
      .eq('measurement_id', measurementId)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (!error && data) setOverlay(data as unknown as RoofLineOverlay)
    setLoading(false)
  }, [measurementId])

  useEffect(() => { load() }, [load])

  const generate = useCallback(async (params: { tenant_id: string; lat: number; lng: number }) => {
    if (!measurementId) return null
    setGenerating(true)
    try {
      const { data, error } = await supabase.functions.invoke('generate-roof-line-overlay', {
        body: { measurement_id: measurementId, ...params },
      })
      if (error) throw error
      if (!data?.success) throw new Error(data?.error || 'Overlay generation failed')
      toast.success('Roof line overlay generated', {
        description: `${data.overlay.lines.length} lines detected`,
      })
      setOverlay(data.overlay)
      return data.overlay as RoofLineOverlay
    } catch (err) {
      toast.error('Overlay generation failed', {
        description: err instanceof Error ? err.message : String(err),
      })
      return null
    } finally {
      setGenerating(false)
    }
  }, [measurementId])

  const reclassify = useCallback(async (lineId: string, newType: RoofLineType) => {
    if (!overlay) return
    const updatedLines = overlay.lines.map((l) => (l.id === lineId ? { ...l, type: newType } : l))
    const totals_ft: Record<string, number> = { ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0 }
    for (const l of updatedLines) totals_ft[l.type] = (totals_ft[l.type] || 0) + (l.length_ft || 0)
    totals_ft.perimeter = totals_ft.eave + totals_ft.rake

    // Insert NEW corrected version (training-data preservation)
    const { data, error } = await supabase
      .from('roof_line_overlays')
      .insert({
        tenant_id: overlay.tenant_id,
        measurement_id: overlay.measurement_id,
        parent_overlay_id: overlay.id,
        version: overlay.version + 1,
        source: 'corrected',
        image_url: overlay.image_url,
        storage_path: overlay.storage_path,
        base_image_url: overlay.base_image_url,
        image_width: overlay.image_width,
        image_height: overlay.image_height,
        meters_per_pixel: overlay.meters_per_pixel,
        center_lat: overlay.center_lat,
        center_lng: overlay.center_lng,
        zoom: overlay.zoom,
        lines: updatedLines,
        totals_ft,
        model_version: overlay.model_version,
      })
      .select()
      .single()

    if (error) {
      toast.error('Failed to save correction', { description: error.message })
      return
    }
    setOverlay(data as unknown as RoofLineOverlay)
    toast.success('Line reclassified', { description: `Saved as training data` })
  }, [overlay])

  return { overlay, loading, generating, generate, reclassify, reload: load }
}
