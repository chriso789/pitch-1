import { MeasurementWorkflow } from '@/components/measurements/MeasurementWorkflow';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { BackButton } from '@/shared/components/BackButton';
import { Ruler } from 'lucide-react';

export default function MeasurementWorkflowDemo() {
  // Demo with sample coordinates (Denver, CO area)
  const demoPropertyId = 'demo-property-123';
  const demoPipelineId = 'demo-pipeline-456';
  const demoLat = 39.7392;
  const demoLng = -104.9903;
  const demoAddress = '1600 Broadway, Denver, CO 80202';

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <BackButton />
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Ruler className="h-8 w-8" />
              Measurement Workflow
            </h1>
            <p className="text-muted-foreground">
              Streamlined process: Pull → Verify → Adjust → Save → Estimate
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Professional Measurement System</CardTitle>
            <CardDescription>
              Complete workflow for pulling, verifying, and using roof measurements in estimates. 
              This system rivals EagleView with auto-tracking, version history, and one-click estimate generation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h3 className="font-semibold mb-2">Demo Property Details</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Address:</span> {demoAddress}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Coordinates:</span> {demoLat.toFixed(4)}, {demoLng.toFixed(4)}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <MeasurementWorkflow
          propertyId={demoPropertyId}
          pipelineEntryId={demoPipelineId}
          lat={demoLat}
          lng={demoLng}
          address={demoAddress}
          onComplete={() => {
            console.log('Workflow completed!');
          }}
        />

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6">
            <h3 className="font-semibold mb-3 flex items-center gap-2">
              <Ruler className="h-4 w-4" />
              Key Features
            </h3>
            <ul className="space-y-2 text-sm">
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                <span><strong>Progress Tracking:</strong> Visual stepper shows exactly where you are in the workflow</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                <span><strong>Auto-Save Checkpoints:</strong> Measurements saved at each step prevent data loss</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                <span><strong>Version History:</strong> Compare measurements across time, revert to previous versions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                <span><strong>One-Click Estimate:</strong> Auto-populate estimate builder with verified measurements</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-primary">✓</span>
                <span><strong>Interactive Editing:</strong> Drag facet corners, snap lines to edges, detect roof type automatically</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
