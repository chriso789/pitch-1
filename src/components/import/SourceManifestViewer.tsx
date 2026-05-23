import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function SourceManifestViewer({ manifest }: { manifest: any }) {
  if (!manifest) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Source Manifest — {manifest.source_system}</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>Confidence: <Badge>{(manifest.detected_confidence * 100).toFixed(0)}%</Badge></div>
        <div>
          <strong>Detected entities</strong>
          <pre className="bg-muted p-2 rounded text-xs">{JSON.stringify(manifest.detected_entities, null, 2)}</pre>
        </div>
        <div>
          <strong>Files ({manifest.files?.length ?? 0})</strong>
          <ul className="text-xs list-disc ml-5">
            {(manifest.files ?? []).slice(0, 20).map((f: any, i: number) => <li key={i}>{f.name}</li>)}
          </ul>
        </div>
        {manifest.warnings?.length > 0 && (
          <div className="text-amber-600 text-xs">
            <strong>Warnings:</strong>
            <ul className="list-disc ml-5">{manifest.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
