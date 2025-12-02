import { useState, useEffect } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { 
  Edit, Save, X, TrendingUp, AlertCircle, 
  CheckCircle, Info, History
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface CorrectionSystemProps {
  measurementId: string
  onCorrectionSaved?: () => void
}

export function MeasurementCorrectionSystem({
  measurementId,
  onCorrectionSaved
}: CorrectionSystemProps) {
  const [measurement, setMeasurement] = useState<any>(null)
  const [editMode, setEditMode] = useState(false)
  const [corrections, setCorrections] = useState<any>({})
  const [correctionHistory, setCorrectionHistory] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(() => {
    loadMeasurement()
    loadCorrectionHistory()
  }, [measurementId])

  const loadMeasurement = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('roof_measurements')
        .select(`*, roof_measurement_facets (*)`)
        .eq('id', measurementId)
        .single()

      if (error) throw error
      setMeasurement(data)
    } catch (error) {
      console.error('Error loading measurement:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCorrectionHistory = async () => {
    try {
      const { data, error } = await supabase
        .from('roof_measurement_corrections')
        .select('*')
        .eq('measurement_id', measurementId)
        .order('created_at', { ascending: false })

      if (error) throw error
      setCorrectionHistory(data || [])
    } catch (error) {
      console.error('Error loading correction history:', error)
    }
  }

  const handleFieldChange = (field: string, value: any) => {
    setCorrections({
      ...corrections,
      [field]: {
        original: measurement[field],
        corrected: value,
        type: determineFieldType(field)
      }
    })
  }

  const handleFacetChange = (facetId: string, field: string, value: any) => {
    const facets = measurement.roof_measurement_facets || []
    setCorrections({
      ...corrections,
      [`facet_${facetId}_${field}`]: {
        original: facets.find((f: any) => f.id === facetId)?.[field],
        corrected: value,
        type: 'facet_area_adjustment',
        facetId
      }
    })
  }

  const determineFieldType = (field: string): string => {
    if (field === 'total_area_adjusted_sqft') return 'total_area_adjustment'
    if (field === 'predominant_pitch') return 'pitch_adjustment'
    if (field === 'facet_count') return 'facet_count_adjustment'
    if (field.includes('length')) return 'linear_measurement_adjustment'
    return 'other_correction'
  }

  const saveCorrections = async (correctionReason: string, correctionMethod: string) => {
    setSaving(true)
    try {
      const user = await supabase.auth.getUser()
      const userId = user.data.user?.id

      const correctionRecords = Object.entries(corrections).map(([key, value]: [string, any]) => ({
        measurement_id: measurementId,
        facet_id: value.facetId || null,
        corrected_by: userId,
        correction_type: value.type,
        field_name: key,
        original_value: { value: value.original },
        corrected_value: { value: value.corrected },
        correction_reason: correctionReason,
        correction_method: correctionMethod
      }))

      const { error: correctionError } = await supabase
        .from('roof_measurement_corrections')
        .insert(correctionRecords)

      if (correctionError) throw correctionError

      const measurementUpdates: any = {}
      Object.entries(corrections).forEach(([key, value]: [string, any]) => {
        if (!key.startsWith('facet_')) {
          measurementUpdates[key] = value.corrected
        }
      })

      if (Object.keys(measurementUpdates).length > 0) {
        const { error: updateError } = await supabase
          .from('roof_measurements')
          .update(measurementUpdates)
          .eq('id', measurementId)

        if (updateError) throw updateError
      }

      const facetCorrections = Object.entries(corrections).filter(([key]) => key.startsWith('facet_'))
      for (const [key, value] of facetCorrections) {
        const facetId = (value as any).facetId
        const field = key.replace(`facet_${facetId}_`, '')
        
        const { error: facetError } = await supabase
          .from('roof_measurement_facets')
          .update({ [field]: (value as any).corrected })
          .eq('id', facetId)

        if (facetError) throw facetError
      }

      await logPerformanceMetrics()
      await loadMeasurement()
      await loadCorrectionHistory()

      setCorrections({})
      setEditMode(false)

      if (onCorrectionSaved) {
        onCorrectionSaved()
      }

      alert('Corrections saved successfully!')

    } catch (error) {
      console.error('Error saving corrections:', error)
      alert('Failed to save corrections. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const logPerformanceMetrics = async () => {
    try {
      const aiPredicted = measurement.total_area_adjusted_sqft
      const finalValue = corrections.total_area_adjusted_sqft?.corrected || aiPredicted
      const accuracy = 100 - Math.abs((aiPredicted - finalValue) / finalValue * 100)

      const { error } = await supabase
        .from('roof_ai_model_performance')
        .insert({
          measurement_id: measurementId,
          ai_predicted_area_sqft: aiPredicted,
          ai_predicted_squares: measurement.total_squares,
          ai_predicted_facet_count: measurement.facet_count,
          ai_predicted_pitch: measurement.predominant_pitch,
          final_area_sqft: finalValue,
          final_squares: finalValue / 100,
          final_facet_count: corrections.facet_count?.corrected || measurement.facet_count,
          final_pitch: corrections.predominant_pitch?.corrected || measurement.predominant_pitch,
          area_accuracy_percent: accuracy,
          image_quality_score: measurement.image_quality_score,
          roof_complexity: measurement.complexity_rating,
          required_manual_corrections: Object.keys(corrections).length > 0,
          correction_count: Object.keys(corrections).length
        })

      if (error) console.error('Error logging performance:', error)
    } catch (error) {
      console.error('Performance logging error:', error)
    }
  }

  const cancelEditing = () => {
    setCorrections({})
    setEditMode(false)
  }

  const getVariancePercent = (original: number, corrected: number): number => {
    return Math.abs((corrected - original) / original * 100)
  }

  const getVarianceBadge = (variance: number) => {
    if (variance < 5) return <Badge className="bg-green-500">Excellent</Badge>
    if (variance < 10) return <Badge className="bg-blue-500">Good</Badge>
    if (variance < 20) return <Badge className="bg-yellow-500">Fair</Badge>
    return <Badge className="bg-red-500">Poor</Badge>
  }

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
        </div>
      </Card>
    )
  }

  if (!measurement) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>Measurement not found</AlertDescription>
      </Alert>
    )
  }

  const facets = measurement.roof_measurement_facets || []

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Measurement Correction & Training</h2>
            <p className="text-muted-foreground mt-1">
              Help improve AI accuracy by correcting measurements
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setShowHistory(!showHistory)}
            >
              <History className="mr-2 h-4 w-4" />
              {correctionHistory.length} Corrections
            </Button>
            {!editMode ? (
              <Button onClick={() => setEditMode(true)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Measurements
              </Button>
            ) : (
              <Button variant="outline" onClick={cancelEditing}>
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            )}
          </div>
        </div>
      </Card>

      {showHistory && correctionHistory.length > 0 && (
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Correction History</h3>
          <div className="space-y-3">
            {correctionHistory.map((correction) => (
              <div key={correction.id} className="border-l-4 border-primary pl-4 py-2 bg-muted rounded-r">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold capitalize">
                    {correction.correction_type.replace(/_/g, ' ')}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {new Date(correction.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm text-foreground">
                  <strong>{correction.field_name}:</strong>{' '}
                  {JSON.stringify(correction.original_value.value)} → {JSON.stringify(correction.corrected_value.value)}
                </div>
                {correction.correction_reason && (
                  <div className="text-sm text-muted-foreground mt-1">
                    Reason: {correction.correction_reason}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Tabs defaultValue="summary" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="facets">Facets</TabsTrigger>
          <TabsTrigger value="linear">Linear</TabsTrigger>
          <TabsTrigger value="analysis">Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Key Measurements</h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex-1">
                  <Label>Total Roof Area (sqft)</Label>
                  {editMode ? (
                    <Input
                      type="number"
                      value={corrections.total_area_adjusted_sqft?.corrected ?? measurement.total_area_adjusted_sqft}
                      onChange={(e) => handleFieldChange('total_area_adjusted_sqft', parseFloat(e.target.value))}
                      className="mt-2"
                    />
                  ) : (
                    <div className="text-2xl font-bold mt-1">
                      {measurement.total_area_adjusted_sqft?.toFixed(2)}
                    </div>
                  )}
                </div>
                {corrections.total_area_adjusted_sqft && (
                  <div className="ml-4">
                    <div className="text-sm text-muted-foreground">AI Predicted</div>
                    <div className="text-xl font-semibold text-muted-foreground">
                      {corrections.total_area_adjusted_sqft.original?.toFixed(2)}
                    </div>
                    <div className="text-sm mt-1">
                      Variance: {getVariancePercent(
                        corrections.total_area_adjusted_sqft.original,
                        corrections.total_area_adjusted_sqft.corrected
                      ).toFixed(1)}%
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex-1">
                  <Label>Number of Facets</Label>
                  {editMode ? (
                    <Input
                      type="number"
                      value={corrections.facet_count?.corrected ?? measurement.facet_count}
                      onChange={(e) => handleFieldChange('facet_count', parseInt(e.target.value))}
                      className="mt-2"
                    />
                  ) : (
                    <div className="text-2xl font-bold mt-1">
                      {measurement.facet_count}
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex-1">
                  <Label>Predominant Pitch</Label>
                  {editMode ? (
                    <Select
                      value={corrections.predominant_pitch?.corrected ?? measurement.predominant_pitch}
                      onValueChange={(value) => handleFieldChange('predominant_pitch', value)}
                    >
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {['2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '11/12', '12/12'].map(pitch => (
                          <SelectItem key={pitch} value={pitch}>{pitch}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="text-2xl font-bold mt-1">
                      {measurement.predominant_pitch}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="facets" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Individual Facet Corrections</h3>
            <div className="space-y-4">
              {facets.map((facet: any) => (
                <div key={facet.id} className="border-l-4 border-primary pl-4 py-3 bg-muted rounded-r">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-semibold">Facet {facet.facet_number}</h4>
                    <Badge variant="outline">{facet.pitch}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-sm">Area (sqft)</Label>
                      {editMode ? (
                        <Input
                          type="number"
                          value={corrections[`facet_${facet.id}_area_adjusted_sqft`]?.corrected ?? facet.area_adjusted_sqft}
                          onChange={(e) => handleFacetChange(facet.id, 'area_adjusted_sqft', parseFloat(e.target.value))}
                          className="mt-1"
                        />
                      ) : (
                        <div className="text-lg font-bold mt-1">{facet.area_adjusted_sqft?.toFixed(0)}</div>
                      )}
                    </div>
                    <div>
                      <Label className="text-sm">Pitch</Label>
                      {editMode ? (
                        <Select
                          value={corrections[`facet_${facet.id}_pitch`]?.corrected ?? facet.pitch}
                          onValueChange={(value) => handleFacetChange(facet.id, 'pitch', value)}
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {['2/12', '3/12', '4/12', '5/12', '6/12', '7/12', '8/12', '9/12', '10/12', '11/12', '12/12'].map(pitch => (
                              <SelectItem key={pitch} value={pitch}>{pitch}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="text-lg font-bold mt-1">{facet.pitch}</div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="linear" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Linear Measurement Corrections</h3>
            <div className="space-y-4">
              {['eave', 'rake', 'hip', 'valley', 'ridge'].map(edgeType => {
                const field = `total_${edgeType}_length`
                return (
                  <div key={field} className="flex items-center justify-between border-b pb-3">
                    <div className="flex-1">
                      <Label className="capitalize">{edgeType}s (ft)</Label>
                      {editMode ? (
                        <Input
                          type="number"
                          value={corrections[field]?.corrected ?? measurement[field]}
                          onChange={(e) => handleFieldChange(field, parseFloat(e.target.value))}
                          className="mt-2"
                        />
                      ) : (
                        <div className="text-xl font-bold mt-1">
                          {measurement[field]?.toFixed(1)}
                        </div>
                      )}
                    </div>
                    {corrections[field] && (
                      <div className="ml-4 text-right">
                        <div className="text-sm text-muted-foreground">Original</div>
                        <div className="text-lg font-semibold text-muted-foreground">
                          {corrections[field].original?.toFixed(1)}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="analysis" className="space-y-4">
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Accuracy Analysis</h3>
            
            {Object.keys(corrections).length > 0 ? (
              <div className="space-y-4">
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    You have {Object.keys(corrections).length} pending correction(s). 
                    These changes will help train the AI to improve future measurements.
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(corrections).map(([field, data]: [string, any]) => (
                    <Card key={field} className="p-4 border-l-4 border-orange-500">
                      <div className="font-semibold text-sm mb-2">{field.replace(/_/g, ' ')}</div>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs text-muted-foreground">AI: {data.original}</div>
                          <div className="text-xs text-muted-foreground">Corrected: {data.corrected}</div>
                        </div>
                        <div>
                          {getVarianceBadge(getVariancePercent(data.original, data.corrected))}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>

                <Dialog>
                  <DialogTrigger asChild>
                    <Button className="w-full" size="lg" disabled={saving}>
                      {saving ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary-foreground mr-2"></div>
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          Save Corrections & Train AI
                        </>
                      )}
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Save Corrections</DialogTitle>
                      <DialogDescription>
                        Help us understand why these corrections were needed to improve AI accuracy.
                      </DialogDescription>
                    </DialogHeader>
                    <CorrectionReasonForm 
                      onSubmit={(reason, method) => saveCorrections(reason, method)}
                      saving={saving}
                    />
                  </DialogContent>
                </Dialog>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500" />
                <p className="text-lg font-semibold">No corrections needed</p>
                <p className="text-sm mt-1">AI measurements appear accurate for this property</p>
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function CorrectionReasonForm({ onSubmit, saving }: { onSubmit: (reason: string, method: string) => void, saving: boolean }) {
  const [reason, setReason] = useState('')
  const [method, setMethod] = useState('manual_measurement')

  const handleSubmit = () => {
    if (!reason.trim()) {
      alert('Please provide a reason for the corrections')
      return
    }
    onSubmit(reason, method)
  }

  return (
    <div className="space-y-4 pt-4">
      <div>
        <Label>Correction Method</Label>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="manual_measurement">Manual Measurement</SelectItem>
            <SelectItem value="site_visit">Site Visit</SelectItem>
            <SelectItem value="drone_measurement">Drone Measurement</SelectItem>
            <SelectItem value="professional_report">Professional Report</SelectItem>
            <SelectItem value="as_built_plans">As-Built Plans</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Reason for Corrections</Label>
        <Textarea
          placeholder="Explain why these measurements needed correction..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="mt-2"
        />
      </div>

      <Alert>
        <TrendingUp className="h-4 w-4" />
        <AlertDescription>
          Your corrections will help train the AI to be more accurate on similar roof types.
        </AlertDescription>
      </Alert>

      <Button onClick={handleSubmit} className="w-full" disabled={saving}>
        {saving ? 'Saving...' : 'Submit Corrections'}
      </Button>
    </div>
  )
}
