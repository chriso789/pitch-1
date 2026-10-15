import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CompanyLicense, LICENSE_TYPES, parseLicenses, serializeLicenses } from "@/lib/companyLicenses";

interface Props {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label?: string;
}

/** Lets a company enter as many licenses as it holds; each appears on estimates. */
export function LicenseListInput({ value, onChange, label = "Licenses" }: Props) {
  const [rows, setRows] = useState<CompanyLicense[]>(() => {
    const parsed = parseLicenses(value);
    return parsed.length ? parsed : [{ type: "Roofing Contractor", number: "" }];
  });

  // Re-sync when the parent loads a different company.
  useEffect(() => {
    if ((value || "") !== serializeLicenses(rows)) {
      const parsed = parseLicenses(value);
      setRows(parsed.length ? parsed : [{ type: "Roofing Contractor", number: "" }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const update = (next: CompanyLicense[]) => {
    setRows(next);
    onChange(serializeLicenses(next));
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {rows.map((row, i) => {
        const isCustom = row.type !== "" && !(LICENSE_TYPES as readonly string[]).includes(row.type);
        return (
          <div key={i} className="flex gap-2">
            <Select
              value={isCustom ? "Other" : row.type || "Other"}
              onValueChange={(t) => update(rows.map((r, j) => (j === i ? { ...r, type: t } : r)))}
            >
              <SelectTrigger className="w-[45%]"><SelectValue placeholder="License type" /></SelectTrigger>
              <SelectContent>
                {LICENSE_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              placeholder="e.g. CCC1334804"
              value={row.number}
              onChange={(e) => update(rows.map((r, j) => (j === i ? { ...r, number: e.target.value } : r)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Remove license"
              disabled={rows.length === 1 && !row.number}
              onClick={() => {
                const next = rows.filter((_, j) => j !== i);
                update(next.length ? next : [{ type: "Roofing Contractor", number: "" }]);
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { type: "Other", number: "" }])}>
        <Plus className="h-4 w-4 mr-1" /> Add another license
      </Button>
      <p className="text-xs text-muted-foreground">Every license entered here prints on your estimates.</p>
    </div>
  );
}
