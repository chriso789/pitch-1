import { useState } from 'react'
import { supabase } from '@/integrations/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { 
  Loader2, Download, AlertCircle, CheckCircle, 
  MapPin, Ruler, Home, TrendingUp, Layers, Eye, FileImage
} from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AIRoofSkeletonViewer } from './AIRoofSkeletonViewer'
import { CleanRoofDiagram } from './CleanRoofDiagram'
import { toast } from 'sonner'

export interface RoofMeasurements {
  // New API properties
  totalAreaSqft?: number;
  totalSquares?: number;
  perimeterFt?: number;
  ridgeFt?: number;
  hipFt?: number;
  valleyFt?: number;
  eaveFt?: number;
  rakeFt?: number;
  dripEdgeFt?: number;
  flashingFt?: number;
  stories?: number;
  
  // Legacy properties for backward compatibility
  roofArea: number;        // sq ft
  planArea: number;        // sq ft (flat)
  squares: number;         // roofArea / 100
  perimeter: number;       // linear ft
  ridge: number;           // linear ft
  hip: number;             // linear ft
  valley: number;          // linear ft
  eave: number;            // linear ft
  rake: number;            // linear ft
  pitch: string;           // e.g. "6/12"
  pitchFactor: number;     // multiplier
  wasteFactor: number;     // percentage
  faceCount: number;
}

interface RoofMeasurementToolProps {
  propertyId?: string
  customerId?: string
  initialAddress?: string
  initialLat?: number
  initialLng?: number
  lat?: number
  lng?: number
  address?: string
  onMeasurementComplete?: (measurementId: string) => void
  onSave?: (measurements: RoofMeasurements) => void
  onCancel?: () => void
}

export function RoofMeasurementTool({ 
  propertyId,
  customerId, 
  initialAddress = '',
  initialLat,
  initialLng,
  lat,
  lng,
  address: propAddress,
  onMeasurementComplete,
  onSave,
  onCancel
}: RoofMeasurementToolProps) {
  const effectiveLat = initialLat ?? lat
  const effectiveLng = initialLng ?? lng
  const effectiveAddress = initialAddress || propAddress || ''
  
  const [address, setAddress] = useState(effectiveAddress)
  const [loading, setLoading] = useState(false)
  const [measurementData, setMeasurementData] = useState<any>(null)
  const [diagramView, setDiagramView] = useState<'satellite' | 'schematic'>('satellite')
  const [error, setError] = useState<string | null>(null)

  const analyzeRoof = async () => {
    if (!address.trim()) {
      setError('Please enter a property address')
      return
    }

    setLoading(true)
    setError(null)

    try {
      let coordinates = { lat: effectiveLat, lng: effectiveLng }
      let formattedAddress = address

      // If no initial coordinates, geocode the address via edge function
      if (!effectiveLat || !effectiveLng) {
        const { data: geocodeData, error: geocodeError } = await supabase.functions.invoke('google-maps-proxy', {
          body: {
            endpoint: 'geocode',
            params: { address: address }
          }
        })

        if (geocodeError) throw geocodeError

        if (geocodeData.status !== 'OK' || !geocodeData.results?.[0]) {
          throw new Error('Unable to find address. Please check and try again.')
        }

        coordinates = geocodeData.results[0].geometry.location
        formattedAddress = geocodeData.results[0].formatted_address
      }

      // Call analyze-roof-aerial edge function
      const { data, error: functionError } = await supabase.functions.invoke('analyze-roof-aerial', {
        body: {
          address: formattedAddress,
          coordinates,
          customerId,
          userId: (await supabase.auth.getUser()).data.user?.id
        }
      })

      // Improved error handling with actionable messages
      if (functionError) {
        console.error('Edge function error:', functionError)
        
        // Parse error details for better user feedback
        let errorMessage = 'Failed to analyze roof. '
        
        if (functionError.message?.includes('401') || functionError.message?.includes('Unauthorized')) {
          errorMessage += 'Please log in again to continue.'
        } else if (functionError.message?.includes('500')) {
          errorMessage += 'Server error - our team has been notified. Please try again in a few minutes.'
        } else if (functionError.message?.includes('timeout') || functionError.message?.includes('504')) {
          errorMessage += 'Request timed out. The property may be too complex - please try again.'
        } else if (functionError.message?.includes('non-2xx')) {
          errorMessage += 'Service temporarily unavailable. Please try again.'
        } else {
          errorMessage += functionError.message || 'Unknown error occurred.'
        }
        
        throw new Error(errorMessage)
      }
      
      if (!data) {
        throw new Error('No response from measurement service. Please try again.')
      }
      
      if (!data.success) {
        // Extract detailed error from response
        const errorDetail = data.error || data.message || 'Analysis failed'
        throw new Error(`Measurement failed: ${errorDetail}`)
      }

      // Include measurementId in the state so generatePDF can access it
      setMeasurementData({ ...data.data, measurementId: data.measurementId })
      
      if (onMeasurementComplete) {
        onMeasurementComplete(data.measurementId)
      }

    } catch (err: any) {
      console.error('Analysis error:', err)
      
      // Format user-friendly error message
      let displayError = err.message || 'Failed to analyze roof. Please try again.'
      
      // Clean up technical jargon
      displayError = displayError
        .replace(/FunctionsHttpError:/gi, '')
        .replace(/FunctionsFetchError:/gi, '')
        .replace(/Edge Function/gi, 'Service')
        .trim()
      
      setError(displayError)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = () => {
    if (!measurementData || !onSave) return
    
    const eave = measurementData.measurements.linear.eave || 0
    const rake = measurementData.measurements.linear.rake || 0
    const ridge = measurementData.measurements.linear.ridge || 0
    const hip = measurementData.measurements.linear.hip || 0
    const valley = measurementData.measurements.linear.valley || 0
    const perimeter = eave + rake
    const totalArea = measurementData.measurements.totalAreaSqft
    const totalSquares = measurementData.measurements.totalSquares
    const wasteFactor = ((measurementData.measurements.wasteFactor || 1.10) - 1) * 100
    
    const measurements: RoofMeasurements = {
      // New API properties
      totalAreaSqft: totalArea,
      totalSquares: totalSquares,
      perimeterFt: perimeter,
      ridgeFt: ridge,
      hipFt: hip,
      valleyFt: valley,
      eaveFt: eave,
      rakeFt: rake,
      dripEdgeFt: perimeter,
      flashingFt: 0,
      stories: 1,
      
      // Legacy properties
      roofArea: totalArea,
      planArea: totalArea / 1.118, // Approximate plan area
      squares: totalSquares,
      perimeter: perimeter,
      ridge: ridge,
      hip: hip,
      valley: valley,
      eave: eave,
      rake: rake,
      pitch: measurementData.aiAnalysis.pitch || '6/12',
      pitchFactor: 1.118,
      wasteFactor: wasteFactor,
      faceCount: measurementData.aiAnalysis.facetCount || 1
    }
    
    onSave(measurements)
  }

  const generatePDF = async () => {
    if (!measurementData) return

    // Guard against missing measurementId so we don't hit the edge function with "undefined"
    if (!measurementData.measurementId) {
      console.error('generatePDF: missing measurementId on measurementData', measurementData)
      alert('No measurement record was found. Please run "Analyze Roof" again before generating a report.')
      return
    }
    
    try {
      const { data, error } = await supabase.functions.invoke('generate-roof-report', {
        body: {
          measurementId: measurementData.measurementId,
          companyInfo: {
            name: 'PITCH CRM',
            phone: '',
            email: ''
          }
        }
      })

      if (error) throw error
      if (data.success && data.pdfUrl) {
        window.open(data.pdfUrl, '_blank')
      }
    } catch (err) {
      console.error('PDF generation error:', err)
      alert('Failed to generate PDF. Please try again.')
    }
  }

  const getConfidenceBadge = (score: number) => {
    if (score >= 90) return <Badge className="bg-green-500">Excellent</Badge>
    if (score >= 75) return <Badge className="bg-blue-500">Good</Badge>
    if (score >= 60) return <Badge className="bg-yellow-500">Fair</Badge>
    return <Badge className="bg-red-500">Poor</Badge>
  }

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">AI Roof Measurement</h1>
          <p className="text-muted-foreground mt-1">
            Professional-grade measurements powered by artificial intelligence
          </p>
        </div>
      </div>

      {/* Input Card */}
      <Card className="p-6">
        <div className="flex gap-4">
          <div className="flex-1">
            <Input
              placeholder="Enter property address (e.g., 4205 Custer Drive, Valrico, FL)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && analyzeRoof()}
              className="text-lg"
              disabled={loading}
            />
          </div>
          <Button 
            onClick={analyzeRoof} 
            disabled={loading || !address}
            size="lg"
            className="bg-primary hover:bg-primary/90 min-w-[150px]"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Ruler className="mr-2 h-5 w-5" />
                Analyze Roof
              </>
            )}
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </Card>

      {/* Results */}
      {measurementData && (
        <div className="space-y-6">
          {/* Confidence Score */}
          <Card className="p-6 bg-accent/50 border-accent">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Measurement Confidence</h3>
                <p className="text-sm text-muted-foreground mt-1">{measurementData.address}</p>
              </div>
              <div className="text-right">
                <div className="text-4xl font-bold text-primary">
                  {measurementData.confidence.score}%
                </div>
                <div className="mt-1">
                  {getConfidenceBadge(measurementData.confidence.score)}
                </div>
              </div>
            </div>

            {measurementData.confidence.requiresReview && (
              <Alert className="mt-4 bg-yellow-50 border-yellow-200">
                <AlertCircle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  This measurement may benefit from manual review due to complexity or image quality.
                </AlertDescription>
              </Alert>
            )}

            {/* Confidence Factors */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              {Object.entries(measurementData.confidence.factors).map(([key, value]: [string, any]) => (
                <div key={key} className="flex items-start gap-2 text-sm">
                  <CheckCircle className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                  <span className="text-muted-foreground">{value}</span>
                </div>
              ))}
            </div>
          </Card>

          <Tabs defaultValue="diagram" className="w-full">
            <TabsList className="grid w-full grid-cols-6">
              <TabsTrigger value="diagram" className="flex items-center gap-1">
                <Layers className="h-3.5 w-3.5" />
                Diagram
              </TabsTrigger>
              <TabsTrigger value="summary">Summary</TabsTrigger>
              <TabsTrigger value="facets">Facets</TabsTrigger>
              <TabsTrigger value="linear">Linear</TabsTrigger>
              <TabsTrigger value="materials">Materials</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
            </TabsList>

            {/* Roof Diagram Tab - AI Analysis with View Toggle */}
            <TabsContent value="diagram" className="space-y-4">
              <Card className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold">AI Roof Analysis</h3>
                    <p className="text-sm text-muted-foreground">
                      Professional measurements powered by Gemini 2.5 Pro
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex border rounded-lg overflow-hidden">
                      <Button
                        variant={diagramView === 'satellite' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setDiagramView('satellite')}
                        className="rounded-none"
                      >
                        <FileImage className="h-4 w-4 mr-1" />
                        Satellite
                      </Button>
                      <Button
                        variant={diagramView === 'schematic' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setDiagramView('schematic')}
                        className="rounded-none"
                      >
                        <Eye className="h-4 w-4 mr-1" />
                        Schematic
                      </Button>
                    </div>
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      <CheckCircle className="h-3 w-3 mr-1" />
                      AI Analyzed
                    </Badge>
                  </div>
                </div>
                
                {diagramView === 'satellite' ? (
                  <AIRoofSkeletonViewer
                    satelliteImageUrl={measurementData.images?.google?.url || measurementData.images?.mapbox?.url}
                    linearFeatures={measurementData.linearFeatures || []}
                    perimeterWkt={measurementData.perimeterWkt}
                    coordinates={{
                      lat: effectiveLat || 0,
                      lng: effectiveLng || 0
                    }}
                    imageSize={640}
                  />
                ) : (
                  <CleanRoofDiagram
                    facets={measurementData.facets || []}
                    linearFeatures={measurementData.linearFeatures || []}
                    perimeterWkt={measurementData.perimeterWkt}
                    coordinates={{
                      lat: effectiveLat || 0,
                      lng: effectiveLng || 0
                    }}
                    totalArea={measurementData.measurements?.totalAreaSqft}
                    pitch={measurementData.aiAnalysis?.pitch}
                    facetCount={measurementData.aiAnalysis?.facetCount}
                  />
                )}

                {/* Linear measurements summary below diagram */}
                <div className="mt-4 pt-4 border-t">
                  <div className="grid grid-cols-6 gap-3 text-center">
                    <div>
                      <div className="text-xs text-muted-foreground">Ridge</div>
                      <div className="text-lg font-bold text-green-600">
                        {measurementData.measurements?.linear?.ridge?.toFixed(0) || 0} ft
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Hip</div>
                      <div className="text-lg font-bold text-purple-600">
                        {measurementData.measurements?.linear?.hip?.toFixed(0) || 0} ft
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Valley</div>
                      <div className="text-lg font-bold text-red-600">
                        {measurementData.measurements?.linear?.valley?.toFixed(0) || 0} ft
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Eave</div>
                      <div className="text-lg font-bold text-cyan-600">
                        {measurementData.measurements?.linear?.eave?.toFixed(0) || 0} ft
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Rake</div>
                      <div className="text-lg font-bold text-orange-600">
                        {measurementData.measurements?.linear?.rake?.toFixed(0) || 0} ft
                      </div>
                    </div>
                    <div className="bg-muted/50 rounded-lg p-1">
                      <div className="text-xs text-muted-foreground">Perimeter</div>
                      <div className="text-lg font-bold text-foreground">
                        {((measurementData.measurements?.linear?.eave || 0) + (measurementData.measurements?.linear?.rake || 0)).toFixed(0)} ft
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>

            {/* Summary Tab */}
            <TabsContent value="summary" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <Home className="h-8 w-8 text-primary" />
                    <Badge>{measurementData.aiAnalysis.roofType}</Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="text-2xl font-bold">
                      {measurementData.measurements.totalAreaSqft.toFixed(0)} sq ft
                    </div>
                    <div className="text-sm text-muted-foreground">Total Roof Area</div>
                    <div className="text-lg font-semibold text-green-600">
                      {measurementData.measurements.totalSquares.toFixed(1)} squares
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <TrendingUp className="h-8 w-8 text-orange-600" />
                    <Badge variant="outline">{measurementData.aiAnalysis.pitch}</Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="text-2xl font-bold">
                      {measurementData.aiAnalysis.facetCount} facets
                    </div>
                    <div className="text-sm text-muted-foreground">Roof Complexity</div>
                    <div className="text-lg font-semibold capitalize">
                      {measurementData.aiAnalysis.complexity}
                    </div>
                  </div>
                </Card>

                <Card className="p-6">
                  <div className="flex items-center justify-between mb-4">
                    <Ruler className="h-8 w-8 text-purple-600" />
                    <Badge variant="outline">10% waste</Badge>
                  </div>
                  <div className="space-y-2">
                    <div className="text-2xl font-bold">
                      {(measurementData.measurements.totalSquares * 1.10).toFixed(1)}
                    </div>
                    <div className="text-sm text-muted-foreground">Squares w/ Waste</div>
                    <div className="text-lg font-semibold text-purple-600">
                      {Math.ceil(measurementData.measurements.totalSquares * 1.10 * 3)} bundles
                    </div>
                  </div>
                </Card>
              </div>

              {/* Quick Stats */}
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Key Measurements</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-sm text-muted-foreground">Total Eaves</div>
                    <div className="text-xl font-bold">{measurementData.measurements.linear.eave.toFixed(0)} ft</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Rakes</div>
                    <div className="text-xl font-bold">{measurementData.measurements.linear.rake.toFixed(0)} ft</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Hips</div>
                    <div className="text-xl font-bold">{measurementData.measurements.linear.hip.toFixed(0)} ft</div>
                  </div>
                  <div>
                    <div className="text-sm text-muted-foreground">Total Valleys</div>
                    <div className="text-xl font-bold">{measurementData.measurements.linear.valley.toFixed(0)} ft</div>
                  </div>
                </div>
              </Card>
            </TabsContent>

            {/* Facets Tab */}
            <TabsContent value="facets" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Individual Roof Facets</h3>
                <div className="space-y-3">
                  {measurementData.measurements.facets.map((facet: any, index: number) => (
                    <div 
                      key={index}
                      className="border-l-4 pl-4 py-3 bg-muted/50 rounded-r"
                      style={{borderColor: `hsl(${index * 40}, 70%, 50%)`}}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="font-semibold">Facet {facet.facetNumber}</h4>
                        <Badge variant="outline">{facet.pitch}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-4 text-sm">
                        <div>
                          <span className="text-muted-foreground">Area:</span>
                          <span className="font-semibold ml-2">{facet.adjustedAreaSqft.toFixed(0)} sq ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Shape:</span>
                          <span className="font-semibold ml-2 capitalize">{facet.shape}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Eave:</span>
                          <span className="font-semibold ml-2">{facet.edges.eave.toFixed(0)} ft</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Ridge:</span>
                          <span className="font-semibold ml-2">{facet.edges.ridge.toFixed(0)} ft</span>
                        </div>
                      </div>
                      {(facet.features.chimneys > 0 || facet.features.skylights > 0 || facet.features.vents > 0) && (
                        <div className="mt-2 text-sm text-muted-foreground">
                          Features: 
                          {facet.features.chimneys > 0 && ` ${facet.features.chimneys} chimney(s)`}
                          {facet.features.skylights > 0 && ` ${facet.features.skylights} skylight(s)`}
                          {facet.features.vents > 0 && ` ${facet.features.vents} vent(s)`}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            </TabsContent>

            {/* Linear Measurements Tab */}
            <TabsContent value="linear" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Linear Measurements</h3>
                <div className="space-y-4">
                  {Object.entries(measurementData.measurements.linear).map(([key, value]: [string, any]) => (
                    <div key={key} className="flex items-center justify-between border-b pb-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-3 h-3 rounded-full ${
                          key === 'eave' ? 'bg-green-500' :
                          key === 'rake' ? 'bg-yellow-500' :
                          key === 'hip' ? 'bg-blue-500' :
                          key === 'valley' ? 'bg-red-500' :
                          'bg-purple-500'
                        }`} />
                        <span className="font-medium capitalize">{key}s</span>
                      </div>
                      <span className="text-2xl font-bold">{value.toFixed(1)} ft</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-3 border-t-2">
                    <span className="font-bold text-lg">Combined Hips + Ridges</span>
                    <span className="text-2xl font-bold text-primary">
                      {(measurementData.measurements.linear.hip + measurementData.measurements.linear.ridge).toFixed(1)} ft
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-lg">Combined Eaves + Rakes</span>
                    <span className="text-2xl font-bold text-green-600">
                      {(measurementData.measurements.linear.eave + measurementData.measurements.linear.rake).toFixed(1)} ft
                    </span>
                  </div>
                </div>
              </Card>
            </TabsContent>

            {/* Materials Tab */}
            <TabsContent value="materials" className="space-y-4">
              <Card className="p-6">
                <h3 className="text-lg font-semibold mb-4">Material Requirements</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <div className="text-sm text-muted-foreground">Shingle Bundles</div>
                    <div className="text-3xl font-bold text-blue-600">
                      {measurementData.measurements.materials.shingleBundles}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">3 bundles per square</div>
                  </div>

                  <div className="border-l-4 border-green-500 pl-4">
                    <div className="text-sm text-muted-foreground">Underlayment Rolls</div>
                    <div className="text-3xl font-bold text-green-600">
                      {measurementData.measurements.materials.underlaymentRolls}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">400 sq ft per roll</div>
                  </div>

                  <div className="border-l-4 border-purple-500 pl-4">
                    <div className="text-sm text-muted-foreground">Ice & Water Shield</div>
                    <div className="text-3xl font-bold text-purple-600">
                      {measurementData.measurements.materials.iceWaterShieldRolls}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {measurementData.measurements.materials.iceWaterShieldFeet.toFixed(0)} linear feet
                    </div>
                  </div>

                  <div className="border-l-4 border-orange-500 pl-4">
                    <div className="text-sm text-muted-foreground">Drip Edge</div>
                    <div className="text-3xl font-bold text-orange-600">
                      {measurementData.measurements.materials.dripEdgeSheets}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {measurementData.measurements.materials.dripEdgeFeet.toFixed(0)} ft total
                    </div>
                  </div>

                  <div className="border-l-4 border-red-500 pl-4">
                    <div className="text-sm text-muted-foreground">Starter Strip</div>
                    <div className="text-3xl font-bold text-red-600">
                      {measurementData.measurements.materials.starterStripBundles}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {measurementData.measurements.materials.starterStripFeet.toFixed(0)} ft coverage
                    </div>
                  </div>

                  <div className="border-l-4 border-indigo-500 pl-4">
                    <div className="text-sm text-muted-foreground">Hip & Ridge Cap</div>
                    <div className="text-3xl font-bold text-indigo-600">
                      {measurementData.measurements.materials.hipRidgeBundles}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {measurementData.measurements.materials.hipRidgeFeet.toFixed(0)} ft total
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>

            {/* Images Tab */}
            <TabsContent value="images" className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Card className="p-4">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Google Maps Satellite
                  </h4>
                  <img 
                    src={measurementData.images.google.url} 
                    alt="Google Maps view"
                    className="w-full rounded border"
                  />
                  <div className="mt-2 text-sm text-muted-foreground">
                    Resolution: {measurementData.images.google.resolution}
                  </div>
                </Card>

                <Card className="p-4">
                  <h4 className="font-semibold mb-2 flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Mapbox Satellite (High-Res)
                  </h4>
                  <img 
                    src={measurementData.images.mapbox.url} 
                    alt="Mapbox view"
                    className="w-full rounded border"
                  />
                  <div className="mt-2 text-sm text-muted-foreground">
                    Resolution: {measurementData.images.mapbox.resolution}
                  </div>
                </Card>
              </div>

              {measurementData.solarApiData.available && (
                <Card className="p-6 bg-accent/50">
                  <h4 className="font-semibold mb-3 text-foreground">Google Solar API Validation</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Building Footprint</div>
                      <div className="text-2xl font-bold text-foreground">
                        {measurementData.solarApiData.buildingFootprint?.toFixed(0)} sq ft
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Roof Segments Detected</div>
                      <div className="text-2xl font-bold text-foreground">
                        {measurementData.solarApiData.roofSegments}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">API Status</div>
                      <Badge className="bg-primary">Available</Badge>
                    </div>
                  </div>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* Action Buttons */}
          <div className="flex gap-4">
            <Button size="lg" className="flex-1" onClick={handleSave}>
              Save Measurement
            </Button>
            <Button size="lg" variant="outline" className="flex-1" onClick={generatePDF}>
              <Download className="mr-2 h-5 w-5" />
              Generate PDF Report
            </Button>
            {onCancel && (
              <Button size="lg" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default RoofMeasurementTool
