import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { CheckCircle, ChevronRight, Loader2 } from 'lucide-react';
import { ADDITIONAL_SERVICES } from '../hooks/useCustomerPortal';
import { cn } from '@/lib/utils';

interface AdditionalServicesCardProps {
  onRequestQuote: (serviceType: string, description?: string) => Promise<void>;
}

export function AdditionalServicesCard({ onRequestQuote }: AdditionalServicesCardProps) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestedServices, setRequestedServices] = useState<string[]>([]);
  const [showDialog, setShowDialog] = useState(false);

  const handleSubmit = async () => {
    if (!selectedService) return;
    
    setIsSubmitting(true);
    try {
      await onRequestQuote(selectedService, description);
      setRequestedServices(prev => [...prev, selectedService]);
      setSelectedService(null);
      setDescription('');
      setShowDialog(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Additional Services</CardTitle>
        <CardDescription>Request a quote for other services</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {ADDITIONAL_SERVICES.map((service) => {
            const isRequested = requestedServices.includes(service.id);
            
            return (
              <Dialog 
                key={service.id} 
                open={showDialog && selectedService === service.id} 
                onOpenChange={(open) => {
                  if (open) {
                    setSelectedService(service.id);
                    setShowDialog(true);
                  } else {
                    setShowDialog(false);
                  }
                }}
              >
                <DialogTrigger asChild>
                  <button
                    disabled={isRequested}
                    className={cn(
                      "flex flex-col items-center gap-2 p-4 rounded-lg border transition-all",
                      "hover:border-primary/50 hover:bg-primary/5",
                      isRequested && "bg-green-500/10 border-green-500/30"
                    )}
                  >
                    <span className="text-2xl">{service.icon}</span>
                    <span className="text-sm font-medium">{service.name}</span>
                    {isRequested && (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    )}
                  </button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <span className="text-2xl">{service.icon}</span>
                      Request {service.name} Quote
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Additional Details (optional)</Label>
                      <Textarea
                        placeholder="Tell us more about what you're looking for..."
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                      />
                    </div>
                    <Button 
                      onClick={handleSubmit} 
                      disabled={isSubmitting}
                      className="w-full"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                          Submitting...
                        </>
                      ) : (
                        <>
                          Request Quote
                          <ChevronRight className="w-4 h-4 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
