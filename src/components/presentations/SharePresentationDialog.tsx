import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Share2, Copy, Check } from "lucide-react";

interface SharePresentationDialogProps {
  presentationId: string;
}

export const SharePresentationDialog = ({ presentationId }: SharePresentationDialogProps) => {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState<string>("");
  const [expiresIn, setExpiresIn] = useState("7 days");
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleGenerateLink = async () => {
    try {
      const { data, error } = await supabase.rpc("generate_presentation_token", {
        p_presentation_id: presentationId,
        p_contact_id: contactId || null,
        p_expires_in: expiresIn,
      });

      if (error) throw error;

      const link = `${window.location.origin}/presentations/${presentationId}/view/${data}`;
      setShareLink(link);

      toast({
        title: "Link generated",
        description: "Share this link with your customer",
      });
    } catch (error: any) {
      toast({
        title: "Failed to generate link",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleCopyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Link copied",
        description: "Share link copied to clipboard",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Share2 className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Presentation</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Link Expiration</Label>
            <Select value={expiresIn} onValueChange={setExpiresIn}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1 day">1 Day</SelectItem>
                <SelectItem value="7 days">7 Days</SelectItem>
                <SelectItem value="30 days">30 Days</SelectItem>
                <SelectItem value="90 days">90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!shareLink ? (
            <Button onClick={handleGenerateLink} className="w-full">
              Generate Share Link
            </Button>
          ) : (
            <div className="space-y-2">
              <Label>Share Link</Label>
              <div className="flex gap-2">
                <Input value={shareLink} readOnly />
                <Button onClick={handleCopyLink} variant="outline" size="icon">
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
