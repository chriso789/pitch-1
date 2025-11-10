import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { X, MapPin, Calendar, User, CheckCircle2, XCircle, Clock, Home } from 'lucide-react';
import { format } from 'date-fns';
import { CanvassActivity, Disposition, useStormCanvass } from '@/hooks/useStormCanvass';
import { useNavigate } from 'react-router-dom';

interface DispositionPanelProps {
  activity: CanvassActivity | null;
  dispositions: Disposition[];
  onClose: () => void;
  onUpdate: () => void;
}

export const DispositionPanel = ({
  activity,
  dispositions,
  onClose,
  onUpdate,
}: DispositionPanelProps) => {
  const [notes, setNotes] = useState('');
  const [selectedDisposition, setSelectedDisposition] = useState<string | null>(null);
  const { updateDisposition, loading } = useStormCanvass();
  const navigate = useNavigate();

  if (!activity) return null;

  const contact = activity.contact;
  const user = activity.user;

  const handleUpdateDisposition = async () => {
    if (!contact?.id || !selectedDisposition) return;

    try {
      await updateDisposition(contact.id, selectedDisposition, notes);
      setNotes('');
      setSelectedDisposition(null);
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Failed to update disposition:', error);
    }
  };

  const getDispositionColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'qualified':
      case 'interested':
        return 'bg-success/20 text-success';
      case 'not_qualified':
      case 'not_interested':
        return 'bg-destructive/20 text-destructive';
      case 'callback':
      case 'follow_up':
        return 'bg-warning/20 text-warning';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  const getDispositionIcon = (disposition: Disposition) => {
    if (disposition.is_positive) return <CheckCircle2 className="h-4 w-4" />;
    if (disposition.name.toLowerCase().includes('home')) return <Home className="h-4 w-4" />;
    if (disposition.name.toLowerCase().includes('callback')) return <Clock className="h-4 w-4" />;
    return <XCircle className="h-4 w-4" />;
  };

  return (
    <Card className="absolute top-4 right-4 z-10 w-96 shadow-lg max-h-[90vh] overflow-y-auto">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-lg">Property Details</CardTitle>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {contact && (
          <>
            <div>
              <h4 className="font-semibold mb-2">
                {contact.first_name} {contact.last_name}
              </h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                  <span>
                    {contact.address_street}
                    {contact.address_city && (
                      <>
                        <br />
                        {contact.address_city}, {contact.address_state} {contact.address_zip}
                      </>
                    )}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span>Last Contact: {format(new Date(activity.created_at), 'MMM dd, yyyy')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>
                    Rep: {user?.first_name} {user?.last_name}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <Label>Current Status</Label>
              <Badge className={`mt-1 ${getDispositionColor(contact.qualification_status)}`}>
                {contact.qualification_status?.replace(/_/g, ' ').toUpperCase() || 'NO STATUS'}
              </Badge>
            </div>

            <div>
              <Label className="mb-2 block">Update Disposition</Label>
              <div className="grid grid-cols-2 gap-2">
                {dispositions.map((disposition) => (
                  <Button
                    key={disposition.id}
                    variant={selectedDisposition === disposition.id ? 'default' : 'outline'}
                    size="sm"
                    className="justify-start gap-2"
                    onClick={() => setSelectedDisposition(disposition.id)}
                  >
                    {getDispositionIcon(disposition)}
                    {disposition.name}
                  </Button>
                ))}
              </div>
            </div>

            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Add notes about this contact..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="mt-1"
              />
            </div>

            <div className="flex gap-2">
              <Button
                className="flex-1"
                disabled={!selectedDisposition || loading}
                onClick={handleUpdateDisposition}
              >
                {loading ? 'Updating...' : 'Update Disposition'}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate(`/contact/${contact.id}`)}
              >
                View Full Profile
              </Button>
            </div>
          </>
        )}

        {!contact && (
          <div className="text-center py-8 text-muted-foreground">
            <p>No contact information available</p>
            <p className="text-sm mt-1">Activity recorded without contact details</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
