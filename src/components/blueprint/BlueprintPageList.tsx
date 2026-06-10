import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
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
  { value: "framing", label: "Framing" },
  { value: "drywall", label: "Drywall" },
  { value: "insulation", label: "Insulation" },
  { value: "flooring", label: "Flooring" },
  { value: "paint_coatings", label: "Paint & Coatings" },
  { value: "concrete", label: "Concrete" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing", label: "Plumbing" },
  { value: "hvac", label: "HVAC" },
  { value: "none", label: "— Not quote-able —" },
];

export function guessTradeFromPage(page: any): string {
  const t = String(page?.page_type || "").toLowerCase();
  const sheet = String(page?.sheet_number || page?.sheet_name || "").toUpperCase();
  if (t.includes("roof")) return "roofing";
  if (t.includes("framing")) return "framing";
  if (t.includes("elevation") || t.includes("exterior")) return "exterior_walls_siding";
  if (t.includes("floor")) return "flooring";
  if (t.includes("electrical") || sheet.startsWith("E-")) return "electrical";
  if (t.includes("plumbing") || sheet.startsWith("P-")) return "plumbing";
  if (t.includes("mechanical") || t.includes("hvac") || sheet.startsWith("M-")) return "hvac";
  if (t.includes("section")) return "framing";
  return "none";
}

export function BlueprintPageList({
  pages,
  selected,
  onToggle,
  onToggleAll,
  trades,
  onTradeChange,
  onExtractGeometry,
}: {
  pages: any[];
  selected: Record<string, boolean>;
  onToggle: (pageId: string, value: boolean) => void;
  onToggleAll: (value: boolean) => void;
  trades: Record<string, string>;
  onTradeChange: (pageId: string, trade: string) => void;
  onExtractGeometry: (pageId: string) => Promise<void>;
}) {
  const allSelected = pages.length > 0 && pages.every((p) => selected[p.id]);
  const someSelected = pages.some((p) => selected[p.id]);

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
                <th className="py-2 pr-3">Detected Type</th>
                <th className="py-2 pr-3">Sheet</th>
                <th className="py-2 pr-3">Trade to quote</th>
                <th className="py-2 pr-3">Scale</th>
                <th className="py-2 pr-3">Review</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {pages.map((page) => {
                const trade = trades[page.id] ?? guessTradeFromPage(page);
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
                      <Badge variant="outline">{page.page_type}</Badge>
                    </td>
                    <td className="py-2 pr-3">
                      {page.sheet_number || page.sheet_name || page.page_title || "—"}
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
                    <td className="py-2 pr-3">{page.scale_text || "—"}</td>
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
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/blueprints/page/${page.id}`}>Review</Link>
                        </Button>
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
    </Card>
  );
}
