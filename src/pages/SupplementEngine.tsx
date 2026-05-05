import React, { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileWarning, Mail, ClipboardList } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

type Dispute = {
  dispute_type: string;
  xactimate_code?: string;
  description: string;
  requested_quantity?: number;
  unit?: string;
  reason: string;
};

type SupplementResult = {
  disputes: Dispute[];
  narrative: string;
};

const defaultMeasurements = {
  roof_area: 3077,
  squares: 30.8,
  pitch: 6,
  facets: 14,
  eaves: 258,
  rakes: 5,
  valleys: 64,
  hips: 201,
  ridges: 30,
  step_flashing: 11,
};

const SupplementEngine = () => {
  const { effectiveTenantId } = useEffectiveTenantId();
  const { toast } = useToast();
  const [carrierItems, setCarrierItems] = useState("");
  const [result, setResult] = useState<SupplementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [measurements, setMeasurements] = useState(defaultMeasurements);
  const [caseInfo, setCaseInfo] = useState({
    carrier_name: "",
    claim_number: "",
    policy_number: "",
    loss_date: "",
  });

  const generateSupplement = async () => {
    if (!effectiveTenantId) {
      toast({ title: "No active company", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      // 1. Create case
      const { data: caseData, error: caseErr } = await supabase.functions.invoke(
        "create-supplement-case",
        {
          body: {
            tenant_id: effectiveTenantId,
            job_id: "00000000-0000-0000-0000-000000000000", // placeholder
            carrier_name: caseInfo.carrier_name || "Carrier",
            claim_number: caseInfo.claim_number || "Pending",
            policy_number: caseInfo.policy_number || "Pending",
            loss_date: caseInfo.loss_date || null,
          },
        }
      );
      if (caseErr) throw caseErr;

      const parsedCarrierItems = carrierItems
        .split("\n")
        .filter(Boolean)
        .map((line) => ({ description: line.trim() }));

      // 2. Generate supplement
      const { data: suppData, error: suppErr } = await supabase.functions.invoke(
        "generate-supplement",
        {
          body: {
            supplement_case_id: caseData.supplement_case.id,
            measurements,
            carrier_items: parsedCarrierItems,
          },
        }
      );
      if (suppErr) throw suppErr;

      setResult(suppData);
      toast({ title: "Supplement generated", description: `${suppData.disputes?.length || 0} disputes found` });
    } catch (err: any) {
      toast({ title: "Error", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <GlobalLayout>
      <div className="space-y-6 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Supplement Engine</h1>
          <p className="text-muted-foreground">
            Compare carrier estimate scope against PITCH measurement data and generate a supplement package.
          </p>
        </div>

        {/* Case Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Claim Info</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <Label>Carrier</Label>
              <Input value={caseInfo.carrier_name} onChange={(e) => setCaseInfo((p) => ({ ...p, carrier_name: e.target.value }))} placeholder="State Farm" />
            </div>
            <div>
              <Label>Claim #</Label>
              <Input value={caseInfo.claim_number} onChange={(e) => setCaseInfo((p) => ({ ...p, claim_number: e.target.value }))} />
            </div>
            <div>
              <Label>Policy #</Label>
              <Input value={caseInfo.policy_number} onChange={(e) => setCaseInfo((p) => ({ ...p, policy_number: e.target.value }))} />
            </div>
            <div>
              <Label>Loss Date</Label>
              <Input type="date" value={caseInfo.loss_date} onChange={(e) => setCaseInfo((p) => ({ ...p, loss_date: e.target.value }))} />
            </div>
          </CardContent>
        </Card>

        {/* Measurements */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Roof Measurements</CardTitle>
            <CardDescription>From your PITCH measurement report or EagleView</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {Object.entries(measurements).map(([key, value]) => (
              <div key={key}>
                <Label className="text-xs capitalize">{key.replaceAll("_", " ")}</Label>
                <Input
                  type="number"
                  value={value}
                  onChange={(e) =>
                    setMeasurements((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Carrier Items */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Carrier Estimate Items</CardTitle>
            <CardDescription>Paste carrier line items, one per line</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={8}
              value={carrierItems}
              onChange={(e) => setCarrierItems(e.target.value)}
              placeholder={`Remove shingles\nInstall shingles\nSynthetic underlayment\nIce & water shield`}
            />
          </CardContent>
        </Card>

        <Button onClick={generateSupplement} disabled={loading} size="lg" className="w-full md:w-auto">
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…
            </>
          ) : (
            <>
              <FileWarning className="h-4 w-4 mr-2" /> Generate Supplement
            </>
          )}
        </Button>

        {/* Results */}
        {result && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Disputes Found
                  <Badge variant="destructive">{result.disputes?.length || 0}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-2 text-left font-medium">Type</th>
                        <th className="p-2 text-left font-medium">Code</th>
                        <th className="p-2 text-left font-medium">Description</th>
                        <th className="p-2 text-left font-medium">Qty</th>
                        <th className="p-2 text-left font-medium">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.disputes?.map((d, i) => (
                        <tr key={i} className="border-b">
                          <td className="p-2">
                            <Badge variant={d.dispute_type === "missing_item" ? "destructive" : "secondary"} className="text-xs">
                              {d.dispute_type}
                            </Badge>
                          </td>
                          <td className="p-2 font-mono text-xs">{d.xactimate_code}</td>
                          <td className="p-2 font-medium">{d.description}</td>
                          <td className="p-2">
                            {d.requested_quantity} {d.unit}
                          </td>
                          <td className="p-2 text-muted-foreground text-xs">{d.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Supplement Narrative
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-sm bg-muted/50 p-4 rounded-lg font-sans">
                  {result.narrative}
                </pre>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </GlobalLayout>
  );
};

export default SupplementEngine;
