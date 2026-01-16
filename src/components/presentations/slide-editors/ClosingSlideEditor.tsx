import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { CheckCircle, Phone, Mail, FileSignature } from "lucide-react";

interface ClosingSlideEditorProps {
  slide: any;
  onUpdate: () => void;
}

export const ClosingSlideEditor = ({ slide, onUpdate }: ClosingSlideEditorProps) => {
  const { toast } = useToast();
  const [title, setTitle] = useState(slide.content?.title || "Ready to Get Started?");
  const [body, setBody] = useState(slide.content?.body || "");
  const [warranty, setWarranty] = useState(slide.content?.warranty || "");
  const [paymentTerms, setPaymentTerms] = useState(slide.content?.payment_terms || "");
  const [phone, setPhone] = useState(slide.content?.phone || "");
  const [email, setEmail] = useState(slide.content?.email || "");
  const [showSignature, setShowSignature] = useState(slide.content?.show_signature || false);

  useEffect(() => {
    setTitle(slide.content?.title || "Ready to Get Started?");
    setBody(slide.content?.body || "");
    setWarranty(slide.content?.warranty || "");
    setPaymentTerms(slide.content?.payment_terms || "");
    setPhone(slide.content?.phone || "");
    setEmail(slide.content?.email || "");
    setShowSignature(slide.content?.show_signature || false);
  }, [slide.id]);

  const handleUpdate = async (field: string, value: string | boolean) => {
    try {
      const updatedContent = {
        ...slide.content,
        [field]: value,
      };

      const { error } = await supabase
        .from("presentation_slides")
        .update({ content: updatedContent })
        .eq("id", slide.id);

      if (error) throw error;
      onUpdate();
    } catch (error: any) {
      console.error("Error updating slide:", error);
      toast({
        title: "Failed to update",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-8">
        <div className="text-center space-y-6">
          <CheckCircle className="h-16 w-16 text-primary mx-auto" />
          <h2 className="text-3xl font-bold">{title}</h2>
          {body && (
            <p className="text-xl text-muted-foreground">{body}</p>
          )}
          
          {(warranty || paymentTerms) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
              {warranty && (
                <Card className="p-4 bg-primary/5">
                  <h3 className="font-semibold mb-2">Warranty</h3>
                  <p className="text-sm text-muted-foreground">{warranty}</p>
                </Card>
              )}
              {paymentTerms && (
                <Card className="p-4 bg-primary/5">
                  <h3 className="font-semibold mb-2">Payment Terms</h3>
                  <p className="text-sm text-muted-foreground">{paymentTerms}</p>
                </Card>
              )}
            </div>
          )}

          <div className="flex justify-center gap-8 mt-6">
            {phone && (
              <div className="flex items-center gap-2 text-lg">
                <Phone className="h-5 w-5 text-primary" />
                <span>{phone}</span>
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2 text-lg">
                <Mail className="h-5 w-5 text-primary" />
                <span>{email}</span>
              </div>
            )}
          </div>

          {showSignature && (
            <div className="mt-8 p-6 border-2 border-dashed rounded-lg">
              <FileSignature className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">Signature capture will appear here</p>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => handleUpdate("title", e.target.value)}
            placeholder="Ready to Get Started?"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="body">Call to Action Message</Label>
          <Textarea
            id="body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onBlur={(e) => handleUpdate("body", e.target.value)}
            placeholder="We're excited to work with you on your roofing project..."
            className="min-h-[80px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={(e) => handleUpdate("phone", e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={(e) => handleUpdate("email", e.target.value)}
              placeholder="sales@company.com"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="warranty">Warranty Information</Label>
          <Textarea
            id="warranty"
            value={warranty}
            onChange={(e) => setWarranty(e.target.value)}
            onBlur={(e) => handleUpdate("warranty", e.target.value)}
            placeholder="10-year workmanship warranty included..."
            className="min-h-[60px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="payment-terms">Payment Terms</Label>
          <Textarea
            id="payment-terms"
            value={paymentTerms}
            onChange={(e) => setPaymentTerms(e.target.value)}
            onBlur={(e) => handleUpdate("payment_terms", e.target.value)}
            placeholder="50% deposit, 50% upon completion..."
            className="min-h-[60px]"
          />
        </div>

        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
          <div>
            <Label htmlFor="show-signature" className="text-base">
              Include Signature Capture
            </Label>
            <p className="text-sm text-muted-foreground">
              Allow customers to sign directly in the presentation
            </p>
          </div>
          <Switch
            id="show-signature"
            checked={showSignature}
            onCheckedChange={(checked) => {
              setShowSignature(checked);
              handleUpdate("show_signature", checked);
            }}
          />
        </div>
      </div>
    </div>
  );
};
