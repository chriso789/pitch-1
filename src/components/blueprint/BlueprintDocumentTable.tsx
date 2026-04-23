import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { extractBlueprintSpecs, linkBlueprintDetails } from "@/integrations/blueprintApi";
import { toast } from "@/hooks/use-toast";

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  uploaded: "secondary",
  classifying: "secondary",
  extracting_geometry: "secondary",
  extracting_specs: "secondary",
  linking_details: "secondary",
  ready_for_review: "default",
  approved: "default",
  rejected: "destructive",
  failed: "destructive",
};

export function BlueprintDocumentTable({
  documents,
  loading,
  onRefresh,
}: {
  documents: any[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent uploads</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : documents.length === 0 ? (
          <p className="text-muted-foreground">No blueprints uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b text-muted-foreground">
                  <th className="py-2 pr-3">File</th>
                  <th className="py-2 pr-3">Address</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Pages</th>
                  <th className="py-2 pr-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    <td className="py-2 pr-3 font-medium">{doc.file_name}</td>
                    <td className="py-2 pr-3">{doc.property_address || "—"}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={STATUS_VARIANT[doc.status] || "outline"}>
                        {String(doc.status).split("_").join(" ")}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">{doc.page_count}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" variant="outline">
                          <Link to={`/blueprints/${doc.id}`}>Open</Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await extractBlueprintSpecs(doc.id);
                              toast({ title: "Specs extraction queued" });
                              onRefresh();
                            } catch (e: any) {
                              toast({ title: "Failed", description: e.message, variant: "destructive" });
                            }
                          }}
                        >
                          Extract Specs
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await linkBlueprintDetails(doc.id);
                              toast({ title: "Detail linking queued" });
                              onRefresh();
                            } catch (e: any) {
                              toast({ title: "Failed", description: e.message, variant: "destructive" });
                            }
                          }}
                        >
                          Link Details
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
