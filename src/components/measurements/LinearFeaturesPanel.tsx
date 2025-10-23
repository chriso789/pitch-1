import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Ruler, Package } from "lucide-react";

interface LinearFeaturesPanelProps {
  tags: Record<string, any>;
  loading?: boolean;
}

export function LinearFeaturesPanel({ tags, loading }: LinearFeaturesPanelProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">Loading measurements...</div>
        </CardContent>
      </Card>
    );
  }

  if (!tags || Object.keys(tags).length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="text-center text-muted-foreground">No measurement data available</div>
        </CardContent>
      </Card>
    );
  }

  // Extract linear features
  const ridge = tags['lf.ridge'] || 0;
  const hip = tags['lf.hip'] || 0;
  const valley = tags['lf.valley'] || 0;
  const eave = tags['lf.eave'] || 0;
  const rake = tags['lf.rake'] || 0;
  const step = tags['lf.step'] || 0;

  // Calculate material quantities
  const roofSquares = tags['roof.squares'] || 0;
  const shingleBundles = tags['bundles.shingles'] || Math.ceil(roofSquares * 3);
  const ridgeCap = tags['bundles.ridge_cap'] || Math.ceil((ridge + hip) / 33);
  const valleyRoll = tags['rolls.valley'] || Math.ceil(valley / 50);
  const dripEdge = tags['sticks.drip_edge'] || Math.ceil((eave + rake) / 10);

  const LinearFeature = ({ label, value }: { label: string; value: number }) => (
    <div className="space-y-1">
      <div className="text-2xl font-bold">{Math.round(value)} ft</div>
      <div className="text-sm text-muted-foreground uppercase tracking-wide">{label}</div>
    </div>
  );

  const MaterialItem = ({ label, value, unit, autoCalc }: { label: string; value: number; unit: string; autoCalc?: boolean }) => (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}:</span>
      <div className="flex items-center gap-2">
        <span className="font-semibold">{value} {unit}</span>
        {autoCalc && <Badge variant="secondary" className="text-xs">Auto-calc</Badge>}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ruler className="h-5 w-5" />
            Linear Features
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-6">
            <LinearFeature label="Ridge" value={ridge} />
            <LinearFeature label="Hip" value={hip} />
            <LinearFeature label="Valley" value={valley} />
            <LinearFeature label="Eave" value={eave} />
            <LinearFeature label="Rake" value={rake} />
            <LinearFeature label="Step" value={step} />
          </div>
        </CardContent>
      </Card>

      {/* Penetrations Card */}
      {(tags['pen.total'] > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              🔧 Roof Penetrations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {tags['pen.pipe_vent'] > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-sm text-muted-foreground">Pipe Vents:</span>
                  <span className="font-semibold">{tags['pen.pipe_vent']}</span>
                </div>
              )}
              {tags['pen.skylight'] > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-sm text-muted-foreground">Skylights:</span>
                  <span className="font-semibold">{tags['pen.skylight']}</span>
                </div>
              )}
              {tags['pen.chimney'] > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-sm text-muted-foreground">Chimneys:</span>
                  <span className="font-semibold">{tags['pen.chimney']}</span>
                </div>
              )}
              {tags['pen.hvac'] > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-sm text-muted-foreground">HVAC Units:</span>
                  <span className="font-semibold">{tags['pen.hvac']}</span>
                </div>
              )}
              {tags['pen.other'] > 0 && (
                <div className="flex justify-between py-1.5 border-b">
                  <span className="text-sm text-muted-foreground">Other:</span>
                  <span className="font-semibold">{tags['pen.other']}</span>
                </div>
              )}
              <div className="flex justify-between py-2 border-t-2 font-bold">
                <span>Total:</span>
                <Badge variant="default">{tags['pen.total']}</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Roof Age Card */}
      {tags['age.years'] > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              📅 Roof Age
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b">
                <span className="text-sm text-muted-foreground">Age:</span>
                <span className="font-semibold">{tags['age.years']} years</span>
              </div>
              {tags['age.source'] && (
                <div className="flex justify-between py-1.5">
                  <span className="text-sm text-muted-foreground">Source:</span>
                  <Badge variant="secondary" className="capitalize">{tags['age.source']}</Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Material Quantities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            <MaterialItem label="Shingle Bundles" value={shingleBundles} unit="bundles" />
            <MaterialItem label="Ridge Cap" value={ridgeCap} unit="bundles" autoCalc={!tags['bundles.ridge_cap']} />
            <MaterialItem label="Valley Roll" value={valleyRoll} unit="rolls" autoCalc={!tags['rolls.valley']} />
            <MaterialItem label="Drip Edge" value={dripEdge} unit="sticks" autoCalc={!tags['sticks.drip_edge']} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
