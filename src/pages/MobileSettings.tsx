import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { clearAllMobileCache, getPendingSyncCount } from '@/lib/mobileCache';
import { ArrowLeft, Trash2, CloudOff, Bell, Shield, User, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';

const ALERT_TYPES = [
  { key: 'new_lead_assigned', label: 'New Lead Assigned' },
  { key: 'appointment_reminder', label: 'Appointment Reminder' },
  { key: 'inspection_due', label: 'Inspection Due' },
  { key: 'estimate_ready', label: 'Estimate Ready' },
  { key: 'contract_signed', label: 'Contract Signed' },
  { key: 'document_uploaded', label: 'Document Uploaded' },
  { key: 'payment_received', label: 'Payment Received' },
  { key: 'task_assigned', label: 'Task Assigned' },
  { key: 'job_status_changed', label: 'Job Status Changed' },
  { key: 'storm_event_alert', label: 'Storm Event Alert' },
];

const MobileSettings = () => {
  const navigate = useNavigate();
  const { user: currentUser } = useCurrentUser();
  const { toast } = useToast();
  const [pendingCount, setPendingCount] = useState(0);
  const [alertPrefs, setAlertPrefs] = useState<Record<string, boolean>>({});
  const [faceIdRequired, setFaceIdRequired] = useState(false);

  useEffect(() => {
    getPendingSyncCount().then(setPendingCount);
    // Load prefs from localStorage
    const stored = localStorage.getItem('pitchcrm_alert_prefs');
    if (stored) {
      setAlertPrefs(JSON.parse(stored));
    } else {
      // Default all on
      const defaults: Record<string, boolean> = {};
      ALERT_TYPES.forEach(t => (defaults[t.key] = true));
      setAlertPrefs(defaults);
    }
    setFaceIdRequired(localStorage.getItem('pitchcrm_faceid_required') === 'true');
  }, []);

  const toggleAlert = (key: string) => {
    const updated = { ...alertPrefs, [key]: !alertPrefs[key] };
    setAlertPrefs(updated);
    localStorage.setItem('pitchcrm_alert_prefs', JSON.stringify(updated));
  };

  const handleClearCache = async () => {
    await clearAllMobileCache();
    setPendingCount(0);
    toast({ title: 'Cache cleared', description: 'All local data has been removed' });
  };

  const toggleFaceId = () => {
    const next = !faceIdRequired;
    setFaceIdRequired(next);
    localStorage.setItem('pitchcrm_faceid_required', String(next));
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-10 bg-background border-b border-border px-4 py-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-semibold text-foreground">Settings</h1>
      </div>

      <div className="p-4 space-y-4">
        {/* User info */}
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                {currentUser?.first_name} {currentUser?.last_name}
              </p>
              <p className="text-xs text-muted-foreground">{currentUser?.email}</p>
              <p className="text-xs text-muted-foreground">{currentUser?.company_name}</p>
            </div>
          </CardContent>
        </Card>

        {/* FaceID */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <span className="text-sm text-foreground">Require FaceID for Actions</span>
              </div>
              <Switch checked={faceIdRequired} onCheckedChange={toggleFaceId} />
            </div>
          </CardContent>
        </Card>

        {/* Alert preferences */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium text-foreground">Push Notifications</span>
            </div>
            {ALERT_TYPES.map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-foreground">{label}</span>
                <Switch checked={alertPrefs[key] ?? true} onCheckedChange={() => toggleAlert(key)} />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Cache */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CloudOff className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">Pending Sync Items</span>
              </div>
              <span className="text-sm font-medium text-foreground">{pendingCount}</span>
            </div>
            <Button variant="destructive" size="sm" className="w-full" onClick={handleClearCache}>
              <Trash2 className="h-4 w-4 mr-2" />
              Clear Local Cache
            </Button>
          </CardContent>
        </Card>

        {/* App info */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">PitchCRM v1.0.0 · Mobile Field App</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MobileSettings;
