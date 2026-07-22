// Find ABC Match dialog — the mapping step required by the ABC Supply
// integration team. Every color variant returned by /product/v1/search/items
// (`familyItems=true`) is rendered as a SEPARATE selectable row because each
// color has its own ABC itemNumber. After the user picks a child and a valid
// Product API UOM, the mapping is upserted with the raw catalog snapshot so
// downstream pricing/order calls only ever see verified ABC identities.
//
// This dialog never fabricates SKUs, colors, UOMs, or availability. If ABC
// returns nothing (or is WAF-blocked in sandbox), that fact is surfaced,
// not hidden behind a placeholder row.
import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, Search, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  abcSearchProducts,
  abcApproveMapping,
  type AbcCatalogSearchResultChild,
} from '@/lib/abc/proxyClient';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  templateItemId: string;
  materialName: string;
  requestedColor: string | null;
  shipToNumber: string | null;
  branchNumber: string | null;
  onApproved: () => void;
}

export default function FindAbcMatchDialog({
  open, onOpenChange, tenantId, templateItemId, materialName,
  requestedColor, shipToNumber, branchNumber, onApproved,
}: Props) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [wafBlocked, setWafBlocked] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [results, setResults] = useState<AbcCatalogSearchResultChild[]>([]);
  const [selected, setSelected] = useState<AbcCatalogSearchResultChild | null>(null);
  const [selectedUom, setSelectedUom] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    if (open) {
      const initial = [materialName, requestedColor].filter(Boolean).join(' ').trim();
      setQuery(initial);
      setResults([]);
      setSelected(null);
      setSelectedUom(null);
      setErrorText(null);
      setWafBlocked(false);
    }
  }, [open, materialName, requestedColor]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setErrorText(null);
    setWafBlocked(false);
    setResults([]);
    setSelected(null);
    setSelectedUom(null);
    try {
      const r = await abcSearchProducts({
        query: query.trim(),
        branchNumber: branchNumber || undefined,
        itemsPerPage: 40,
      });
      setWafBlocked(r.wafBlocked);
      if (!r.success) setErrorText(r.error_code || 'ABC did not return results');
      setResults(r.children);
    } catch (e: any) {
      setErrorText(e?.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (c: AbcCatalogSearchResultChild) => {
    setSelected(c);
    // Never invent EA — only preselect if ABC returned exactly one valid UOM.
    setSelectedUom(c.validUoms.length === 1 ? c.validUoms[0] : c.defaultUom && c.validUoms.includes(c.defaultUom) ? c.defaultUom : null);
  };

  const branchOk = useMemo(() => {
    if (!selected || !branchNumber) return false;
    const b = selected.branchAvailability.find((x) => x.branchNumber === branchNumber);
    return !!(b && b.available);
  }, [selected, branchNumber]);

  const canApprove = !!selected && !!selectedUom && selected.isActive && !!branchNumber && !!shipToNumber;

  const approve = async () => {
    if (!selected || !selectedUom || !branchNumber || !shipToNumber) return;
    setApproving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await abcApproveMapping({
        tenantId,
        templateItemId,
        itemNumber: selected.itemNumber,
        itemDescription: selected.description,
        familyId: selected.familyId,
        familyName: selected.familyName,
        colorName: selected.colorName,
        colorCode: selected.colorCode,
        validUoms: selected.validUoms,
        selectedUom,
        branchNumber,
        shipToNumber,
        rawCatalogPayload: selected.raw,
        approvedBy: userRes?.user?.id ?? null,
      });
      if (error) throw error;
      toast.success(`Mapped to ABC ${selected.itemNumber}`);
      onApproved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Approve failed: ${e?.message || e}`);
    } finally {
      setApproving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Find ABC Match — {materialName}</DialogTitle>
          <DialogDescription>
            Every color variant is its own ABC itemNumber. Pick the exact color-specific item and a valid Product API UOM.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. Atlas Pinnacle Pristine"
              className="pl-9"
              onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            />
          </div>
          <Button onClick={runSearch} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
          </Button>
        </div>

        {wafBlocked && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <ShieldAlert className="mt-0.5 h-4 w-4 text-destructive" />
            <div>
              ABC sandbox blocked this request at the WAF layer. Ask ABC to allow-list this environment before running acceptance.
            </div>
          </div>
        )}
        {errorText && !wafBlocked && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            {errorText}
          </div>
        )}

        <div className="max-h-[380px] overflow-y-auto border rounded-md">
          {results.length === 0 && !loading ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {wafBlocked || errorText ? 'No results to show.' : 'Search ABC to see color-specific matches.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase sticky top-0">
                <tr>
                  <th className="p-2 text-left">ABC Item</th>
                  <th className="p-2 text-left">Description</th>
                  <th className="p-2 text-left">Color</th>
                  <th className="p-2 text-left">Valid UOMs</th>
                  <th className="p-2 text-left">Branch</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {results.map((c) => {
                  const b = branchNumber
                    ? c.branchAvailability.find((x) => x.branchNumber === branchNumber)
                    : null;
                  const isSel = selected?.itemNumber === c.itemNumber;
                  return (
                    <tr key={c.itemNumber} className={`border-t ${isSel ? 'bg-primary/5' : ''}`}>
                      <td className="p-2 font-mono text-xs">{c.itemNumber}</td>
                      <td className="p-2">{c.description || '—'}</td>
                      <td className="p-2">{c.colorName || <span className="text-muted-foreground">—</span>}</td>
                      <td className="p-2">
                        {c.validUoms.length > 0
                          ? c.validUoms.join(', ')
                          : <span className="text-muted-foreground">n/a</span>}
                      </td>
                      <td className="p-2">
                        {!branchNumber ? <span className="text-muted-foreground text-xs">Select branch</span>
                          : b?.available ? <Badge variant="default">Available</Badge>
                          : b ? <Badge variant="destructive">Unavailable</Badge>
                          : <Badge variant="outline">Verification required</Badge>}
                      </td>
                      <td className="p-2 text-right">
                        <Button size="sm" variant={isSel ? 'default' : 'outline'} onClick={() => handleSelect(c)}>
                          {isSel ? 'Selected' : 'Select'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {selected && (
          <div className="rounded-md border p-3 space-y-3">
            <div className="text-sm">
              <div><span className="text-muted-foreground">ABC Item:</span> <span className="font-mono">{selected.itemNumber}</span></div>
              <div><span className="text-muted-foreground">Description:</span> {selected.description || '—'}</div>
              <div><span className="text-muted-foreground">Color:</span> {selected.colorName || '—'}</div>
            </div>

            {selected.validUoms.length > 1 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">Pick a Product API UOM</div>
                <div className="flex flex-wrap gap-2">
                  {selected.validUoms.map((u) => (
                    <Button
                      key={u}
                      size="sm"
                      variant={selectedUom === u ? 'default' : 'outline'}
                      onClick={() => setSelectedUom(u)}
                    >
                      {u}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {selected.validUoms.length === 1 && (
              <div className="text-xs text-muted-foreground">UOM: <span className="font-mono">{selected.validUoms[0]}</span> (only sellable UOM)</div>
            )}
            {selected.validUoms.length === 0 && (
              <div className="text-xs text-destructive">ABC did not return a sellable UOM — cannot approve.</div>
            )}

            {!branchOk && branchNumber && (
              <div className="text-xs text-amber-600">
                Branch {branchNumber} availability is unverified. Approving anyway will flag this row as "Needs Branch Verification".
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={approving}>Cancel</Button>
          <Button onClick={approve} disabled={!canApprove || approving}>
            {approving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
            Approve Mapping
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
