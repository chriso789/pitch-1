import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Scale, Loader2, CheckCircle } from 'lucide-react';

interface AttorneyRequestCardProps {
  onRequestAttorney: (reason: string) => Promise<void>;
}

export function AttorneyRequestCard({ onRequestAttorney }: AttorneyRequestCardProps) {
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasRequested, setHasRequested] = useState(false);
  const [showDialog, setShowDialog] = useState(false);

  const handleSubmit = async () => {
    if (!reason.trim()) return;
    
    setIsSubmitting(true);
    try {
      await onRequestAttorney(reason);
      setHasRequested(true);
      setShowDialog(false);
      setReason('');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (hasRequested) {
    return (
      <Card className="border-green-500/30 bg-green-500/5">
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-500" />
            </div>
            <div>
              <h3 className="font-semibold">Attorney Request Submitted</h3>
              <p className="text-sm text-muted-foreground">
                An attorney will contact you within 24-48 hours.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scale className="w-5 h-5 text-primary" />
          Legal Assistance
        </CardTitle>
        <CardDescription>
          Request a consultation with an attorney
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button variant="outline" className="w-full">
              <Scale className="w-4 h-4 mr-2" />
              Request Attorney Consultation
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Request Attorney Consultation</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Please describe your legal concern and an attorney will contact you within 24-48 hours.
              </p>
              <div className="space-y-2">
                <Label>Describe your concern *</Label>
                <Textarea
                  placeholder="Please explain what you need legal assistance with..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={4}
                />
              </div>
              <Button 
                onClick={handleSubmit} 
                disabled={!reason.trim() || isSubmitting}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  'Submit Request'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
