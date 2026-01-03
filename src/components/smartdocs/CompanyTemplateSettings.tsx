import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Upload, Save, Palette, FileText, Building2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useCompanySwitcher } from '@/hooks/useCompanySwitcher';

interface CompanyTemplateSettingsData {
  id?: string;
  tenant_id: string;
  location_id?: string | null;
  template_slug?: string | null;
  company_name?: string;
  company_logo_url?: string;
  company_address?: string;
  company_phone?: string;
  company_email?: string;
  company_license?: string;
  primary_color?: string;
  accent_color?: string;
  custom_header_html?: string;
  custom_footer_html?: string;
  default_terms?: string;
  warranty_text?: string;
  is_active?: boolean;
}

export function CompanyTemplateSettings() {
  const { activeCompanyId: currentTenantId } = useCompanySwitcher();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<CompanyTemplateSettingsData>({
    tenant_id: currentTenantId || '',
    primary_color: '#2563eb',
    accent_color: '#1e40af'
  });
  const [locations, setLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedLocation, setSelectedLocation] = useState<string>('default');

  useEffect(() => {
    if (currentTenantId) {
      fetchSettings();
      fetchLocations();
    }
  }, [currentTenantId, selectedLocation]);

  const fetchLocations = async () => {
    const { data } = await supabase
      .from('locations')
      .select('id, name')
      .eq('tenant_id', currentTenantId)
      .order('name');
    
    setLocations(data || []);
  };

  const fetchSettings = async () => {
    if (!currentTenantId) return;
    
    setLoading(true);
    try {
      let query = supabase
        .from('company_template_settings')
        .select('*')
        .eq('tenant_id', currentTenantId)
        .is('template_slug', null);
      
      if (selectedLocation === 'default') {
        query = query.is('location_id', null);
      } else {
        query = query.eq('location_id', selectedLocation);
      }

      const { data, error } = await query.maybeSingle();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (data) {
        setSettings(data);
      } else {
        // Load defaults from tenant
        const { data: tenant } = await supabase
          .from('tenants')
          .select('name, settings, logo_url')
          .eq('id', currentTenantId)
          .single();
        
        setSettings({
          tenant_id: currentTenantId,
          location_id: selectedLocation === 'default' ? null : selectedLocation,
          company_name: tenant?.name,
          company_logo_url: tenant?.logo_url,
          company_phone: (tenant?.settings as any)?.phone,
          company_email: (tenant?.settings as any)?.email,
          company_address: (tenant?.settings as any)?.address,
          primary_color: '#2563eb',
          accent_color: '#1e40af'
        });
      }
    } catch (error) {
      console.error('Error fetching settings:', error);
      toast.error('Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!currentTenantId) return;
    
    setSaving(true);
    try {
      const payload = {
        ...settings,
        tenant_id: currentTenantId,
        location_id: selectedLocation === 'default' ? null : selectedLocation,
        template_slug: null,
        is_active: true
      };

      if (settings.id) {
        const { error } = await supabase
          .from('company_template_settings')
          .update(payload)
          .eq('id', settings.id);
        
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('company_template_settings')
          .insert(payload)
          .select()
          .single();
        
        if (error) throw error;
        setSettings(data);
      }

      toast.success('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentTenantId) return;

    try {
      const fileName = `${currentTenantId}/logo-${Date.now()}.${file.name.split('.').pop()}`;
      const { error: uploadError } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('company-assets')
        .getPublicUrl(fileName);

      setSettings(prev => ({ ...prev, company_logo_url: publicUrl }));
      toast.success('Logo uploaded');
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast.error('Failed to upload logo');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Company Branding
          </h2>
          <p className="text-muted-foreground">
            Configure branding that applies to all generated documents
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedLocation} onValueChange={setSelectedLocation}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select location" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default (All Locations)</SelectItem>
              {locations.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            ) : (
              <><Save className="mr-2 h-4 w-4" /> Save Settings</>
            )}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
          <TabsTrigger value="content">Default Content</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Company Information</CardTitle>
              <CardDescription>
                Basic company details shown on all documents
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Company Name</Label>
                <Input
                  value={settings.company_name || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, company_name: e.target.value }))}
                  placeholder="Your Company Name"
                />
              </div>
              <div className="space-y-2">
                <Label>License Number</Label>
                <Input
                  value={settings.company_license || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, company_license: e.target.value }))}
                  placeholder="CCC-123456"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input
                  value={settings.company_phone || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, company_phone: e.target.value }))}
                  placeholder="(555) 123-4567"
                />
              </div>
              <div className="space-y-2">
                <Label>Email Address</Label>
                <Input
                  type="email"
                  value={settings.company_email || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, company_email: e.target.value }))}
                  placeholder="info@yourcompany.com"
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Company Address</Label>
                <Textarea
                  value={settings.company_address || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, company_address: e.target.value }))}
                  placeholder="123 Main Street, City, State ZIP"
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5" />
                Visual Branding
              </CardTitle>
              <CardDescription>
                Logo and colors used in document templates
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-4">
                  <Label>Company Logo</Label>
                  <div className="flex items-center gap-4">
                    {settings.company_logo_url ? (
                      <img
                        src={settings.company_logo_url}
                        alt="Company Logo"
                        className="h-16 w-auto object-contain border rounded"
                      />
                    ) : (
                      <div className="h-16 w-32 border-2 border-dashed rounded flex items-center justify-center text-muted-foreground">
                        No logo
                      </div>
                    )}
                    <label className="cursor-pointer">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <Button variant="outline" size="sm" asChild>
                        <span><Upload className="mr-2 h-4 w-4" /> Upload Logo</span>
                      </Button>
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Primary Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={settings.primary_color || '#2563eb'}
                          onChange={(e) => setSettings(prev => ({ ...prev, primary_color: e.target.value }))}
                          className="h-10 w-10 rounded cursor-pointer"
                        />
                        <Input
                          value={settings.primary_color || '#2563eb'}
                          onChange={(e) => setSettings(prev => ({ ...prev, primary_color: e.target.value }))}
                          className="flex-1"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Accent Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          value={settings.accent_color || '#1e40af'}
                          onChange={(e) => setSettings(prev => ({ ...prev, accent_color: e.target.value }))}
                          className="h-10 w-10 rounded cursor-pointer"
                        />
                        <Input
                          value={settings.accent_color || '#1e40af'}
                          onChange={(e) => setSettings(prev => ({ ...prev, accent_color: e.target.value }))}
                          className="flex-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <h4 className="font-medium mb-4">Preview</h4>
                <div 
                  className="rounded-lg p-6 text-white"
                  style={{ background: `linear-gradient(135deg, ${settings.primary_color} 0%, ${settings.accent_color} 100%)` }}
                >
                  <div className="flex items-center gap-4">
                    {settings.company_logo_url && (
                      <img src={settings.company_logo_url} alt="" className="h-12 w-auto" />
                    )}
                    <div>
                      <h3 className="text-xl font-bold">{settings.company_name || 'Your Company'}</h3>
                      <p className="text-sm opacity-80">{settings.company_phone}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="content" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Default Document Content
              </CardTitle>
              <CardDescription>
                Standard terms and warranty text included in proposals and contracts
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>Default Terms & Conditions</Label>
                <Textarea
                  value={settings.default_terms || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, default_terms: e.target.value }))}
                  placeholder="Enter your standard terms and conditions..."
                  rows={6}
                />
              </div>
              <div className="space-y-2">
                <Label>Warranty Text</Label>
                <Textarea
                  value={settings.warranty_text || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, warranty_text: e.target.value }))}
                  placeholder="Enter your warranty information..."
                  rows={4}
                />
              </div>
              <div className="space-y-2">
                <Label>Custom Header HTML (optional)</Label>
                <Textarea
                  value={settings.custom_header_html || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, custom_header_html: e.target.value }))}
                  placeholder="<div>Custom header content...</div>"
                  rows={3}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-2">
                <Label>Custom Footer HTML (optional)</Label>
                <Textarea
                  value={settings.custom_footer_html || ''}
                  onChange={(e) => setSettings(prev => ({ ...prev, custom_footer_html: e.target.value }))}
                  placeholder="<div>Custom footer content...</div>"
                  rows={3}
                  className="font-mono text-sm"
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
