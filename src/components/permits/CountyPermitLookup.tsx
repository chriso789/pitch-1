import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { 
  Search, 
  MapPin, 
  FileText, 
  Phone, 
  Globe, 
  AlertTriangle, 
  Clock, 
  DollarSign,
  ExternalLink,
  CheckCircle2,
  Download,
  RefreshCw,
  Building2
} from 'lucide-react';
import { useCountyPermits, type FloridaCounty, type CountyPermitData } from '@/hooks/useCountyPermits';
import { toast } from 'sonner';

const COAST_LABELS: Record<string, { label: string; color: string }> = {
  east: { label: 'East Coast (Atlantic)', color: 'bg-blue-100 text-blue-800' },
  west: { label: 'West Coast (Gulf)', color: 'bg-emerald-100 text-emerald-800' },
  panhandle: { label: 'Panhandle', color: 'bg-amber-100 text-amber-800' },
  keys: { label: 'Florida Keys', color: 'bg-purple-100 text-purple-800' },
  nature_coast: { label: 'Nature Coast', color: 'bg-teal-100 text-teal-800' },
};

export function CountyPermitLookup() {
  const { 
    counties, 
    loading, 
    getCountyPermitData, 
    scrapeCountyPermits,
    scrapeAllCounties 
  } = useCountyPermits();
  
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCoast, setSelectedCoast] = useState<string>('all');
  const [selectedCounty, setSelectedCounty] = useState<FloridaCounty | null>(null);
  const [permitData, setPermitData] = useState<CountyPermitData | null>(null);
  const [loadingPermits, setLoadingPermits] = useState(false);
  const [scraping, setScraping] = useState(false);

  // Filter counties based on search and coast filter
  const filteredCounties = counties.filter(county => {
    const matchesSearch = county.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (county.region?.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCoast = selectedCoast === 'all' || county.coast === selectedCoast;
    return matchesSearch && matchesCoast;
  });

  // Load permit data when county is selected
  useEffect(() => {
    if (selectedCounty) {
      loadPermitData(selectedCounty.name);
    }
  }, [selectedCounty]);

  const loadPermitData = async (countyName: string) => {
    setLoadingPermits(true);
    try {
      const data = await getCountyPermitData(countyName);
      setPermitData(data);
    } catch (err) {
      toast.error('Failed to load permit data');
    } finally {
      setLoadingPermits(false);
    }
  };

  const handleScrapeCounty = async () => {
    if (!selectedCounty) return;
    setScraping(true);
    try {
      await scrapeCountyPermits(selectedCounty.name);
      toast.success(`Successfully updated ${selectedCounty.name} County permit data`);
      await loadPermitData(selectedCounty.name);
    } catch (err) {
      toast.error('Failed to scrape permit data');
    } finally {
      setScraping(false);
    }
  };

  const handleScrapeAll = async () => {
    setScraping(true);
    try {
      const result = await scrapeAllCounties();
      toast.success(`Scraped ${result.summary?.success || 0} counties successfully`);
    } catch (err) {
      toast.error('Failed to scrape all counties');
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Florida County Permit Requirements</h2>
          <p className="text-muted-foreground">
            Search and view roofing permit requirements for all 35 Florida coastal counties
          </p>
        </div>
        <Button 
          variant="outline" 
          onClick={handleScrapeAll}
          disabled={scraping}
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${scraping ? 'animate-spin' : ''}`} />
          Refresh All Data
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* County List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Counties</CardTitle>
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search counties..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Tabs value={selectedCoast} onValueChange={setSelectedCoast}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="all" className="text-xs">All</TabsTrigger>
                  <TabsTrigger value="east" className="text-xs">East</TabsTrigger>
                  <TabsTrigger value="west" className="text-xs">West</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[500px]">
              <div className="space-y-1 p-3">
                {loading ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Loading counties...
                  </div>
                ) : filteredCounties.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    No counties found
                  </div>
                ) : (
                  filteredCounties.map((county) => (
                    <button
                      key={county.id}
                      onClick={() => setSelectedCounty(county)}
                      className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                        selectedCounty?.id === county.id
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-muted'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{county.name}</div>
                          <div className="text-xs opacity-70">{county.region}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          {county.is_hvhz && (
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                          )}
                          <Badge 
                            variant="secondary" 
                            className={`text-xs ${COAST_LABELS[county.coast]?.color || ''}`}
                          >
                            {county.coast}
                          </Badge>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Permit Details */}
        <Card className="lg:col-span-2">
          {!selectedCounty ? (
            <div className="flex flex-col items-center justify-center h-[600px] text-muted-foreground">
              <Building2 className="h-12 w-12 mb-4 opacity-50" />
              <p>Select a county to view permit requirements</p>
            </div>
          ) : loadingPermits ? (
            <div className="flex items-center justify-center h-[600px]">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5" />
                      {selectedCounty.name} County
                      {selectedCounty.is_hvhz && (
                        <Badge variant="destructive" className="ml-2">
                          <AlertTriangle className="h-3 w-3 mr-1" />
                          HVHZ
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-1">
                      {selectedCounty.region} • {COAST_LABELS[selectedCounty.coast]?.label}
                      {selectedCounty.wind_zone && ` • Wind Zone: ${selectedCounty.wind_zone}`}
                    </CardDescription>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleScrapeCounty}
                    disabled={scraping}
                  >
                    <RefreshCw className={`h-4 w-4 mr-2 ${scraping ? 'animate-spin' : ''}`} />
                    Update Data
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {!permitData?.requirements ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No permit data available for this county yet.</p>
                    <Button 
                      variant="link" 
                      onClick={handleScrapeCounty}
                      className="mt-2"
                    >
                      Scrape permit data now
                    </Button>
                  </div>
                ) : (
                  <Tabs defaultValue="requirements" className="space-y-4">
                    <TabsList>
                      <TabsTrigger value="requirements">Requirements</TabsTrigger>
                      <TabsTrigger value="documents">Documents</TabsTrigger>
                      <TabsTrigger value="contact">Contact</TabsTrigger>
                    </TabsList>

                    <TabsContent value="requirements" className="space-y-4">
                      {/* Quick Stats */}
                      <div className="grid grid-cols-3 gap-4">
                        <Card className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <DollarSign className="h-4 w-4" />
                            <span className="text-sm">Base Fee</span>
                          </div>
                          <div className="text-2xl font-bold">
                            {permitData.requirements.base_fee 
                              ? `$${permitData.requirements.base_fee.toFixed(2)}`
                              : 'Varies'
                            }
                          </div>
                        </Card>
                        <Card className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <Clock className="h-4 w-4" />
                            <span className="text-sm">Processing</span>
                          </div>
                          <div className="text-2xl font-bold">
                            {permitData.requirements.typical_processing_days 
                              ? `${permitData.requirements.typical_processing_days} days`
                              : 'Varies'
                            }
                          </div>
                        </Card>
                        <Card className="p-4">
                          <div className="flex items-center gap-2 text-muted-foreground mb-1">
                            <Globe className="h-4 w-4" />
                            <span className="text-sm">Submission</span>
                          </div>
                          <div className="text-2xl font-bold">
                            {permitData.requirements.online_submission ? 'Online' : 'In-Person'}
                          </div>
                        </Card>
                      </div>

                      {/* Special Requirements */}
                      {permitData.requirements.special_requirements && 
                       permitData.requirements.special_requirements.length > 0 && (
                        <Card className="p-4 border-amber-200 bg-amber-50/50">
                          <h4 className="font-medium flex items-center gap-2 mb-2">
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                            Special Requirements
                          </h4>
                          <ul className="space-y-1 text-sm">
                            {permitData.requirements.special_requirements.map((req, idx) => (
                              <li key={idx} className="flex items-start gap-2">
                                <span className="text-amber-500">•</span>
                                {req}
                              </li>
                            ))}
                          </ul>
                        </Card>
                      )}

                      {/* Portal Link */}
                      {permitData.requirements.permit_portal_url && (
                        <Button asChild className="w-full">
                          <a 
                            href={permitData.requirements.permit_portal_url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            Open Permit Portal
                          </a>
                        </Button>
                      )}
                    </TabsContent>

                    <TabsContent value="documents" className="space-y-4">
                      <h4 className="font-medium">Required Documents</h4>
                      <div className="space-y-2">
                        {permitData.requirements.required_documents.map((doc, idx) => (
                          <div 
                            key={idx} 
                            className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                          >
                            <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                            <span className="text-sm">{doc}</span>
                          </div>
                        ))}
                      </div>

                      {/* Downloadable Forms */}
                      {permitData.forms.length > 0 && (
                        <>
                          <Separator className="my-4" />
                          <h4 className="font-medium">Downloadable Forms</h4>
                          <div className="space-y-2">
                            {permitData.forms.map((form) => (
                              <div 
                                key={form.id}
                                className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                              >
                                <div className="flex items-center gap-3">
                                  <FileText className="h-5 w-5 text-muted-foreground" />
                                  <div>
                                    <div className="text-sm font-medium">{form.form_name}</div>
                                    {form.form_type && (
                                      <Badge variant="outline" className="text-xs mt-1">
                                        {form.form_type}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                {form.form_url && (
                                  <Button variant="ghost" size="sm" asChild>
                                    <a 
                                      href={form.form_url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                    >
                                      <Download className="h-4 w-4" />
                                    </a>
                                  </Button>
                                )}
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </TabsContent>

                    <TabsContent value="contact" className="space-y-4">
                      <div className="space-y-4">
                        {permitData.requirements.department_name && (
                          <div>
                            <label className="text-sm text-muted-foreground">Department</label>
                            <p className="font-medium">{permitData.requirements.department_name}</p>
                          </div>
                        )}
                        {permitData.requirements.department_phone && (
                          <div>
                            <label className="text-sm text-muted-foreground">Phone</label>
                            <p className="font-medium flex items-center gap-2">
                              <Phone className="h-4 w-4" />
                              <a 
                                href={`tel:${permitData.requirements.department_phone}`}
                                className="text-primary hover:underline"
                              >
                                {permitData.requirements.department_phone}
                              </a>
                            </p>
                          </div>
                        )}
                        {permitData.requirements.department_email && (
                          <div>
                            <label className="text-sm text-muted-foreground">Email</label>
                            <p className="font-medium">
                              <a 
                                href={`mailto:${permitData.requirements.department_email}`}
                                className="text-primary hover:underline"
                              >
                                {permitData.requirements.department_email}
                              </a>
                            </p>
                          </div>
                        )}
                        {permitData.requirements.department_address && (
                          <div>
                            <label className="text-sm text-muted-foreground">Address</label>
                            <p className="font-medium">{permitData.requirements.department_address}</p>
                          </div>
                        )}
                      </div>

                      {permitData.requirements.last_scraped_at && (
                        <div className="text-xs text-muted-foreground mt-4 pt-4 border-t">
                          Last updated: {new Date(permitData.requirements.last_scraped_at).toLocaleDateString()}
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

export default CountyPermitLookup;
