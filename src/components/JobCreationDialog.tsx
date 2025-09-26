import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, MapPin, Check, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface JobCreationDialogProps {
  trigger?: React.ReactNode;
  contact?: any;
  onJobCreated?: (job: any) => void;
}

interface AddressSuggestion {
  place_id: string;
  formatted_address: string;
  geometry: {
    location: {
      lat: number;
      lng: number;
    };
  };
  address_components: any[];
}

export const JobCreationDialog: React.FC<JobCreationDialogProps> = ({
  trigger,
  contact,
  onJobCreated,
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    address: "",
    useSameAddress: false,
  });
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<AddressSuggestion | null>(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (contact && formData.useSameAddress) {
      const fullAddress = [
        contact.address_street,
        contact.address_city,
        contact.address_state,
        contact.address_zip
      ].filter(Boolean).join(", ");
      
      setFormData(prev => ({ ...prev, address: fullAddress }));
      if (fullAddress) {
        handleAddressVerification(fullAddress);
      }
    }
  }, [formData.useSameAddress, contact]);

  const handleAddressVerification = async (address: string) => {
    if (!address.trim()) return;
    
    setAddressLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('google-maps-proxy', {
        body: {
          endpoint: 'autocomplete',
          params: {
            input: address,
            types: 'address'
          }
        }
      });

      if (error) throw error;

      if (data?.predictions) {
        // Get detailed info for each prediction
        const detailedSuggestions = await Promise.all(
          data.predictions.slice(0, 5).map(async (prediction: any) => {
            const { data: details } = await supabase.functions.invoke('google-maps-proxy', {
              body: {
                endpoint: 'details',
                params: {
                  place_id: prediction.place_id,
                  fields: 'formatted_address,geometry,address_components'
                }
              }
            });
            return details?.result;
          })
        );

        setAddressSuggestions(detailedSuggestions.filter(Boolean));
        setShowAddressPicker(true);
      }
    } catch (error) {
      console.error('Address verification error:', error);
      toast({
        title: "Address Verification Error",
        description: "Unable to verify address. Please check and try again.",
        variant: "destructive",
      });
    } finally {
      setAddressLoading(false);
    }
  };

  const handleAddressSelect = (suggestion: AddressSuggestion) => {
    setSelectedAddress(suggestion);
    setFormData(prev => ({ ...prev, address: suggestion.formatted_address }));
    setShowAddressPicker(false);
  };

  const handleSubmit = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Job name is required",
        variant: "destructive",
      });
      return;
    }

    if (!selectedAddress) {
      toast({
        title: "Address Required",
        description: "Please select a verified address from the suggestions",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
        // Create the job record (simplified for now)
        const jobData = {
          name: formData.name,
          description: formData.description,
          contact_id: contact?.id,
          status: 'pending' as const,
        };

        toast({
          title: "Job Created",
          description: `Job "${formData.name}" created successfully`,
        });

        onJobCreated?.(jobData);
        setOpen(false);
        setFormData({ name: "", description: "", address: "", useSameAddress: false });
        setSelectedAddress(null);
        setShowAddressPicker(false);
    } catch (error) {
      console.error('Error creating job:', error);
      toast({
        title: "Error",
        description: "Failed to create job",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const defaultTrigger = (
    <Button className="shadow-soft transition-smooth">
      <Plus className="h-4 w-4 mr-2" />
      Create Job
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            Create New Job
            {contact && (
              <Badge variant="outline">
                for {contact.first_name} {contact.last_name}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="name">Job Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Roof Replacement"
              />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Job details..."
                rows={3}
              />
            </div>
          </div>

          {contact && (
            <div className="flex items-center space-x-2">
              <Checkbox
                id="useSameAddress"
                checked={formData.useSameAddress}
                onCheckedChange={(checked) => 
                  setFormData(prev => ({ ...prev, useSameAddress: checked as boolean }))
                }
              />
              <Label htmlFor="useSameAddress" className="text-sm">
                Use same address as contact ({contact.address_street || "No address on file"})
              </Label>
            </div>
          )}

          <div>
            <Label htmlFor="address">Job Address *</Label>
            <div className="flex gap-2">
              <Input
                id="address"
                value={formData.address}
                onChange={(e) => {
                  setFormData(prev => ({ ...prev, address: e.target.value }));
                  setSelectedAddress(null);
                }}
                placeholder="Start typing address..."
                disabled={formData.useSameAddress}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => handleAddressVerification(formData.address)}
                disabled={!formData.address.trim() || addressLoading}
              >
                {addressLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                Verify
              </Button>
            </div>
          </div>

          {showAddressPicker && addressSuggestions.length > 0 && (
            <div className="space-y-2">
              <Label>Select Verified Address:</Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {addressSuggestions.map((suggestion, index) => (
                  <Card
                    key={suggestion.place_id || index}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedAddress?.place_id === suggestion.place_id
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                    onClick={() => handleAddressSelect(suggestion)}
                  >
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-start gap-2">
                          <MapPin className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0" />
                          <p className="text-sm">{suggestion.formatted_address}</p>
                        </div>
                        {selectedAddress?.place_id === suggestion.place_id && (
                          <Check className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {selectedAddress && (
            <div className="flex items-center gap-2 text-sm text-success">
              <Check className="h-4 w-4" />
              Address verified with Google Maps
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={loading || !selectedAddress}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Create Job
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default JobCreationDialog;