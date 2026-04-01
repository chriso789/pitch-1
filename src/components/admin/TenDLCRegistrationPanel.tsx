import React, { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Building2, MessageSquare, Phone, CheckCircle2, Clock, XCircle, RefreshCw, ChevronRight } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Registration {
  id: string;
  tenant_id: string;
  brand_id: string | null;
  brand_status: string;
  brand_payload: Record<string, unknown>;
  campaign_id: string | null;
  campaign_status: string;
  campaign_payload: Record<string, unknown>;
  assigned_numbers: string[];
  telnyx_brand_response: Record<string, unknown> | null;
  telnyx_campaign_response: Record<string, unknown> | null;
}

const VERTICALS = [
  "CONSTRUCTION", "REAL_ESTATE", "PROFESSIONAL", "COMMUNICATION",
  "ENERGY", "ENTERTAINMENT", "FINANCIAL", "HEALTHCARE",
  "HOSPITALITY", "INSURANCE", "MANUFACTURING", "MARKETING",
  "NGO", "POLITICAL", "RETAIL", "TECHNOLOGY", "TRANSPORTATION",
];

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  not_started: { icon: Clock, color: "text-muted-foreground", label: "Not Started" },
  pending: { icon: Clock, color: "text-warning", label: "Pending Review" },
  approved: { icon: CheckCircle2, color: "text-success", label: "Approved" },
  verified: { icon: CheckCircle2, color: "text-success", label: "Verified" },
  rejected: { icon: XCircle, color: "text-destructive", label: "Rejected" },
  failed: { icon: XCircle, color: "text-destructive", label: "Failed" },
};

export const TenDLCRegistrationPanel = () => {
  const { toast } = useToast();
  const [registration, setRegistration] = useState<Registration | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Brand form
  const [companyName, setCompanyName] = useState("");
  const [ein, setEin] = useState("");
  const [website, setWebsite] = useState("");
  const [vertical, setVertical] = useState("CONSTRUCTION");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [entityType, setEntityType] = useState("PRIVATE_PROFIT");

  // Campaign form
  const [useCase, setUseCase] = useState("MIXED");
  const [description, setDescription] = useState(
    "CRM-initiated customer communications including appointment reminders, project status updates, estimate follow-ups, and promotional offers for construction/roofing services."
  );
  const [sample1, setSample1] = useState(
    "Hi {{first_name}}, your roofing appointment is confirmed for tomorrow at 10am. Reply STOP to opt out."
  );
  const [sample2, setSample2] = useState(
    "Great news {{first_name}}! Your project estimate is ready. View it here: {{link}}. Reply STOP to opt out."
  );
  const [messageFlow, setMessageFlow] = useState(
    "Customers opt in by providing their phone number during in-person consultation, via our website contact form, or by texting START to our business number. They receive appointment reminders, project updates, and occasional promotional offers. They can opt out at any time by replying STOP."
  );

  // Assign number
  const [phoneToAssign, setPhoneToAssign] = useState("");
  const [availableNumbers, setAvailableNumbers] = useState<string[]>([]);

  useEffect(() => {
    loadRegistration();
    loadAvailableNumbers();
  }, []);

  useEffect(() => {
    if (registration) {
      const brandApproved = ["approved", "verified"].includes(registration.brand_status);
      const campaignApproved = ["approved", "verified"].includes(registration.campaign_status);
      if (campaignApproved) setActiveStep(2);
      else if (brandApproved) setActiveStep(1);
      else if (registration.brand_id) setActiveStep(0); // pending
      else setActiveStep(0);
    }
  }, [registration]);

  const loadRegistration = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-10dlc", {
        body: { action: "get-registration" },
      });
      if (error) throw error;
      setRegistration(data.registration);
    } catch (err) {
      console.error("Failed to load 10DLC registration:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadAvailableNumbers = async () => {
    try {
      const { data } = await supabase.rpc("get_location_phone_numbers").select();
      if (data && Array.isArray(data)) {
        setAvailableNumbers(data.map((d: Record<string, unknown>) => String(d.phone_number || "")));
      }
    } catch (err) {
      console.error("Failed to load numbers:", err);
    }
  };

  const handleRegisterBrand = async () => {
    if (!companyName || !ein || !website || !street || !city || !state || !zip) {
      toast({ title: "Missing fields", description: "Please fill in all required fields.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-10dlc", {
        body: {
          action: "register-brand",
          company_name: companyName,
          ein,
          website: website.startsWith("http") ? website : `https://${website}`,
          vertical,
          street,
          city,
          state,
          zip,
          entity_type: entityType,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast({ title: "Brand Submitted!", description: "Your brand registration is now pending review. This typically takes 1-5 business days." });
      await loadRegistration();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Registration Failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!registration?.brand_id) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-10dlc", {
        body: {
          action: "create-campaign",
          brand_id: registration.brand_id,
          use_case: useCase,
          description,
          sample_messages: [sample1, sample2],
          message_flow: messageFlow,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast({ title: "Campaign Created!", description: "Your SMS campaign is pending carrier approval." });
      await loadRegistration();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Campaign Creation Failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignNumber = async () => {
    if (!registration?.campaign_id || !phoneToAssign) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("telnyx-10dlc", {
        body: {
          action: "assign-number",
          campaign_id: registration.campaign_id,
          phone_number: phoneToAssign,
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      toast({ title: "Number Assigned!", description: `${phoneToAssign} is now linked to your 10DLC campaign. SMS delivery is enabled.` });
      setPhoneToAssign("");
      await loadRegistration();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Assignment Failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCheckStatus = async () => {
    if (!registration?.brand_id && !registration?.campaign_id) return;
    setSubmitting(true);
    try {
      await supabase.functions.invoke("telnyx-10dlc", {
        body: {
          action: "check-status",
          brand_id: registration.brand_id,
          campaign_id: registration.campaign_id,
        },
      });
      toast({ title: "Status Refreshed" });
      await loadRegistration();
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const config = STATUS_CONFIG[status] || STATUS_CONFIG.not_started;
    const Icon = config.icon;
    return (
      <Badge variant="outline" className={`${config.color} gap-1`}>
        <Icon className="h-3 w-3" />
        {config.label}
      </Badge>
    );
  };

  const brandApproved = registration && ["approved", "verified"].includes(registration.brand_status);
  const campaignApproved = registration && ["approved", "verified"].includes(registration.campaign_status);
  const brandPending = registration?.brand_id && !brandApproved;
  const campaignPending = registration?.campaign_id && !campaignApproved;

  const steps = [
    { label: "Register Brand", icon: Building2 },
    { label: "Create Campaign", icon: MessageSquare },
    { label: "Assign Numbers", icon: Phone },
  ];

  const progressValue = campaignApproved && (registration?.assigned_numbers?.length ?? 0) > 0
    ? 100
    : campaignApproved ? 80
    : brandApproved ? 50
    : registration?.brand_id ? 25
    : 0;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle className="text-lg">10DLC Compliance Registration</CardTitle>
          </div>
          {registration?.brand_id && (
            <Button variant="ghost" size="sm" onClick={handleCheckStatus} disabled={submitting}>
              <RefreshCw className={`h-4 w-4 mr-1 ${submitting ? "animate-spin" : ""}`} />
              Refresh Status
            </Button>
          )}
        </div>
        <CardDescription>
          US carriers require 10DLC registration for business SMS. Complete these steps to enable message delivery.
        </CardDescription>
        <Progress value={progressValue} className="mt-3 h-2" />
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Step indicators */}
        <div className="flex items-center gap-2">
          {steps.map((step, i) => {
            const Icon = step.icon;
            const isActive = activeStep === i;
            const isComplete = i === 0 ? brandApproved : i === 1 ? campaignApproved : (registration?.assigned_numbers?.length ?? 0) > 0;
            return (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                <button
                  onClick={() => setActiveStep(i)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isActive ? "bg-primary/10 text-primary" : isComplete ? "text-success" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  {step.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>

        {/* Step 1: Brand Registration */}
        {activeStep === 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">Brand Registration</h3>
              {registration?.brand_status && getStatusBadge(registration.brand_status)}
            </div>

            {brandPending && (
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 text-sm">
                <p className="font-medium text-warning">Brand registration is pending review.</p>
                <p className="text-muted-foreground mt-1">This typically takes 1-5 business days. Click "Refresh Status" to check for updates.</p>
              </div>
            )}

            {brandApproved && (
              <div className="bg-success/10 border border-success/20 rounded-lg p-4 text-sm">
                <p className="font-medium text-success">✅ Brand approved! Proceed to create a campaign.</p>
              </div>
            )}

            {!registration?.brand_id && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Company Name *</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="O'Brien Contracting USA" />
                </div>
                <div className="space-y-2">
                  <Label>EIN (Tax ID) *</Label>
                  <Input value={ein} onChange={(e) => setEin(e.target.value)} placeholder="12-3456789" />
                </div>
                <div className="space-y-2">
                  <Label>Website *</Label>
                  <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://www.example.com" />
                </div>
                <div className="space-y-2">
                  <Label>Industry Vertical</Label>
                  <Select value={vertical} onValueChange={setVertical}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VERTICALS.map((v) => (
                        <SelectItem key={v} value={v}>{v.replace(/_/g, " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Entity Type</Label>
                  <Select value={entityType} onValueChange={setEntityType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRIVATE_PROFIT">Private / For Profit</SelectItem>
                      <SelectItem value="PUBLIC_PROFIT">Public / For Profit</SelectItem>
                      <SelectItem value="NON_PROFIT">Non-Profit</SelectItem>
                      <SelectItem value="GOVERNMENT">Government</SelectItem>
                      <SelectItem value="SOLE_PROPRIETOR">Sole Proprietor</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Street Address *</Label>
                  <Input value={street} onChange={(e) => setStreet(e.target.value)} placeholder="123 Main St" />
                </div>
                <div className="space-y-2">
                  <Label>City *</Label>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Sarasota" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>State *</Label>
                    <Input value={state} onChange={(e) => setState(e.target.value)} placeholder="FL" maxLength={2} />
                  </div>
                  <div className="space-y-2">
                    <Label>ZIP *</Label>
                    <Input value={zip} onChange={(e) => setZip(e.target.value)} placeholder="34232" />
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Button onClick={handleRegisterBrand} disabled={submitting} className="w-full md:w-auto">
                    {submitting ? "Submitting..." : "Register Brand"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 2: Campaign */}
        {activeStep === 1 && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold">SMS Campaign</h3>
              {registration?.campaign_status && getStatusBadge(registration.campaign_status)}
            </div>

            {!brandApproved && (
              <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground">
                Your brand must be approved before creating a campaign. Go back to Step 1 and check the status.
              </div>
            )}

            {campaignPending && (
              <div className="bg-warning/10 border border-warning/20 rounded-lg p-4 text-sm">
                <p className="font-medium text-warning">Campaign is pending carrier approval.</p>
              </div>
            )}

            {campaignApproved && (
              <div className="bg-success/10 border border-success/20 rounded-lg p-4 text-sm">
                <p className="font-medium text-success">✅ Campaign approved! Assign your phone numbers next.</p>
              </div>
            )}

            {brandApproved && !registration?.campaign_id && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Use Case</Label>
                  <Select value={useCase} onValueChange={setUseCase}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MIXED">Mixed (Marketing + Transactional)</SelectItem>
                      <SelectItem value="MARKETING">Marketing Only</SelectItem>
                      <SelectItem value="LOW_VOLUME">Low Volume Mixed</SelectItem>
                      <SelectItem value="CUSTOMER_CARE">Customer Care</SelectItem>
                      <SelectItem value="DELIVERY_NOTIFICATION">Delivery Notifications</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Campaign Description</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
                <div className="space-y-2">
                  <Label>Opt-In / Message Flow Description</Label>
                  <Textarea value={messageFlow} onChange={(e) => setMessageFlow(e.target.value)} rows={3} placeholder="Describe how customers opt in to receive messages..." />
                </div>
                <div className="space-y-2">
                  <Label>Sample Message 1</Label>
                  <Textarea value={sample1} onChange={(e) => setSample1(e.target.value)} rows={2} />
                </div>
                <div className="space-y-2">
                  <Label>Sample Message 2</Label>
                  <Textarea value={sample2} onChange={(e) => setSample2(e.target.value)} rows={2} />
                </div>
                <Button onClick={handleCreateCampaign} disabled={submitting}>
                  {submitting ? "Creating..." : "Create Campaign"}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Assign Numbers */}
        {activeStep === 2 && (
          <div className="space-y-4">
            <h3 className="font-semibold">Assign Phone Numbers</h3>

            {!campaignApproved && (
              <div className="bg-muted rounded-lg p-4 text-sm text-muted-foreground">
                Your campaign must be approved before assigning numbers.
              </div>
            )}

            {(registration?.assigned_numbers?.length ?? 0) > 0 && (
              <div className="space-y-2">
                <Label className="text-muted-foreground">Currently Assigned</Label>
                <div className="flex flex-wrap gap-2">
                  {registration!.assigned_numbers.map((num) => (
                    <Badge key={num} variant="secondary" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />
                      {num}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {campaignApproved && (
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-2">
                  <Label>Phone Number</Label>
                  {availableNumbers.length > 0 ? (
                    <Select value={phoneToAssign} onValueChange={setPhoneToAssign}>
                      <SelectTrigger><SelectValue placeholder="Select a number" /></SelectTrigger>
                      <SelectContent>
                        {availableNumbers
                          .filter((n) => !(registration?.assigned_numbers || []).includes(n))
                          .map((n) => (
                            <SelectItem key={n} value={n}>{n}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={phoneToAssign} onChange={(e) => setPhoneToAssign(e.target.value)} placeholder="+19415410117" />
                  )}
                </div>
                <Button onClick={handleAssignNumber} disabled={submitting || !phoneToAssign}>
                  {submitting ? "Assigning..." : "Assign Number"}
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};
