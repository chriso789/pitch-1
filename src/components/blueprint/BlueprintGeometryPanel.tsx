import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function BlueprintGeometryPanel({
  geometry,
  dimensions,
  pitchNotes,
}: {
  geometry: any[];
  dimensions: any[];
  pitchNotes: any[];
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Geometry ({geometry.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {geometry.length === 0 ? (
            <p className="text-muted-foreground">No geometry extracted.</p>
          ) : (
            geometry.map((g) => (
              <div key={g.id} className="flex items-center justify-between border-b pb-1">
                <span>
                  <Badge variant="outline">{g.class_name || g.geometry_class}</Badge>
                  <span className="ml-2 text-muted-foreground">{g.geometry_type || ""}</span>
                </span>
                {g.length_ft && <span>{Number(g.length_ft).toFixed(1)} ft</span>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dimensions ({dimensions.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {dimensions.length === 0 ? (
            <p className="text-muted-foreground">No dimensions extracted.</p>
          ) : (
            dimensions.map((d) => (
              <div key={d.id} className="flex justify-between border-b pb-1">
                <span>{d.label_text}</span>
                {d.normalized_feet != null && <span>{Number(d.normalized_feet).toFixed(2)} ft</span>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pitch notes ({pitchNotes.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {pitchNotes.length === 0 ? (
            <p className="text-muted-foreground">No pitch notes.</p>
          ) : (
            pitchNotes.map((p) => (
              <div key={p.id} className="flex justify-between border-b pb-1">
                <span>{p.pitch_text}</span>
                {p.normalized_rise != null && p.normalized_run != null && (
                  <span>
                    {p.normalized_rise}/{p.normalized_run}
                  </span>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
