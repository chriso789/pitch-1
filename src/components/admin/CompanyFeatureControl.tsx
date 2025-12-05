import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { 
  Search, 
  RefreshCw, 
  Zap, 
  Building2,
  Phone,
  FileText,
  MapPin,
  Camera,
  CreditCard,
  BarChart3,
  Target,
  Ruler,
  FolderKanban,
  Loader2
} from 'lucide-react';

interface Company {
  id: string;
  name: string;
  is_active: boolean;
  features_enabled: string[] | null;
  subscription_tier: string | null;
}

const FEATURES = [
  { key: 'pipeline', name: 'Pipeline', icon: FolderKanban, description: 'Lead & project pipeline management' },
  { key: 'estimates', name: 'Estimates', icon: FileText, description: 'Estimate builder & proposals' },
  { key: 'dialer', name: 'Power Dialer', icon: Phone, description: 'Click-to-call & call tracking' },
  { key: 'smart_docs', name: 'Smart Docs', icon: FileText, description: 'Document templates & e-signatures' },
  { key: 'measurements', name: 'AI Measurements', icon: Ruler, description: 'Satellite roof measurements' },
  { key: 'projects', name: 'Projects', icon: Building2, description: 'Project management & tracking' },
  { key: 'storm_canvass', name: 'Storm Canvass', icon: Target, description: 'Canvassing & territory management' },
  { key: 'territory', name: 'Territory Mapping', icon: MapPin, description: 'GPS tracking & route planning' },
  { key: 'photos', name: 'Photo Management', icon: Camera, description: 'Job photos & documentation' },
  { key: 'payments', name: 'Payments', icon: CreditCard, description: 'Payment processing & invoicing' },
];

const PRESETS = {
  full: { name: 'Full Access', features: FEATURES.map(f => f.key), color: 'bg-green-500' },
  starter: { name: 'Starter', features: ['pipeline', 'estimates', 'photos'], color: 'bg-blue-500' },
  professional: { name: 'Professional', features: ['pipeline', 'estimates', 'dialer', 'smart_docs', 'photos', 'projects'], color: 'bg-purple-500' },
  enterprise: { name: 'Enterprise', features: FEATURES.map(f => f.key), color: 'bg-amber-500' },
};

export const CompanyFeatureControl: React.FC = () => {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingCompany, setUpdatingCompany] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('id, name, is_active, features_enabled, subscription_tier')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCompanies(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading companies",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleFeature = async (companyId: string, featureKey: string, enabled: boolean) => {
    setUpdatingCompany(companyId);
    try {
      const company = companies.find(c => c.id === companyId);
      if (!company) return;

      const currentFeatures = company.features_enabled || [];
      const newFeatures = enabled
        ? [...currentFeatures, featureKey]
        : currentFeatures.filter(f => f !== featureKey);

      const { error } = await supabase
        .from('tenants')
        .update({ features_enabled: newFeatures })
        .eq('id', companyId);

      if (error) throw error;

      setCompanies(prev => prev.map(c => 
        c.id === companyId ? { ...c, features_enabled: newFeatures } : c
      ));

      toast({
        title: enabled ? "Feature enabled" : "Feature disabled",
        description: `${FEATURES.find(f => f.key === featureKey)?.name} ${enabled ? 'enabled' : 'disabled'}`
      });
    } catch (error: any) {
      toast({
        title: "Error updating feature",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setUpdatingCompany(null);
    }
  };

  const applyPreset = async (companyId: string, presetKey: keyof typeof PRESETS) => {
    setUpdatingCompany(companyId);
    try {
      const preset = PRESETS[presetKey];
      
      const { error } = await supabase
        .from('tenants')
        .update({ features_enabled: preset.features })
        .eq('id', companyId);

      if (error) throw error;

      setCompanies(prev => prev.map(c => 
        c.id === companyId ? { ...c, features_enabled: preset.features } : c
      ));

      toast({
        title: "Preset applied",
        description: `${preset.name} preset applied successfully`
      });
    } catch (error: any) {
      toast({
        title: "Error applying preset",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setUpdatingCompany(null);
    }
  };

  const filteredCompanies = companies.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getEnabledCount = (company: Company) => {
    return company.features_enabled?.length || 0;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search companies..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline" onClick={loadCompanies} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Company Feature Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : filteredCompanies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No companies found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {filteredCompanies.map(company => (
            <Card key={company.id} className="overflow-hidden">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-lg">{company.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                          {getEnabledCount(company)}/{FEATURES.length} features
                        </Badge>
                        {company.subscription_tier && (
                          <Badge variant="secondary" className="text-xs capitalize">
                            {company.subscription_tier}
                          </Badge>
                        )}
                      </CardDescription>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select onValueChange={(v) => applyPreset(company.id, v as keyof typeof PRESETS)}>
                      <SelectTrigger className="w-[160px]">
                        <Zap className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Apply Preset" />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PRESETS).map(([key, preset]) => (
                          <SelectItem key={key} value={key}>
                            <div className="flex items-center gap-2">
                              <div className={`h-2 w-2 rounded-full ${preset.color}`} />
                              {preset.name}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {FEATURES.map(feature => {
                    const Icon = feature.icon;
                    const isEnabled = company.features_enabled?.includes(feature.key) || false;
                    const isUpdating = updatingCompany === company.id;
                    
                    return (
                      <div
                        key={feature.key}
                        className={`p-3 rounded-lg border transition-colors ${
                          isEnabled 
                            ? 'bg-primary/5 border-primary/20' 
                            : 'bg-muted/30 border-border'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <Icon className={`h-4 w-4 ${isEnabled ? 'text-primary' : 'text-muted-foreground'}`} />
                          <Switch
                            checked={isEnabled}
                            onCheckedChange={(checked) => toggleFeature(company.id, feature.key, checked)}
                            disabled={isUpdating}
                          />
                        </div>
                        <div className="text-sm font-medium">{feature.name}</div>
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {feature.description}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
