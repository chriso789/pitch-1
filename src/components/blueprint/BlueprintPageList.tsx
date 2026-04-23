import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function BlueprintPageList({
  pages,
  onExtractGeometry,
}: {
  pages: any[];
  onExtractGeometry: (pageId: string) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pages ({pages.length})</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Sheet</th>
                <th className="py-2 pr-3">Scale</th>
                <th className="py-2 pr-3">Review</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pages.map((page) => (
                <tr key={page.id}>
                  <td className="py-2 pr-3">{page.page_number}</td>
                  <td className="py-2 pr-3">
                    <Badge variant="outline">{page.page_type}</Badge>
                  </td>
                  <td className="py-2 pr-3">{page.sheet_number || page.sheet_name || page.page_title || "—"}</td>
                  <td className="py-2 pr-3">{page.scale_text || "—"}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={page.review_status === "approved" ? "default" : page.review_status === "rejected" ? "destructive" : "secondary"}>
                      {page.review_status || "pending"}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/blueprints/page/${page.id}`}>Review</Link>
                      </Button>
                      {page.page_type === "roof_plan" && (
                        <Button size="sm" variant="ghost" onClick={() => onExtractGeometry(page.id)}>
                          Extract Geometry
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
