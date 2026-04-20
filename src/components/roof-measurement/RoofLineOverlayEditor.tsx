import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Sparkles, RefreshCw } from 'lucide-react'
import { useRoofLineOverlay, type RoofLineType, type RoofLine } from '@/hooks/useRoofLineOverlay'

const LINE_COLORS: Record<RoofLineType, string> = {
  ridge: 'hsl(140 70% 50%)',   // green
  hip: 'hsl(280 70% 60%)',     // purple
  valley: 'hsl(0 80% 55%)',    // red
  eave: 'hsl(210 90% 55%)',    // blue
  rake: 'hsl(40 95% 55%)',     // amber
}

const LINE_TYPES: RoofLineType[] = ['ridge', 'hip', 'valley', 'eave', 'rake']

interface Props {
  measurementId: string
  tenantId: string
  lat: number
  lng: number
  refreshKey?: number
}

export function RoofLineOverlayEditor({ measurementId, tenantId, lat, lng, refreshKey }: Props) {
  const { overlay, loading, generating, generate, reclassify } = useRoofLineOverlay(measurementId, refreshKey)
  const [selectedLine, setSelectedLine] = useState<RoofLine | null>(null)

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
          Loading overlay...
        </CardContent>
      </Card>
    )
  }

  if (!overlay) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Roof Line Overlay</CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <p className="text-sm text-muted-foreground mb-4">
            No overlay yet. Generate one from the Mapbox aerial.
          </p>
          <Button
            onClick={() => generate({ tenant_id: tenantId, lat, lng })}
            disabled={generating}
          >
            {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Generate Overlay
          </Button>
        </CardContent>
      </Card>
    )
  }

  const W = overlay.image_width ?? 2048
  const H = overlay.image_height ?? 2048

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Roof Line Overlay</CardTitle>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Badge variant="secondary">v{overlay.version}</Badge>
            <Badge variant={overlay.source === 'corrected' ? 'default' : 'outline'}>
              {overlay.source}
            </Badge>
            <span>{overlay.lines.length} lines</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => generate({ tenant_id: tenantId, lat, lng })}
          disabled={generating}
        >
          {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
          Regenerate
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Image + SVG overlay */}
        <div className="relative w-full rounded-lg overflow-hidden border bg-muted">
          {overlay.image_url && (
            <img src={overlay.image_url} alt="Aerial" className="w-full h-auto block" />
          )}
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="absolute inset-0 w-full h-full"
            preserveAspectRatio="none"
          >
            {overlay.lines.map((line) => {
              const isSelected = selectedLine?.id === line.id
              return (
                <g key={line.id}>
                  <line
                    x1={line.p1[0]} y1={line.p1[1]}
                    x2={line.p2[0]} y2={line.p2[1]}
                    stroke={LINE_COLORS[line.type]}
                    strokeWidth={isSelected ? 14 : 8}
                    strokeLinecap="round"
                    style={{ cursor: 'pointer', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.7))' }}
                    onClick={() => setSelectedLine(line)}
                  />
                </g>
              )
            })}
          </svg>
        </div>

        {/* Selected line editor */}
        {selectedLine && (
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Selected line</div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedLine(null)}>Close</Button>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: LINE_COLORS[selectedLine.type] }}
              />
              <span className="capitalize">{selectedLine.type}</span>
              <span className="text-muted-foreground">
                {selectedLine.length_ft?.toFixed(1)} ft · conf {(selectedLine.confidence * 100).toFixed(0)}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Reclassify as:</span>
              <Select
                value={selectedLine.type}
                onValueChange={async (v) => {
                  await reclassify(selectedLine.id, v as RoofLineType)
                  setSelectedLine(null)
                }}
              >
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LINE_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Totals */}
        <div className="grid grid-cols-5 gap-2 text-center">
          {LINE_TYPES.map((t) => (
            <div key={t} className="rounded-md border p-2">
              <div className="flex items-center justify-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full" style={{ background: LINE_COLORS[t] }} />
                <span className="text-xs text-muted-foreground capitalize">{t}</span>
              </div>
              <div className="text-sm font-semibold mt-1">
                {Math.round(overlay.totals_ft[t] || 0)} ft
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
