import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Phone, Mail, MapPin, Users, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";

interface SkipTraceModalProps {
  contactId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SkipTraceModal = ({ contactId, open, onOpenChange }: SkipTraceModalProps) => {
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState<any>(null);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      fetchLatestResults();
    }
  }, [open, contactId]);

  const fetchLatestResults = async () => {
    try {
      const { data, error } = await supabase
        .from('skip_trace_results')
        .select('*')
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error) throw error;
      setResults(data);
    } catch (error) {
      console.error('Error fetching skip trace results:', error);
      toast({
        title: "Error",
        description: "Failed to load skip trace results",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleApplySuggestion = async (field: string, value: any) => {
    try {
      const updateData: any = {};
      
      if (field === 'phone') {
        updateData.phone = value;
      } else if (field === 'email') {
        updateData.email = value;
      } else if (field === 'address') {
        updateData.address_street = value.street;
        updateData.address_city = value.city;
        updateData.address_state = value.state;
        updateData.address_zip = value.zip;
      }

      const { error } = await supabase
        .from('contacts')
        .update(updateData)
        .eq('id', contactId);

      if (error) throw error;

      toast({
        title: "Contact Updated",
        description: `${field} has been updated successfully`,
      });
      
      onOpenChange(false);
    } catch (error) {
      console.error('Error updating contact:', error);
      toast({
        title: "Update Failed",
        description: "Failed to update contact information",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!results) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No Results Found</DialogTitle>
            <DialogDescription>
              No skip trace results available for this contact.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const enrichedData = results.enriched_data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Skip Trace Results</DialogTitle>
          <DialogDescription>
            Data found from SearchBug • Cost: ${results.cost?.toFixed(2)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Confidence Score */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Confidence:</span>
            <Badge variant={enrichedData.confidence_score > 75 ? "default" : "secondary"}>
              {enrichedData.confidence_score}%
            </Badge>
          </div>

          <Separator />

          {/* Phone Numbers */}
          {enrichedData.phones?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                <h3 className="font-medium">Phone Numbers ({enrichedData.phones.length})</h3>
              </div>
              <div className="space-y-2 pl-6">
                {enrichedData.phones.map((phone: string, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-secondary/20 rounded">
                    <span>{phone}</span>
                    <Button
                      size="sm"
                      onClick={() => handleApplySuggestion('phone', phone)}
                    >
                      Apply
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Email Addresses */}
          {enrichedData.emails?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                <h3 className="font-medium">Email Addresses ({enrichedData.emails.length})</h3>
              </div>
              <div className="space-y-2 pl-6">
                {enrichedData.emails.map((email: string, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-secondary/20 rounded">
                    <span>{email}</span>
                    <Button
                      size="sm"
                      onClick={() => handleApplySuggestion('email', email)}
                    >
                      Apply
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Addresses */}
          {enrichedData.addresses?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                <h3 className="font-medium">Addresses ({enrichedData.addresses.length})</h3>
              </div>
              <div className="space-y-2 pl-6">
                {enrichedData.addresses.map((address: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-secondary/20 rounded">
                    <div>
                      <div>{address.street}</div>
                      <div className="text-sm text-muted-foreground">
                        {address.city}, {address.state} {address.zip}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => handleApplySuggestion('address', address)}
                    >
                      Apply
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Relatives */}
          {enrichedData.relatives?.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                <h3 className="font-medium">Relatives ({enrichedData.relatives.length})</h3>
              </div>
              <div className="space-y-1 pl-6">
                {enrichedData.relatives.map((relative: string, idx: number) => (
                  <div key={idx} className="text-sm p-2 bg-secondary/20 rounded">
                    {relative}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Demographics */}
          {enrichedData.demographics && Object.keys(enrichedData.demographics).length > 0 && (
            <div className="space-y-2">
              <h3 className="font-medium">Demographics</h3>
              <div className="grid grid-cols-2 gap-2 pl-6">
                {Object.entries(enrichedData.demographics).map(([key, value]: [string, any]) => (
                  <div key={key} className="text-sm">
                    <span className="font-medium capitalize">{key}: </span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          {/* Cost Summary */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <DollarSign className="h-4 w-4" />
            <span>Lookup Cost: ${results.cost?.toFixed(2)}</span>
            <span className="ml-auto">
              {new Date(results.created_at).toLocaleString()}
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
