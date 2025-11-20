import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, CheckCircle, AlertTriangle, Wrench, Diamond } from 'lucide-react';

export function MeasurementSystemLimitations() {
  return (
    <Alert>
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Measurement System Capabilities</AlertTitle>
      <AlertDescription className="space-y-3 mt-2">
        <div>
          <p className="font-semibold flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            Google Solar API (Free - $0)
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm mt-1 ml-6">
            <li>✅ Building footprint polygon</li>
            <li>✅ Aggregate roof area and pitch</li>
            <li>✅ Linear features (ridge, hip, valley, eave, rake)</li>
            <li>✅ Penetrations detection</li>
            <li className="text-yellow-600">⚠️ Aggregate data - all facets share building outline</li>
            <li className="text-yellow-600">⚠️ No individual facet boundary geometries</li>
          </ul>
        </div>
        
        <div>
          <p className="font-semibold flex items-center gap-2">
            <CheckCircle className="h-4 w-4 text-green-600" />
            Visualization System
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm mt-1 ml-6">
            <li>✅ Mapbox satellite imagery with measurement overlays</li>
            <li>✅ Color-coded linear features (ridge/hip/valley)</li>
            <li>✅ Automatic fallback to Google Maps if Mapbox unavailable</li>
            <li>✅ Manual zoom controls (-1 to +2) and pan controls</li>
            <li>✅ Annotation system (markers, notes, damage indicators)</li>
          </ul>
        </div>
        
        <div>
          <p className="font-semibold flex items-center gap-2">
            <Wrench className="h-4 w-4 text-blue-600" />
            For Precise Facet Boundaries
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm mt-1 ml-6">
            <li>🛠️ Use SimpleMeasurementCanvas to manually draw/split facets</li>
            <li>🛠️ Use Facet Splitter tool in verification dialog</li>
            <li className="flex items-center gap-1">
              <Diamond className="h-3 w-3" />
              Premium providers (EagleView $8, Nearmap $15) for complex jobs
            </li>
          </ul>
        </div>
        
        <div className="mt-3 p-2 bg-muted rounded-md">
          <p className="text-xs text-muted-foreground">
            <strong>Expected Accuracy:</strong> 95%+ for shingles, ridge cap, drip edge | 90%+ for ice & water shield, valley material.
            Google Solar provides aggregate measurements sufficient for material quantity calculations.
          </p>
        </div>
      </AlertDescription>
    </Alert>
  );
}
