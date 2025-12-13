import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Mail, CheckCircle, Clock, AlertCircle, Copy, RefreshCw, Globe, Send } from "lucide-react";

interface EmailDomain {
  id: string;
  domain: string;
  from_name: string;
  from_email: string;
  reply_to_email: string;
  verification_status: string;
  verification_token: string;
  verified_at: string | null;
}

interface DnsInstructions {
  type: string;
  name: string;
  value: string;
  ttl: number;
}

export function EmailDomainSettings() {
  const [domains, setDomains] = useState<EmailDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [dnsInstructions, setDnsInstructions] = useState<DnsInstructions | null>(null);
  const [pendingDomainId, setPendingDomainId] = useState<string | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    domain: "",
    from_name: "",
    from_email: "",
    reply_to_email: ""
  });

  useEffect(() => {
    loadDomains();
  }, []);

  const loadDomains = async () => {
    try {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return;

      const response = await supabase.functions.invoke("verify-email-domain", {
        body: { action: "check_status" }
      });

      if (response.data?.success) {
        setDomains(response.data.domains || []);
      }
    } catch (error) {
      console.error("Error loading domains:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await supabase.functions.invoke("verify-email-domain", {
        body: {
          action: "generate_token",
          domain: formData.domain,
          from_name: formData.from_name,
          from_email: formData.from_email,
          reply_to_email: formData.reply_to_email || formData.from_email
        }
      });

      if (response.data?.success) {
        setDnsInstructions(response.data.dns_instructions);
        setPendingDomainId(response.data.domain_id);
        toast({
          title: "Domain Added",
          description: "Please add the DNS TXT record to verify your domain."
        });
        await loadDomains();
      } else {
        throw new Error(response.data?.error || "Failed to add domain");
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVerify = async (domainId: string) => {
    setVerifying(true);

    try {
      const response = await supabase.functions.invoke("verify-email-domain", {
        body: { action: "verify", domain_id: domainId }
      });

      if (response.data?.verified) {
        toast({
          title: "Domain Verified!",
          description: "You can now send emails from your custom domain."
        });
        setDnsInstructions(null);
        setPendingDomainId(null);
        setShowAddForm(false);
        setFormData({ domain: "", from_name: "", from_email: "", reply_to_email: "" });
        await loadDomains();
      } else {
        toast({
          title: "Not Verified Yet",
          description: response.data?.message || "DNS record not found. Please wait a few minutes and try again.",
          variant: "destructive"
        });
      }
    } catch (error: any) {
      toast({
        title: "Verification Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setVerifying(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "verified":
        return <Badge className="bg-green-500/20 text-green-400 border-green-500/30"><CheckCircle className="w-3 h-3 mr-1" /> Verified</Badge>;
      case "pending":
        return <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      default:
        return <Badge className="bg-red-500/20 text-red-400 border-red-500/30"><AlertCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Mail className="w-5 h-5 text-primary" />
                Email Domain Settings
              </CardTitle>
              <CardDescription>
                Configure your company's email domain to send quotes and communications from your own email address.
              </CardDescription>
            </div>
            {!showAddForm && (
              <Button onClick={() => setShowAddForm(true)} variant="gamified">
                <Globe className="w-4 h-4 mr-2" />
                Add Domain
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Existing Domains */}
          {domains.length > 0 && (
            <div className="space-y-4 mb-6">
              {domains.map((domain) => (
                <div
                  key={domain.id}
                  className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{domain.domain}</span>
                      {getStatusBadge(domain.verification_status)}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {domain.from_name} &lt;{domain.from_email}&gt;
                    </p>
                  </div>
                  {domain.verification_status === "pending" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleVerify(domain.id)}
                      disabled={verifying}
                    >
                      {verifying ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Verify"}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Add Domain Form */}
          {showAddForm && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="domain">Domain</Label>
                  <Input
                    id="domain"
                    placeholder="yourdomain.com"
                    value={formData.domain}
                    onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="from_name">From Name</Label>
                  <Input
                    id="from_name"
                    placeholder="O'Brien Contracting"
                    value={formData.from_name}
                    onChange={(e) => setFormData({ ...formData, from_name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="from_email">From Email</Label>
                  <Input
                    id="from_email"
                    type="email"
                    placeholder="quotes@yourdomain.com"
                    value={formData.from_email}
                    onChange={(e) => setFormData({ ...formData, from_email: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="reply_to_email">Reply-To Email (optional)</Label>
                  <Input
                    id="reply_to_email"
                    type="email"
                    placeholder="info@yourdomain.com"
                    value={formData.reply_to_email}
                    onChange={(e) => setFormData({ ...formData, reply_to_email: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={saving} variant="gamified">
                  {saving ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Send className="w-4 h-4 mr-2" />}
                  Generate Verification Token
                </Button>
                <Button type="button" variant="outline" onClick={() => setShowAddForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {/* DNS Instructions */}
          {dnsInstructions && (
            <Alert className="mt-6 bg-blue-500/10 border-blue-500/30">
              <AlertCircle className="w-4 h-4 text-blue-400" />
              <AlertDescription>
                <p className="font-medium text-blue-400 mb-2">Add this DNS TXT record to verify your domain:</p>
                <div className="bg-background/50 p-4 rounded-lg space-y-2 font-mono text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Type:</span>
                    <span>{dnsInstructions.type}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Name:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded">{dnsInstructions.name}</code>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(dnsInstructions.name)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Value:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-muted px-2 py-1 rounded">{dnsInstructions.value}</code>
                      <Button variant="ghost" size="sm" onClick={() => copyToClipboard(dnsInstructions.value)}>
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">TTL:</span>
                    <span>{dnsInstructions.ttl}</span>
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button
                    onClick={() => pendingDomainId && handleVerify(pendingDomainId)}
                    disabled={verifying}
                    variant="gamifiedSuccess"
                  >
                    {verifying ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <CheckCircle className="w-4 h-4 mr-2" />}
                    Verify Domain
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Empty State */}
          {domains.length === 0 && !showAddForm && (
            <div className="text-center py-8">
              <Mail className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-medium mb-2">No Email Domain Configured</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Add your company's email domain to send professional emails from your own address.
              </p>
              <Button onClick={() => setShowAddForm(true)} variant="gamified">
                <Globe className="w-4 h-4 mr-2" />
                Add Your Domain
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
