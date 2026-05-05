import React, { useState } from "react";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, FileText, ClipboardList, Mail, ArrowRight, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";

type ParsedItem = {
  code: string | null;
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  total_price: number | null;
  category: string;
};

type Dispute = {
  id?: string;
  dispute_type: string;
  xactimate_code?: string;
  description: string;
  requested_quantity?: number;
  unit?: string;
  reason: string;
};

type Packet = {
  title: string;
  case: any;
  carrier_items: any[];
  disputes: Dispute[];
  narrative: string;
  sections: string[];
  generated_at: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  draft: { label: "Draft", color: "bg-muted text-muted-foreground", icon: <Clock className="h-3 w-3" /> },
  review_ready: { label: "Review Ready", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200", icon: <ClipboardList className="h-3 w-3" /> },
  submitted: { label: "Submitted", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: <ArrowRight className="h-3 w-3" /> },
  approved: { label: "Approved", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  partially_approved: { label: "Partial", color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: <CheckCircle2 className="h-3 w-3" /> },
  denied: { label: "Denied", color: "bg-destructive/10 text-destructive", icon: <XCircle className="h-3 w-3" /> },
  resubmitted: { label: "Resubmitted", color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: <ArrowRight className="h-3 w-3" /> },
  closed: { label: "Closed", color: "bg-muted text-muted-foreground", icon: <CheckCircle2 className="h-3 w-3" /> },
};

const SupplementWorkflow = () => {
  const effectiveTenantId = useEffectiveTenantId();
  const { toast } = useToast();

  const [supplementCaseId, setSupplementCaseId] = useState("");
  const [carrierText, setCarrierText] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedItem[]>([]);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [status, setStatus] = useState("draft");
  const [adjusterEmail, setAdjusterEmail] = useState("");
  const [parsingLoading, setParsingLoading] = useState(false);
  const [packetLoading, setPacketLoading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);

  const parseCarrierEstimate = async () => {
    if (!supplementCaseId) {
      toast({ title: "Enter a supplement case ID first", variant: "destructive" });
      return;
    }
    setParsingLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("parse-carrier-estimate", {
        body: { supplement_case_id: supplementCaseId, raw_text: carrierText },
      });
      if (error) throw error;
      setParsedItems(data.parsed_items || []);
      toast({ title: "Carrier estimate parsed", description: `${data.parsed_items?.length || 0} line items extracted` });
    } catch (err: any) {
      toast({ title: "Parse error", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setParsingLoading(false);
    }
  };

  const generatePacket = async () => {
    if (!supplementCaseId) {
      toast({ title: "Enter a supplement case ID first", variant: "destructive" });
      return;
    }
    setPacketLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-supplement-packet", {
        body: { supplement_case_id: supplementCaseId },
      });
      if (error) throw error;
      setPacket(data.packet);
      toast({ title: "Supplement packet generated" });
    } catch (err: any) {
      toast({ title: "Packet error", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setPacketLoading(false);
    }
  };

  const updateStatus = async (nextStatus: string) => {
    if (!supplementCaseId) return;
    setStatusLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("update-supplement-status", {
        body: {
          supplement_case_id: supplementCaseId,
          status: nextStatus,
          notes: `Status changed to ${nextStatus}`,
        },
      });
      if (error) throw error;
      if (data.success) {
        setStatus(nextStatus);
        toast({ title: `Status updated to ${nextStatus}` });
      }
    } catch (err: any) {
      toast({ title: "Status error", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setStatusLoading(false);
    }
  };

  return (
    <GlobalLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Supplement Workflow</h1>
          <p className="text-muted-foreground">
            Parse carrier estimates, generate supplement packets, and track approval status.
          </p>
        </div>

        {/* Case Selection & Status */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Case Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label>Supplement Case ID</Label>
                <Input
                  value={supplementCaseId}
                  onChange={(e) => setSupplementCaseId(e.target.value)}
                  placeholder="Paste supplement case ID"
                />
              </div>
              <div>
                <Label>Adjuster Email</Label>
                <Input
                  type="email"
                  value={adjusterEmail}
                  onChange={(e) => setAdjusterEmail(e.target.value)}
                  placeholder="adjuster@carrier.com"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Status Workflow</CardTitle>
              <CardDescription>Current: <Badge className={STATUS_CONFIG[status]?.color}>{STATUS_CONFIG[status]?.label || status}</Badge></CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <Button
                    key={key}
                    variant={status === key ? "default" : "outline"}
                    size="sm"
                    disabled={statusLoading}
                    onClick={() => updateStatus(key)}
                    className="gap-1"
                  >
                    {config.icon}
                    {config.label}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="parser" className="space-y-4">
          <TabsList>
            <TabsTrigger value="parser">Carrier Parser</TabsTrigger>
            <TabsTrigger value="packet">Supplement Packet</TabsTrigger>
            <TabsTrigger value="email">Adjuster Email</TabsTrigger>
          </TabsList>

          {/* Carrier Parser Tab */}
          <TabsContent value="parser" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Carrier Estimate Parser
                </CardTitle>
                <CardDescription>Paste the text from the carrier's estimate PDF. Line items will be auto-extracted.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  rows={10}
                  value={carrierText}
                  onChange={(e) => setCarrierText(e.target.value)}
                  placeholder={`Paste carrier estimate text here...\n\nExample:\nRFG RFTK Remove shingles 30.77 SQ $45.00 $1,384.65\nRFG COMP Install comp shingles 30.77 SQ $125.00 $3,846.25\nSynthetic underlayment 30.77 SQ $18.50 $569.25`}
                />
                <Button onClick={parseCarrierEstimate} disabled={parsingLoading || !carrierText}>
                  {parsingLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Parsing…</> : "Parse Carrier Estimate"}
                </Button>

                {parsedItems.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="p-2 text-left font-medium">Code</th>
                          <th className="p-2 text-left font-medium">Description</th>
                          <th className="p-2 text-left font-medium">Qty</th>
                          <th className="p-2 text-left font-medium">Unit</th>
                          <th className="p-2 text-left font-medium">Unit Price</th>
                          <th className="p-2 text-left font-medium">Total</th>
                          <th className="p-2 text-left font-medium">Category</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parsedItems.map((item, i) => (
                          <tr key={i} className="border-b">
                            <td className="p-2 font-mono text-xs">{item.code || "—"}</td>
                            <td className="p-2">{item.description}</td>
                            <td className="p-2">{item.quantity ?? "—"}</td>
                            <td className="p-2">{item.unit || "—"}</td>
                            <td className="p-2">{item.unit_price != null ? `$${item.unit_price.toFixed(2)}` : "—"}</td>
                            <td className="p-2 font-medium">{item.total_price != null ? `$${item.total_price.toFixed(2)}` : "—"}</td>
                            <td className="p-2">
                              <Badge variant="secondary" className="text-xs">{item.category}</Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Supplement Packet Tab */}
          <TabsContent value="packet" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Supplement Packet
                </CardTitle>
                <CardDescription>Generate the full supplement request packet from disputes and measurements.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Button onClick={generatePacket} disabled={packetLoading || !supplementCaseId}>
                  {packetLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</> : "Generate Supplement Packet"}
                </Button>

                {packet && (
                  <div className="space-y-4">
                    <div className="bg-muted/30 rounded-lg p-4 space-y-3">
                      <h3 className="text-lg font-bold">{packet.title}</h3>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                        <div><span className="text-muted-foreground">Carrier:</span> {packet.case?.carrier_name}</div>
                        <div><span className="text-muted-foreground">Claim #:</span> {packet.case?.claim_number}</div>
                        <div><span className="text-muted-foreground">Policy #:</span> {packet.case?.policy_number}</div>
                        <div><span className="text-muted-foreground">Generated:</span> {new Date(packet.generated_at).toLocaleDateString()}</div>
                      </div>
                    </div>

                    {packet.narrative && (
                      <div>
                        <h4 className="font-semibold mb-2">Supplement Narrative</h4>
                        <pre className="whitespace-pre-wrap text-sm bg-muted/50 p-4 rounded-lg font-sans">
                          {packet.narrative}
                        </pre>
                      </div>
                    )}

                    <div>
                      <h4 className="font-semibold mb-2">Disputes ({packet.disputes.length})</h4>
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
                            {packet.disputes.map((d, i) => (
                              <tr key={i} className="border-b">
                                <td className="p-2">
                                  <Badge variant={d.dispute_type === "missing_item" ? "destructive" : "secondary"} className="text-xs">
                                    {d.dispute_type}
                                  </Badge>
                                </td>
                                <td className="p-2 font-mono text-xs">{d.xactimate_code || "—"}</td>
                                <td className="p-2 font-medium">{d.description}</td>
                                <td className="p-2">{d.requested_quantity} {d.unit}</td>
                                <td className="p-2 text-muted-foreground text-xs">{d.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {packet.carrier_items.length > 0 && (
                      <div>
                        <h4 className="font-semibold mb-2">Carrier Line Items ({packet.carrier_items.length})</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b bg-muted/50">
                                <th className="p-2 text-left font-medium">Code</th>
                                <th className="p-2 text-left font-medium">Description</th>
                                <th className="p-2 text-left font-medium">Qty</th>
                                <th className="p-2 text-left font-medium">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {packet.carrier_items.map((item: any, i: number) => (
                                <tr key={i} className="border-b">
                                  <td className="p-2 font-mono text-xs">{item.code || "—"}</td>
                                  <td className="p-2">{item.description}</td>
                                  <td className="p-2">{item.quantity} {item.unit}</td>
                                  <td className="p-2">{item.total_price != null ? `$${item.total_price.toFixed(2)}` : "—"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Adjuster Email Tab */}
          <TabsContent value="email" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Mail className="h-5 w-5" />
                  Adjuster Email Draft
                </CardTitle>
                <CardDescription>Auto-generated email template for supplement submission.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>To</Label>
                  <Input
                    value={adjusterEmail}
                    onChange={(e) => setAdjusterEmail(e.target.value)}
                    placeholder="adjuster@carrier.com"
                  />
                </div>
                <div>
                  <Label>Subject</Label>
                  <Input
                    readOnly
                    value={`Supplement Request – Claim ${packet?.case?.claim_number || "[Claim #]"}`}
                  />
                </div>
                <div>
                  <Label>Body</Label>
                  <Textarea
                    rows={12}
                    readOnly
                    value={[
                      `Dear Adjuster,`,
                      ``,
                      `Please find the attached supplement request for Claim #${packet?.case?.claim_number || "[Claim #]"}, Policy #${packet?.case?.policy_number || "[Policy #]"}.`,
                      ``,
                      `After completing a detailed roof measurement report and comparing the scope against the carrier estimate, we have identified ${packet?.disputes?.length || 0} items that require review:`,
                      ``,
                      ...(packet?.disputes?.map((d) => `• ${d.description} — ${d.requested_quantity || ""} ${d.unit || ""}: ${d.reason}`) || ["(Generate packet first)"]),
                      ``,
                      `The attached supplement packet includes full measurement data, scope justification, and supporting documentation.`,
                      ``,
                      `Please contact us at your earliest convenience to schedule a re-inspection or approve the supplemented scope.`,
                      ``,
                      `Respectfully,`,
                      `[Your Company Name]`,
                    ].join("\n")}
                  />
                </div>
                <Button variant="outline" disabled={!packet}>
                  <Mail className="h-4 w-4 mr-2" /> Copy Email Draft
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
};

export default SupplementWorkflow;
