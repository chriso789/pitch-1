import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface MeasurementSummaryPanelProps {
  measurement: any;
  tags: Record<string, any>;
  confidence: {
    score: number;
    label: string;
  };
}

export function MeasurementSummaryPanel({
  measurement,
  tags,
  confidence,
}: MeasurementSummaryPanelProps) {
  // Linear features
  const ridge = tags['lf.ridge'] || 0;
  const hip = tags['lf.hip'] || 0;
  const valley = tags['lf.valley'] || 0;
  const eave = tags['lf.eave'] || 0;
  const rake = tags['lf.rake'] || 0;
  const perimeter = tags['lf.perimeter'] || 0;
  
  // Penetrations
  const pipeVents = tags['pen.pipe_vent'] || 0;
  const skylights = tags['pen.skylight'] || 0;
  const chimneys = tags['pen.chimney'] || 0;
  const hvac = tags['pen.hvac'] || 0;
  const other = tags['pen.other'] || 0;
  const totalPenetrations = tags['pen.total'] || 0;
  
  // Roof age
  const roofAge = tags['age.years'] || 0;
  const roofAgeSource = tags['age.source'] || '';
  const step = tags['lf.step'] || 0;

  // Area calculations
  const planArea = tags['roof.plan_sqft'] || 0;
  const roofSquares = tags['roof.squares'] || 0;
  const faceCount = tags['roof.faces_count'] || 0;
  const pitchFactor = tags['roof.pitch_factor'] || 1.054;
  const wastePct = tags['roof.waste_pct'] || 12;

  // Material calculations (simplified)
  const shingleBundles = Math.ceil(roofSquares * 3);
  const ridgeCapBundles = Math.ceil((ridge + hip) / 33);
  const valleyRolls = Math.ceil(valley / 50);
  const dripEdgeSticks = Math.ceil((eave + rake) / 10);

  // Feature validation
  const hasRidge = ridge > 0;
  const hasHip = hip > 0;
  const hasValley = valley > 0;
  const hasEave = eave > 0;
  const hasRake = rake > 0;
  const hasFaces = faceCount > 0;

  const FeatureRow = ({ label, value, isPresent }: { label: string; value: number; isPresent: boolean }) => (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <div className="flex items-center gap-2">
        {isPresent ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
        ) : (
          <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className={isPresent ? 'text-foreground' : 'text-muted-foreground'}>{label}:</span>
      </div>
      <span className={`font-medium ${isPresent ? 'text-foreground' : 'text-muted-foreground'}`}>
        {value.toFixed(0)} ft
      </span>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div>
        <h3 className="font-semibold mb-3">Measurement Summary</h3>
        
        {/* Overview Cards */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <Card className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{planArea.toFixed(0)}</div>
            <div className="text-xs text-muted-foreground mt-1">Plan Area (sq ft)</div>
          </Card>
          <Card className="p-3 text-center">
            <div className="text-2xl font-bold text-primary">{roofSquares.toFixed(1)}</div>
            <div className="text-xs text-muted-foreground mt-1">Squares</div>
          </Card>
        </div>
      </div>

      <Separator />

      {/* Linear Features */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Linear Features</h4>
        <div className="space-y-0 text-sm">
          <FeatureRow label="Ridge" value={ridge} isPresent={hasRidge} />
          <FeatureRow label="Hip" value={hip} isPresent={hasHip} />
          <FeatureRow label="Valley" value={valley} isPresent={hasValley} />
          <FeatureRow label="Eave" value={eave} isPresent={hasEave} />
          <FeatureRow label="Rake" value={rake} isPresent={hasRake} />
          {step > 0 && <FeatureRow label="Step" value={step} isPresent={step > 0} />}
        </div>

        {!hasRidge && !hasHip && (
          <div className="mt-2 p-2 bg-warning/10 border border-warning/20 rounded text-xs">
            <AlertCircle className="h-3 w-3 inline mr-1" />
            <span className="text-warning">
              No ridge or hip lines detected. Add them for accurate calculations.
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Roof Facets */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Roof Facets</h4>
        <div className="flex items-center justify-between text-sm py-2">
          <div className="flex items-center gap-2">
            {hasFaces ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span>Facet Count:</span>
          </div>
          <span className="font-medium">{faceCount}</span>
        </div>
        <div className="flex items-center justify-between text-sm py-2">
          <span className="text-muted-foreground">Pitch Factor:</span>
          <span className="font-medium">{pitchFactor.toFixed(3)}</span>
        </div>
        <div className="flex items-center justify-between text-sm py-2">
          <span className="text-muted-foreground">Waste Factor:</span>
          <span className="font-medium">{wastePct}%</span>
        </div>
      </div>

      <Separator />

      {/* Material Quantities */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Material Quantities</h4>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Shingle Bundles:</span>
            <span className="font-medium">{shingleBundles} bundles</span>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Ridge Cap:</span>
            <Badge variant={ridgeCapBundles === 0 ? 'destructive' : 'default'} className="text-xs">
              {ridgeCapBundles} bundles
            </Badge>
          </div>
          <div className="flex justify-between py-1.5 border-b">
            <span className="text-muted-foreground">Valley Roll:</span>
            <Badge variant={valleyRolls === 0 ? 'secondary' : 'default'} className="text-xs">
              {valleyRolls} rolls
            </Badge>
          </div>
          <div className="flex justify-between py-1.5">
            <span className="text-muted-foreground">Drip Edge:</span>
            <span className="font-medium">{dripEdgeSticks} sticks</span>
          </div>
        </div>

        {ridgeCapBundles === 0 && (
          <div className="mt-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs">
            <AlertCircle className="h-3 w-3 inline mr-1" />
            <span className="text-destructive">
              Add ridge/hip lines to calculate ridge cap materials
            </span>
          </div>
        )}
      </div>

      <Separator />

      {/* Penetrations */}
      {totalPenetrations > 0 && (
        <>
          <div>
            <h4 className="text-sm font-semibold mb-2">Roof Penetrations</h4>
            <div className="space-y-2 text-sm">
              {pipeVents > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Pipe Vents:</span>
                  <span className="font-medium">{pipeVents}</span>
                </div>
              )}
              {skylights > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Skylights:</span>
                  <span className="font-medium">{skylights}</span>
                </div>
              )}
              {chimneys > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">Chimneys:</span>
                  <span className="font-medium">{chimneys}</span>
                </div>
              )}
              {hvac > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-muted-foreground">HVAC Units:</span>
                  <span className="font-medium">{hvac}</span>
                </div>
              )}
              {other > 0 && (
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Other:</span>
                  <span className="font-medium">{other}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-t-2 font-semibold">
                <span>Total Penetrations:</span>
                <Badge variant="default">{totalPenetrations}</Badge>
              </div>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Roof Age */}
      {roofAge > 0 && (
        <>
          <div>
            <h4 className="text-sm font-semibold mb-2">Roof Age</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between py-1.5 border-b">
                <span className="text-muted-foreground">Age:</span>
                <span className="font-medium">{roofAge} years</span>
              </div>
              {roofAgeSource && (
                <div className="flex justify-between py-1.5">
                  <span className="text-muted-foreground">Source:</span>
                  <Badge variant="secondary" className="text-xs capitalize">
                    {roofAgeSource}
                  </Badge>
                </div>
              )}
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Confidence Indicator */}
      <div>
        <h4 className="text-sm font-semibold mb-2">Data Quality</h4>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Confidence Level:</span>
            <Badge variant={confidence.score >= 4 ? 'default' : confidence.score >= 3 ? 'secondary' : 'destructive'}>
              {confidence.label}
            </Badge>
          </div>
          {confidence.score < 4 && (
            <p className="text-muted-foreground mt-2">
              {confidence.score < 3 
                ? 'Add missing roof features to improve measurement accuracy'
                : 'Good data quality. Consider adding more details if available.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
