import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { ArrowLeft, Save, FileText, MessageSquare, Settings2, MapPin } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';

export default function StormCanvassConfig() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const [settings, setSettings] = useState({
    // Form Settings
    requirePhoto: true,
    requireNotes: false,
    autoGeoTag: true,
    
    // Scripts
    doorKnockScript: `Hi, my name is [Your Name] from [Company]. We're in the area helping homeowners assess storm damage to their roofs. Have you noticed any issues with your roof after the recent storm?`,
    followUpScript: `Hi [Contact Name], this is [Your Name] following up from our visit. I wanted to see if you had any questions about the inspection we discussed.`,
    
    // Disposition Options
    dispositions: ['Interested', 'Not Home', 'Not Interested', 'Appointment Set', 'Already Has Contractor', 'Renter'],
    
    // Territory Settings
    defaultRadius: 500,
    autoAssignLeads: true
  });

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate save
    await new Promise(resolve => setTimeout(resolve, 1000));
    toast({
      title: "Settings saved",
      description: "Your canvassing configuration has been updated."
    });
    setIsSaving(false);
  };

  return (
    <GlobalLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate('/storm-canvass')}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold">Canvassing Configuration</h1>
              <p className="text-muted-foreground">
                Set up forms, scripts, and workflows
              </p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={isSaving}>
            <Save className="h-4 w-4 mr-2" />
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>

        <Tabs defaultValue="forms" className="space-y-6">
          <TabsList>
            <TabsTrigger value="forms" className="gap-2">
              <FileText className="h-4 w-4" />
              Form Settings
            </TabsTrigger>
            <TabsTrigger value="scripts" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              Scripts
            </TabsTrigger>
            <TabsTrigger value="dispositions" className="gap-2">
              <Settings2 className="h-4 w-4" />
              Dispositions
            </TabsTrigger>
            <TabsTrigger value="territory" className="gap-2">
              <MapPin className="h-4 w-4" />
              Territory
            </TabsTrigger>
          </TabsList>

          <TabsContent value="forms">
            <Card>
              <CardHeader>
                <CardTitle>Form Requirements</CardTitle>
                <CardDescription>
                  Configure what data canvassers must collect at each door
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <Label>Require Photo</Label>
                    <p className="text-sm text-muted-foreground">
                      Canvassers must take at least one photo
                    </p>
                  </div>
                  <Switch
                    checked={settings.requirePhoto}
                    onCheckedChange={(checked) => setSettings(s => ({ ...s, requirePhoto: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Require Notes</Label>
                    <p className="text-sm text-muted-foreground">
                      Notes field must be filled before submission
                    </p>
                  </div>
                  <Switch
                    checked={settings.requireNotes}
                    onCheckedChange={(checked) => setSettings(s => ({ ...s, requireNotes: checked }))}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto Geo-Tag</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically capture GPS coordinates
                    </p>
                  </div>
                  <Switch
                    checked={settings.autoGeoTag}
                    onCheckedChange={(checked) => setSettings(s => ({ ...s, autoGeoTag: checked }))}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="scripts">
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Door Knock Script</CardTitle>
                  <CardDescription>
                    Initial script when approaching a door
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={settings.doorKnockScript}
                    onChange={(e) => setSettings(s => ({ ...s, doorKnockScript: e.target.value }))}
                    rows={5}
                    placeholder="Enter your door knock script..."
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Follow-Up Script</CardTitle>
                  <CardDescription>
                    Script for following up with interested leads
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={settings.followUpScript}
                    onChange={(e) => setSettings(s => ({ ...s, followUpScript: e.target.value }))}
                    rows={5}
                    placeholder="Enter your follow-up script..."
                  />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="dispositions">
            <Card>
              <CardHeader>
                <CardTitle>Disposition Options</CardTitle>
                <CardDescription>
                  Outcomes canvassers can select after each door knock
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {settings.dispositions.map((disposition, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={disposition}
                      onChange={(e) => {
                        const newDispositions = [...settings.dispositions];
                        newDispositions[index] = e.target.value;
                        setSettings(s => ({ ...s, dispositions: newDispositions }));
                      }}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        const newDispositions = settings.dispositions.filter((_, i) => i !== index);
                        setSettings(s => ({ ...s, dispositions: newDispositions }));
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  onClick={() => setSettings(s => ({ ...s, dispositions: [...s.dispositions, 'New Disposition'] }))}
                >
                  Add Disposition
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="territory">
            <Card>
              <CardHeader>
                <CardTitle>Territory Settings</CardTitle>
                <CardDescription>
                  Configure default territory and lead assignment rules
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <Label>Default Canvass Radius (meters)</Label>
                  <Input
                    type="number"
                    value={settings.defaultRadius}
                    onChange={(e) => setSettings(s => ({ ...s, defaultRadius: parseInt(e.target.value) || 500 }))}
                  />
                  <p className="text-sm text-muted-foreground">
                    Default radius for territory boundaries
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Auto-Assign Leads</Label>
                    <p className="text-sm text-muted-foreground">
                      Automatically assign leads to the canvasser who created them
                    </p>
                  </div>
                  <Switch
                    checked={settings.autoAssignLeads}
                    onCheckedChange={(checked) => setSettings(s => ({ ...s, autoAssignLeads: checked }))}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </GlobalLayout>
  );
}
