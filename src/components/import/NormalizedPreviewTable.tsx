import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function NormalizedPreviewTable({ preview }: { preview: any[] }) {
  if (!preview?.length) return null;
  return (
    <Card>
      <CardHeader><CardTitle>Normalized Preview ({preview.length})</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source ID</TableHead>
              <TableHead>Raw</TableHead>
              <TableHead>Normalized</TableHead>
              <TableHead>Confidence</TableHead>
              <TableHead>Warnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.map((row, i) => (
              <TableRow key={i}>
                <TableCell className="text-xs">{row.source_record_id ?? "—"}</TableCell>
                <TableCell><pre className="text-xs max-w-xs overflow-auto">{JSON.stringify(row.raw, null, 1)}</pre></TableCell>
                <TableCell><pre className="text-xs max-w-xs overflow-auto">{JSON.stringify(row.normalized, null, 1)}</pre></TableCell>
                <TableCell>{(row.confidence * 100).toFixed(0)}%</TableCell>
                <TableCell className="text-amber-600 text-xs">{(row.warnings ?? []).join("; ")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
