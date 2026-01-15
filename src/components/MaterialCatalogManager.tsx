import { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Search, Upload, Database, Pencil, Trash2, Package, DollarSign, Percent } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";

interface Material {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category_name: string | null;
  category_code: string | null;
  uom: string;
  coverage_per_unit: number | null;
  base_cost: number | null;
  default_markup_pct: number | null;
  is_taxable: boolean;
  tags: string[] | null;
  supplier_sku: string | null;
  active: boolean;
}

interface Category {
  id: string;
  code: string;
  name: string;
  description: string | null;
  order_index: number;
  section: string;
}

const SECTIONS = [
  { value: 'all', label: 'All Sections' },
  { value: 'roof', label: 'Roofing' },
  { value: 'gutter', label: 'Gutters' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' }
];

export function MaterialCatalogManager() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSection, setSelectedSection] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // React Query for materials and categories - parallel calls
  const { data: catalogData, isLoading: loading } = useQuery({
    queryKey: ['material-catalog'],
    queryFn: async () => {
      const [catResult, matResult] = await Promise.all([
        supabase.rpc('api_get_material_categories' as any),
        supabase.rpc('api_get_materials' as any)
      ]);

      if (catResult.error) throw catResult.error;
      if (matResult.error) throw matResult.error;

      return {
        categories: (catResult.data || []) as Category[],
        materials: (matResult.data || []) as Material[]
      };
    },
    staleTime: 2 * 60 * 1000, // 2 minutes cache
  });

  const materials = catalogData?.materials || [];
  const categories = catalogData?.categories || [];

  const loadData = () => {
    queryClient.invalidateQueries({ queryKey: ['material-catalog'] });
  };

  // Reset category filter when section changes
  useEffect(() => {
    setSelectedCategory('all');
  }, [selectedSection]);

  // Filter categories by selected section
  const filteredCategories = categories.filter(c => 
    selectedSection === 'all' || (c as any).section === selectedSection
  );

  const filteredMaterials = materials.filter(m => {
    const matchesSearch = !searchQuery || 
      m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (m.description?.toLowerCase().includes(searchQuery.toLowerCase()));
    
    // Find the category's section
    const cat = categories.find(c => c.id === m.category_id);
    const catSection = (cat as any)?.section || 'roof';
    
    const matchesSection = selectedSection === 'all' || catSection === selectedSection;
    const matchesCategory = selectedCategory === "all" || m.category_id === selectedCategory;
    
    return matchesSearch && matchesSection && matchesCategory;
  });

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this material?')) return;
    
    const { error } = await supabase
      .from('materials' as any)
      .update({ active: false })
      .eq('id', id);
    
    if (error) {
      toast.error('Failed to delete material');
    } else {
      toast.success('Material deleted');
      loadData();
    }
  };

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          const importData = results.data
            .filter((row: any) => row.code || row.sku || row.item_code)
            .map((row: any) => ({
              code: row.code || row.sku || row.item_code || row.Code || row.SKU,
              name: row.name || row.description || row.item_name || row.Name || row.Description,
              description: row.long_description || row.full_description || row.desc,
              category: row.category || row.category_name || row.Category,
              uom: row.uom || row.unit || row.UOM || 'EA',
              base_cost: parseFloat(row.cost || row.price || row.base_cost || row.Cost || row.Price) || null,
              markup_pct: parseFloat(row.markup || row.markup_pct || row.Markup) || 0.35,
              coverage: parseFloat(row.coverage || row.coverage_per_unit || row.Coverage) || null,
              sku: row.supplier_sku || row.vendor_sku || row.sku || row.SKU
            }));

          if (importData.length === 0) {
            toast.error('No valid rows found in CSV');
            return;
          }

          const { data, error } = await supabase
            .rpc('api_bulk_import_materials' as any, { p_materials: importData });

          if (error) throw error;
          
          toast.success(`Imported ${data} materials`);
          setImportDialogOpen(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
          loadData();
        } catch (error: any) {
          console.error('Import error:', error);
          toast.error('Failed to import materials: ' + error.message);
        }
      },
      error: (error) => {
        toast.error('Failed to parse CSV: ' + error.message);
      }
    });
  };

  const materialsWithPricing = materials.filter(m => m.base_cost && m.base_cost > 0);
  const avgMarkup = materials.length > 0 
    ? Math.round((materials.reduce((sum, m) => sum + (m.default_markup_pct || 0.35), 0) / materials.length) * 100)
    : 35;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-5" />
                  <div className="space-y-1">
                    <Skeleton className="h-7 w-12" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        <Skeleton className="h-10 w-64" />
        <div className="border rounded-lg p-4 space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-6 w-16" />
              </div>
              <div className="flex items-center gap-4">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Material Catalog</h2>
          <p className="text-muted-foreground">Global materials library for estimates</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import Materials from CSV</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Upload a CSV file with columns: code, name, category, uom, cost, markup_pct, coverage
                </p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCSVImport}
                />
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={dialogOpen} onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setEditingMaterial(null);
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Add Material
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>{editingMaterial ? 'Edit Material' : 'Add Material'}</DialogTitle>
              </DialogHeader>
              <MaterialForm 
                categories={categories}
                material={editingMaterial}
                onSuccess={() => {
                  setDialogOpen(false);
                  setEditingMaterial(null);
                  loadData();
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <p className="text-2xl font-bold">{materials.length}</p>
                <p className="text-xs text-muted-foreground">Total Materials</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{materialsWithPricing.length}</p>
                <p className="text-xs text-muted-foreground">With Pricing</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Percent className="h-5 w-5 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{avgMarkup}%</p>
                <p className="text-xs text-muted-foreground">Avg Markup</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Package className="h-5 w-5 text-orange-500" />
              <div>
                <p className="text-2xl font-bold">{categories.length}</p>
                <p className="text-xs text-muted-foreground">Categories</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="materials" className="space-y-4">
        <TabsList>
          <TabsTrigger value="materials">Materials ({materials.length})</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier Catalog</TabsTrigger>
        </TabsList>

        <TabsContent value="materials" className="space-y-4">
          {/* Filters */}
          <div className="flex gap-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search materials..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={selectedSection} onValueChange={setSelectedSection}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                {SECTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedCategory} onValueChange={setSelectedCategory}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {filteredCategories.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Markup</TableHead>
                  <TableHead className="text-right">Sell Price</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMaterials.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <div className="text-muted-foreground">
                        <Package className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p>No materials found</p>
                        <p className="text-sm">Add materials or import from CSV</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMaterials.map((material) => {
                    const markup = material.default_markup_pct || 0.35;
                    const cost = material.base_cost || 0;
                    const sellPrice = cost > 0 ? cost / (1 - markup) : 0;
                    
                    return (
                      <TableRow key={material.id}>
                        <TableCell className="font-mono text-sm">{material.code}</TableCell>
                        <TableCell>
                          <div>
                            <p className="font-medium">{material.name}</p>
                            {material.description && (
                              <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                                {material.description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {material.category_name && (
                            <Badge variant="secondary">{material.category_name}</Badge>
                          )}
                        </TableCell>
                        <TableCell>{material.uom}</TableCell>
                        <TableCell className="text-right">
                          {cost > 0 ? `$${cost.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell className="text-right">
                          {Math.round(markup * 100)}%
                        </TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {sellPrice > 0 ? `$${sellPrice.toFixed(2)}` : '—'}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {material.tags?.slice(0, 2).map((tag, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => {
                                setEditingMaterial(material);
                                setDialogOpen(true);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button 
                              size="icon" 
                              variant="ghost"
                              onClick={() => handleDelete(material.id)}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="space-y-4">
          <SupplierCatalog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MaterialForm({ 
  categories, 
  material,
  onSuccess 
}: { 
  categories: Category[]; 
  material?: Material | null;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    code: material?.code || '',
    name: material?.name || '',
    description: material?.description || '',
    category_id: material?.category_id || '',
    uom: material?.uom || 'EA',
    base_cost: material?.base_cost?.toString() || '',
    default_markup_pct: ((material?.default_markup_pct || 0.35) * 100).toString(),
    coverage_per_unit: material?.coverage_per_unit?.toString() || '',
    supplier_sku: material?.supplier_sku || '',
    tags: material?.tags?.join(', ') || ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const { error } = await supabase.rpc('api_upsert_material' as any, {
        p_code: formData.code,
        p_name: formData.name,
        p_category_id: formData.category_id || null,
        p_uom: formData.uom,
        p_base_cost: formData.base_cost ? parseFloat(formData.base_cost) : null,
        p_default_markup_pct: parseFloat(formData.default_markup_pct) / 100,
        p_coverage_per_unit: formData.coverage_per_unit ? parseFloat(formData.coverage_per_unit) : null,
        p_description: formData.description || null,
        p_supplier_sku: formData.supplier_sku || null,
        p_tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : null,
        p_attributes: {}
      });

      if (error) throw error;
      
      toast.success(material ? 'Material updated' : 'Material added');
      onSuccess();
    } catch (error: any) {
      console.error('Error saving material:', error);
      toast.error('Failed to save material: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const baseCost = parseFloat(formData.base_cost) || 0;
  const markupPct = parseFloat(formData.default_markup_pct) / 100 || 0.35;
  const sellPrice = baseCost > 0 ? baseCost / (1 - markupPct) : 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Code *</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            placeholder="SHNG-GAF-HDL"
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="GAF Timberline HDZ Shingle"
            required
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Premium architectural shingle"
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">Category</Label>
          <Select 
            value={formData.category_id} 
            onValueChange={(v) => setFormData({ ...formData, category_id: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="uom">Unit of Measure</Label>
          <Select 
            value={formData.uom} 
            onValueChange={(v) => setFormData({ ...formData, uom: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EA">Each</SelectItem>
              <SelectItem value="BDL">Bundle</SelectItem>
              <SelectItem value="SQ">Square</SelectItem>
              <SelectItem value="LF">Linear Foot</SelectItem>
              <SelectItem value="SF">Square Foot</SelectItem>
              <SelectItem value="RL">Roll</SelectItem>
              <SelectItem value="BX">Box</SelectItem>
              <SelectItem value="GL">Gallon</SelectItem>
              <SelectItem value="TB">Tube</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="coverage">Coverage per Unit</Label>
          <Input
            id="coverage"
            type="number"
            step="0.01"
            value={formData.coverage_per_unit}
            onChange={(e) => setFormData({ ...formData, coverage_per_unit: e.target.value })}
            placeholder="33.33"
          />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label htmlFor="base_cost">Base Cost ($)</Label>
          <Input
            id="base_cost"
            type="number"
            step="0.01"
            value={formData.base_cost}
            onChange={(e) => setFormData({ ...formData, base_cost: e.target.value })}
            placeholder="45.99"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="markup">Markup (%)</Label>
          <Input
            id="markup"
            type="number"
            step="1"
            value={formData.default_markup_pct}
            onChange={(e) => setFormData({ ...formData, default_markup_pct: e.target.value })}
            placeholder="35"
          />
        </div>
        <div className="space-y-2">
          <Label>Sell Price</Label>
          <div className="h-10 px-3 py-2 bg-muted rounded-md flex items-center font-medium text-green-600">
            {sellPrice > 0 ? `$${sellPrice.toFixed(2)}` : '—'}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="supplier_sku">Supplier SKU</Label>
          <Input
            id="supplier_sku"
            value={formData.supplier_sku}
            onChange={(e) => setFormData({ ...formData, supplier_sku: e.target.value })}
            placeholder="0133180"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tags">Tags (comma separated)</Label>
          <Input
            id="tags"
            value={formData.tags}
            onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
            placeholder="premium, architectural, gaf"
          />
        </div>
      </div>

      <DialogFooter>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : (material ? 'Update Material' : 'Add Material')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function SupplierCatalog() {
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initCatalog();
  }, []);

  const initCatalog = async () => {
    try {
      const { data, error } = await supabase.rpc("api_sunniland_catalog_id" as any);
      if (error) throw error;
      setCatalogId(data as string);
      loadItems(data as string);
    } catch (error: any) {
      toast.error('Error initializing supplier catalog: ' + error.message);
      setLoading(false);
    }
  };

  const loadItems = async (catId: string) => {
    const { data, error } = await supabase
      .from("supplier_catalog_items" as any)
      .select("*")
      .eq("catalog_id", catId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!error && data) {
      setItems(data);
    }
    setLoading(false);
  };

  const handleCSVImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !catalogId) return;

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        try {
          const importItems = results.data
            .filter((row: any) => row.sku || row.SKU || row.item_code)
            .map((row: any) => ({
              catalog_id: catalogId,
              sku: row.sku || row.SKU || row.item_code,
              brand: row.brand || row.Brand,
              model: row.model || row.Model,
              description: row.description || row.Description || row.item_name,
              category: row.category || row.Category,
              uom: row.uom || row.UOM || 'EA',
              package_size: row.package_size || row.pkg_size,
              base_price: parseFloat(row.price || row.Price || row.cost) || null,
              active: true
            }));

          if (importItems.length === 0) {
            toast.error('No valid items found in CSV');
            return;
          }

          const { error } = await supabase
            .from('supplier_catalog_items' as any)
            .insert(importItems);

          if (error) throw error;

          toast.success(`Imported ${importItems.length} supplier items`);
          if (fileInputRef.current) fileInputRef.current.value = '';
          loadItems(catalogId);
        } catch (error: any) {
          toast.error('Failed to import: ' + error.message);
        }
      },
      error: (error) => {
        toast.error('Failed to parse CSV: ' + error.message);
      }
    });
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading supplier catalog...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Sunniland Supply — Florida</h3>
          <p className="text-sm text-muted-foreground">{items.length} items in catalog</p>
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            className="hidden"
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4 mr-2" />
            Import CSV
          </Button>
        </div>
      </div>

      {items.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Brand</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead className="text-right">Base Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                  <TableCell>{item.brand || "—"}</TableCell>
                  <TableCell className="max-w-md truncate">{item.description}</TableCell>
                  <TableCell>
                    {item.category && <Badge variant="outline">{item.category}</Badge>}
                  </TableCell>
                  <TableCell>{item.uom}</TableCell>
                  <TableCell className="text-right">
                    {item.base_price ? `$${item.base_price.toFixed(2)}` : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="border rounded-lg p-8 text-center">
          <Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="font-semibold mb-2">No items in catalog</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Upload a Sunniland price list CSV to populate the catalog
          </p>
        </div>
      )}
    </div>
  );
}

export default MaterialCatalogManager;
