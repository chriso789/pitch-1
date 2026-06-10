import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { rasterizeBlueprintPages } from "@/integrations/blueprintApi";
import { Pencil, RefreshCw, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const TRADE_OPTIONS: { value: string; label: string }[] = [
  { value: "roofing", label: "Roofing" },
  { value: "exterior_walls_siding", label: "Walls & Siding" },
  { value: "gutters_fascia_trim", label: "Gutters / Fascia / Trim" },
  { value: "windows_doors", label: "Windows & Doors" },
  { value: "framing", label: "Framing (Structural)" },
  { value: "interior_framing", label: "Interior Framing" },
  { value: "drywall", label: "Drywall" },
  { value: "insulation", label: "Insulation" },
  { value: "flashing", label: "Flashing" },
  { value: "stucco", label: "Stucco / EIFS" },
  { value: "flooring", label: "Flooring" },
  { value: "paint_coatings", label: "Paint & Coatings" },
  { value: "concrete", label: "Concrete" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC / Mechanical" },
  { value: "fire_protection", label: "Fire Protection" },
  { value: "millwork", label: "Millwork / Casework" },
  { value: "none", label: "— Not quote-able —" },
];

// Sub-type → human label and matching trade default.
const SUBTYPE_LABELS: Record<string, string> = {
  architectural: "Architectural",
  interior_framing: "Interior Framing",
  structural_framing: "Structural Framing",
  drywall: "Drywall",
  interior_finishes: "Interior Finishes",
  rcp_ceiling: "Reflected Ceiling",
  flashing: "Flashing",
  stucco: "Stucco",
  siding: "Siding",
  roofing: "Roofing",
  waterproofing: "Waterproofing",
  insulation: "Insulation",
  millwork: "Millwork",
  casework: "Casework",
  door_schedule: "Door Schedule",
  window_schedule: "Window Schedule",
  mechanical: "Mechanical",
  electrical: "Electrical",
  plumbing: "Plumbing",
  fire_protection: "Fire Protection",
  civil: "Civil",
  landscape: "Landscape",
  demolition: "Demolition",
};

const SUBTYPE_TRADE_MAP: Record<string, string> = {
  interior_framing: "interior_framing",
  structural_framing: "framing",
  drywall: "drywall",
  flashing: "flashing",
  stucco: "stucco",
  siding: "exterior_walls_siding",
  roofing: "roofing",
  insulation: "insulation",
  millwork: "millwork",
  casework: "millwork",
  mechanical: "hvac",
  electrical: "electrical",
  plumbing: "plumbing",
  fire_protection: "fire_protection",
};

export function guessTradeFromPage(page: any): string {
  const sub = String(page?.page_subtype || "").toLowerCase();
  if (sub && SUBTYPE_TRADE_MAP[sub]) return SUBTYPE_TRADE_MAP[sub];
  const t = String(page?.page_type || "").toLowerCase();
  const sheet = String(page?.sheet_number || page?.sheet_name || "").toUpperCase();
  if (t.includes("roof")) return "roofing";
  if (t.includes("framing")) return "framing";
  if (t.includes("elevation") || t.includes("exterior")) return "exterior_walls_siding";
  if (t.includes("floor")) return "flooring";
  if (sheet.startsWith("E-") || sheet.startsWith("E")) return "electrical";
  if (sheet.startsWith("P-") || sheet.startsWith("P")) return "plumbing";
  if (sheet.startsWith("M-") || sheet.startsWith("M")) return "hvac";
  if (t.includes("section")) return "framing";
  return "none";
}

function useSignedImageUrl(imagePath: string | null | undefined) {
  const [url, setUrl] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    setUrl("");
    if (!imagePath) return;
    supabase.storage
      .from("blueprint-pages")
      .createSignedUrl(imagePath, 60 * 60)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => { cancelled = true; };
  }, [imagePath]);
  return url;
}

export function BlueprintPageList({
  pages,
  selected,
  onToggle,
  onToggleAll,
  trades,
  onTradeChange,
  onExtractGeometry,
  onPagesUpdated,
}: {
  pages: any[];
  selected: Record<string, boolean>;
  onToggle: (pageId: string, value: boolean) => void;
  onToggleAll: (value: boolean) => void;
  trades: Record<string, string>;
  onTradeChange: (pageId: string, trade: string) => void;
  onExtractGeometry: (pageId: string) => Promise<void>;
  onPagesUpdated?: () => void;
}) {
  const allSelected = pages.length > 0 && pages.every((p) => selected[p.id]);
  const someSelected = pages.some((p) => selected[p.id]);
  const [previewPage, setPreviewPage] = useState<any | null>(null);
  const [editingScale, setEditingScale] = useState<Record<string, boolean>>({});
  const [scaleEdits, setScaleEdits] = useState<Record<string, string>>({});
  const [renderingPage, setRenderingPage] = useState<Record<string, boolean>>({});

  const previewUrl = useSignedImageUrl(previewPage?.image_path);

  async function saveScale(page: any) {
    const next = (scaleEdits[page.id] ?? "").trim();
    if (next === (page.scale_text || "")) {
      setEditingScale((s) => ({ ...s, [page.id]: false }));
      return;
    }
    const { error } = await supabase
      .from("plan_pages")
      .update({ scale_text: next || null, scale_source: "manual" })
      .eq("id", page.id);
    if (error) {
      toast({ title: "Failed to save scale", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Scale saved" });
      onPagesUpdated?.();
    }
    setEditingScale((s) => ({ ...s, [page.id]: false }));
  }

  async function renderSinglePage(page: any) {
    setRenderingPage((r) => ({ ...r, [page.id]: true }));
    try {
      await rasterizeBlueprintPages({ page_id: page.id, force: true });
      toast({ title: "Page rendered" });
      onPagesUpdated?.();
    } catch (e: any) {
      toast({ title: "Render failed", description: e.message, variant: "destructive" });
    } finally {
      setRenderingPage((r) => ({ ...r, [page.id]: false }));
    }
  }

  const previewTitle = useMemo(() => {
    if (!previewPage) return "";
    return [
      `Page ${previewPage.page_number}`,
      previewPage.sheet_number || previewPage.sheet_name,
      previewPage.page_title,
    ]
      .filter(Boolean)
      .join(" — ");
  }, [previewPage]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pages ({pages.length})</CardTitle>
        <p className="text-xs text-muted-foreground">
          Tick the pages you want to quote, then pick the trade for each. The system will build a
          per-page breakdown so trades and measurements never get merged together.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b text-muted-foreground">
                <th className="py-2 pr-3 w-8">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(v) => onToggleAll(Boolean(v))}
                    aria-label="Select all pages"
                  />
                </th>
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Sheet</th>
                <th className="py-2 pr-3">Page name / type</th>
                <th className="py-2 pr-3">Trade to quote</th>
                <th className="py-2 pr-3">Scale</th>
                <th className="py-2 pr-3">Review</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pages.map((page) => {
                const trade = trades[page.id] ?? guessTradeFromPage(page);
                const isEditing = !!editingScale[page.id];
                const scaleVal = scaleEdits[page.id] ?? (page.scale_text || "");
                const subtype = page.page_subtype ? SUBTYPE_LABELS[page.page_subtype] : null;
                const isRendering = !!renderingPage[page.id];
                const hasImage = !!page.image_path;
                return (
                  <tr key={page.id}>
                    <td className="py-2 pr-3">
                      <Checkbox
                        checked={!!selected[page.id]}
                        onCheckedChange={(v) => onToggle(page.id, Boolean(v))}
                        aria-label={`Select page ${page.page_number}`}
                      />
                    </td>
                    <td className="py-2 pr-3">{page.page_number}</td>
                    <td className="py-2 pr-3">
                      <div className="font-mono text-xs font-semibold">
                        {page.sheet_number || page.sheet_name || "—"}
                      </div>
                    </td>
                    <td className="py-2 pr-3 max-w-[260px]">
                      <div className="font-medium truncate" title={page.page_title || ""}>
                        {page.page_title || (
                          <span className="text-muted-foreground italic">No title detected</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="outline" className="text-[10px]">
                          {String(page.page_type || "unknown").replace(/_/g, " ")}
                        </Badge>
                        {subtype && (
                          <Badge variant="secondary" className="text-[10px]">
                            {subtype}
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <Select
                        value={trade}
                        onValueChange={(v) => onTradeChange(page.id, v)}
                      >
                        <SelectTrigger className="h-8 w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRADE_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-3">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={scaleVal}
                          placeholder='1/4" = 1&apos;-0"'
                          className="h-8 w-32"
                          onChange={(e) =>
                            setScaleEdits((s) => ({ ...s, [page.id]: e.target.value }))
                          }
                          onBlur={() => saveScale(page)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                            if (e.key === "Escape") setEditingScale((s) => ({ ...s, [page.id]: false }));
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span className={page.scale_text ? "font-mono text-xs" : "text-xs text-muted-foreground"}>
                            {page.scale_text || "—"}
                          </span>
                          {page.scale_source && page.scale_text && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0">
                              {page.scale_source === "ai" ? "AI" : page.scale_source === "pdf_text" ? "PDF" : "manual"}
                            </Badge>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-50 group-hover:opacity-100"
                            onClick={() => {
                              setScaleEdits((s) => ({ ...s, [page.id]: page.scale_text || "" }));
                              setEditingScale((s) => ({ ...s, [page.id]: true }));
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge
                        variant={
                          page.review_status === "approved"
                            ? "default"
                            : page.review_status === "rejected"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {page.review_status || "pending"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setPreviewPage(page)}
                        >
                          Preview
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/blueprints/page/${page.id}`}>Review</Link>
                        </Button>
                        {!hasImage && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={isRendering}
                            onClick={() => renderSinglePage(page)}
                          >
                            {isRendering ? (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3 w-3 mr-1" />
                            )}
                            Render
                          </Button>
                        )}
                        {page.page_type === "roof_plan" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onExtractGeometry(page.id)}
                          >
                            Extract Geometry
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!previewPage} onOpenChange={(o) => !o && setPreviewPage(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewTitle || "Blueprint page"}</DialogTitle>
            {previewPage && (
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground pt-1">
                <Badge variant="outline">{previewPage.page_type}</Badge>
                {previewPage.page_subtype && SUBTYPE_LABELS[previewPage.page_subtype] && (
                  <Badge variant="secondary">{SUBTYPE_LABELS[previewPage.page_subtype]}</Badge>
                )}
                {previewPage.scale_text && <span>Scale: {previewPage.scale_text}</span>}
              </div>
            )}
          </DialogHeader>
          <div className="bg-muted/30 rounded-md overflow-hidden max-h-[70vh] flex flex-col items-center justify-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={previewTitle}
                className="max-h-[70vh] w-auto object-contain"
              />
            ) : (
              <div className="p-8 text-center space-y-3">
                <p className="text-muted-foreground text-sm">
                  No rendered preview image for this page yet.
                </p>
                {previewPage && (
                  <Button
                    size="sm"
                    onClick={() => renderSinglePage(previewPage)}
                    disabled={!!renderingPage[previewPage.id]}
                  >
                    {renderingPage[previewPage.id] ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4 mr-2" />
                    )}
                    Render this page now
                  </Button>
                )}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
