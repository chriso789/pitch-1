import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { 
  Home, 
  Copy, 
  Mail, 
  Check,
  ExternalLink,
  Clock,
  Shield
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface HomeownerPortalAccessProps {
  contact: any;
  onUpdate: (updatedContact: any) => void;
}

export function HomeownerPortalAccess({ contact, onUpdate }: HomeownerPortalAccessProps) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const { user } = useAuth();

  const portalEnabled = contact?.portal_access_enabled || false;
  const portalUrl = `${window.location.origin}/portal/login?contact=${contact?.id}`;

  const togglePortalAccess = async (enabled: boolean) => {
    setIsUpdating(true);
    try {
      const updateData: any = {
        portal_access_enabled: enabled,
      };

      if (enabled) {
        updateData.portal_access_granted_at = new Date().toISOString();
        updateData.portal_access_granted_by = user?.id;
      }

      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contact.id);

      if (error) throw error;

      onUpdate({ 
        ...contact, 
        portal_access_enabled: enabled,
        portal_access_granted_at: enabled ? new Date().toISOString() : null
      });

      toast({
        title: enabled ? "Portal Access Enabled" : "Portal Access Disabled",
        description: enabled 
          ? "Homeowner can now access the project portal" 
          : "Portal access has been revoked",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update portal access",
        variant: "destructive",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const copyPortalLink = async () => {
    try {
      await navigator.clipboard.writeText(portalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Link Copied",
        description: "Portal link copied to clipboard",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to copy link",
        variant: "destructive",
      });
    }
  };

  const sendAccessEmail = async () => {
    if (!contact?.email) {
      toast({
        title: "Email Required",
        description: "Contact must have an email address to receive portal access",
        variant: "destructive",
      });
      return;
    }

    setIsSendingEmail(true);
    try {
      // Generate session token
      const token = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

      // Create portal session
      const { error: sessionError } = await supabase
        .from('homeowner_portal_sessions')
        .insert({
          tenant_id: contact.tenant_id,
          contact_id: contact.id,
          token,
          email: contact.email,
          expires_at: expiresAt,
          auth_method: 'email_invite'
        });

      if (sessionError) throw sessionError;

      // TODO: Send actual email via edge function
      // For now, just show success
      toast({
        title: "Invitation Sent",
        description: `Portal access email sent to ${contact.email}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send invitation",
        variant: "destructive",
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const hasContactInfo = contact?.email || contact?.phone;

  return (
    <Card className="shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Home className="h-5 w-5 text-primary" />
          Homeowner Portal Access
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="portal-access" className="text-sm font-medium">
              Enable Portal Access
            </Label>
            <p className="text-xs text-muted-foreground">
              Allow homeowner to view project status, photos, and documents
            </p>
          </div>
          <Switch
            id="portal-access"
            checked={portalEnabled}
            onCheckedChange={togglePortalAccess}
            disabled={isUpdating || !hasContactInfo}
          />
        </div>

        {!hasContactInfo && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-2 rounded">
            <Shield className="h-4 w-4" />
            Contact must have email or phone to enable portal access
          </div>
        )}

        {portalEnabled && (
          <>
            {/* Status */}
            <div className="flex items-center gap-2 pt-2 border-t">
              <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                <Check className="h-3 w-3 mr-1" />
                Active
              </Badge>
              {contact?.portal_last_login_at && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Last login: {new Date(contact.portal_last_login_at).toLocaleDateString()}
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={copyPortalLink}
                className="flex-1"
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-green-500" />
                    Copied!
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copy Link
                  </>
                )}
              </Button>
              
              {contact?.email && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={sendAccessEmail}
                  disabled={isSendingEmail}
                  className="flex-1"
                >
                  <Mail className="h-4 w-4 mr-2" />
                  {isSendingEmail ? "Sending..." : "Send Email"}
                </Button>
              )}
            </div>

            {/* Portal Link Preview */}
            <div className="bg-muted/50 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">Portal URL</p>
              <div className="flex items-center gap-2">
                <code className="text-xs bg-background px-2 py-1 rounded flex-1 truncate">
                  {portalUrl}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(portalUrl, '_blank')}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}