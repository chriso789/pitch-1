import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Edit, Power } from "lucide-react";

interface Vendor {
  id: string;
  name: string;
  contact_email: string | null;
}

interface VendorBulkActionsProps {
  selectedVendors: Vendor[];
  onActionComplete: () => void;
  onClearSelection: () => void;
}

export function VendorBulkActions({ selectedVendors, onActionComplete, onClearSelection }: VendorBulkActionsProps) {
  const { toast } = useToast();
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [emailData, setEmailData] = useState({
    subject: '',
    message: ''
  });

  const handleBulkEmail = async () => {
    setLoading(true);
    try {
      const vendorsWithEmail = selectedVendors.filter(v => v.contact_email);
      
      if (vendorsWithEmail.length === 0) {
        throw new Error('No vendors with email addresses selected');
      }

      const { error } = await supabase.functions.invoke('material-order-send-email', {
        body: {
          action: 'bulk_vendor_notification',
          vendors: vendorsWithEmail.map(v => ({
            id: v.id,
            name: v.name,
            email: v.contact_email
          })),
          subject: emailData.subject,
          message: emailData.message
        }
      });

      if (error) throw error;

      toast({
        title: "Emails Sent",
        description: `Sent ${vendorsWithEmail.length} email(s) successfully.`
      });

      setEmailDialogOpen(false);
      setEmailData({ subject: '', message: '' });
      onActionComplete();
      onClearSelection();
    } catch (error: any) {
      console.error('Error sending bulk emails:', error);
      toast({
        title: "Failed to send emails",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleBulkStatusChange = async (isActive: boolean) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('vendors')
        .update({ is_active: isActive })
        .in('id', selectedVendors.map(v => v.id));

      if (error) throw error;

      toast({
        title: "Vendors Updated",
        description: `Updated ${selectedVendors.length} vendor(s) to ${isActive ? 'active' : 'inactive'}.`
      });

      setStatusDialogOpen(false);
      onActionComplete();
      onClearSelection();
    } catch (error: any) {
      console.error('Error updating vendors:', error);
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  if (selectedVendors.length === 0) return null;

  return (
    <div className="flex items-center gap-2 p-4 bg-muted/50 rounded-lg">
      <span className="text-sm font-medium">
        {selectedVendors.length} vendor(s) selected
      </span>
      
      <div className="flex gap-2 ml-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setEmailDialogOpen(true)}
        >
          <Mail className="h-4 w-4 mr-2" />
          Send Email
        </Button>
        
        <Button
          variant="outline"
          size="sm"
          onClick={() => setStatusDialogOpen(true)}
        >
          <Power className="h-4 w-4 mr-2" />
          Change Status
        </Button>

        <Button
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
        >
          Clear
        </Button>
      </div>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Bulk Email</DialogTitle>
            <DialogDescription>
              Send email to {selectedVendors.filter(v => v.contact_email).length} vendor(s) with email addresses
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="subject">Subject</Label>
              <Input
                id="subject"
                value={emailData.subject}
                onChange={(e) => setEmailData({ ...emailData, subject: e.target.value })}
                placeholder="Email subject"
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="message">Message</Label>
              <Textarea
                id="message"
                value={emailData.message}
                onChange={(e) => setEmailData({ ...emailData, message: e.target.value })}
                placeholder="Email message"
                rows={6}
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleBulkEmail} disabled={loading || !emailData.subject || !emailData.message}>
                {loading ? "Sending..." : "Send Emails"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Vendor Status</DialogTitle>
            <DialogDescription>
              Update the status of {selectedVendors.length} selected vendor(s)
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleBulkStatusChange(true)}
              disabled={loading}
            >
              Set Active
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => handleBulkStatusChange(false)}
              disabled={loading}
            >
              Set Inactive
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
