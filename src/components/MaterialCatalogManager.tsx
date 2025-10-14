import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Upload, Database } from "lucide-react";

interface Material {
  id: string;
  code: string;
  name: string;
  uom: string;
  category_id: string;
  coverage_per_unit: number;
  is_taxable: boolean;
  default_markup_pct: number;
  tags: string[];
  active: boolean;
}

interface Category {
  id: string;
  code: string;
  name: string;
}

export function MaterialCatalogManager() {
  const { toast } = useToast();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [materialsRes, categoriesRes] = await Promise.all([
        supabase.from("materials").select("*").eq("active", true).order("name"),
        supabase.from("material_categories").select("*").order("name")
      ]);

      if (materialsRes.error) throw materialsRes.error;
      if (categoriesRes.error) throw categoriesRes.error;

      setMaterials(materialsRes.data || []);
      setCategories(categoriesRes.data || []);
    } catch (error: any) {
      toast({
        title: "Error loading catalog",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredMaterials = materials.filter(m => 
    searchQuery === "" ||
    m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.tags?.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const getCategoryName = (categoryId: string) => {
    return categories.find(c => c.id === categoryId)?.name || "Unknown";
  };

  if (loading) {
    return <div className="flex items-center justify-center p-8">Loading catalog...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Materials & Labor Catalog</h2>
          <p className="text-muted-foreground">Manage your materials library and pricing</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Material
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add Material</DialogTitle>
            </DialogHeader>
            <MaterialForm 
              categories={categories}
              onSuccess={() => {
                setDialogOpen(false);
                loadData();
              }}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Tabs defaultValue="materials" className="space-y-4">
        <TabsList>
          <TabsTrigger value="materials">Materials</TabsTrigger>
          <TabsTrigger value="suppliers">Supplier Catalog</TabsTrigger>
        </TabsList>

        <TabsContent value="materials" className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search materials by name, code, or tags..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          <div className="border rounded-lg">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Markup %</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMaterials.map((material) => (
                  <TableRow key={material.id}>
                    <TableCell className="font-mono text-sm">{material.code}</TableCell>
                    <TableCell className="font-medium">{material.name}</TableCell>
                    <TableCell>{getCategoryName(material.category_id)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{material.uom}</Badge>
                    </TableCell>
                    <TableCell>{(material.default_markup_pct * 100).toFixed(1)}%</TableCell>
                    <TableCell>
                      {material.coverage_per_unit ? `${material.coverage_per_unit} SF` : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {material.tags?.slice(0, 3).map((tag, i) => (
                          <Badge key={i} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
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

function MaterialForm({ categories, onSuccess }: { categories: Category[], onSuccess: () => void }) {
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    category_id: "",
    uom: "EA",
    coverage_per_unit: "",
    default_markup_pct: "0.15",
    tags: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { error } = await supabase.rpc("api_upsert_material", {
        p: {
          code: formData.code,
          name: formData.name,
          category_id: formData.category_id,
          uom: formData.uom,
          coverage_per_unit: formData.coverage_per_unit ? parseFloat(formData.coverage_per_unit) : null,
          default_markup_pct: parseFloat(formData.default_markup_pct),
          is_taxable: true,
          tags: formData.tags.split(",").map(t => t.trim()).filter(Boolean),
          active: true
        }
      });

      if (error) throw error;

      toast({ title: "Material saved successfully" });
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error saving material",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Code *</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="category">Category *</Label>
          <Select
            value={formData.category_id}
            onValueChange={(value) => setFormData({ ...formData, category_id: value })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat.id} value={cat.id}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="uom">Unit of Measure *</Label>
          <Select
            value={formData.uom}
            onValueChange={(value) => setFormData({ ...formData, uom: value })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="EA">Each (EA)</SelectItem>
              <SelectItem value="LF">Linear Foot (LF)</SelectItem>
              <SelectItem value="SF">Square Foot (SF)</SelectItem>
              <SelectItem value="SQ">Square (100 SF)</SelectItem>
              <SelectItem value="ROLL">Roll</SelectItem>
              <SelectItem value="BDL">Bundle</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="coverage">Coverage per Unit (SF)</Label>
          <Input
            id="coverage"
            type="number"
            step="0.01"
            value={formData.coverage_per_unit}
            onChange={(e) => setFormData({ ...formData, coverage_per_unit: e.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="markup">Default Markup %</Label>
          <Input
            id="markup"
            type="number"
            step="0.01"
            value={formData.default_markup_pct}
            onChange={(e) => setFormData({ ...formData, default_markup_pct: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tags">Tags (comma-separated)</Label>
        <Input
          id="tags"
          value={formData.tags}
          onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
          placeholder="e.g., asphalt, shingle, premium"
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="submit">Save Material</Button>
      </div>
    </form>
  );
}

function SupplierCatalog() {
  const { toast } = useToast();
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    initCatalog();
  }, []);

  const initCatalog = async () => {
    try {
      const { data, error } = await supabase.rpc("api_sunniland_catalog_id");
      if (error) throw error;
      setCatalogId(data);
      loadItems(data);
    } catch (error: any) {
      toast({
        title: "Error initializing supplier catalog",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const loadItems = async (catId: string) => {
    const { data, error } = await supabase
      .from("supplier_catalog_items")
      .select("*")
      .eq("catalog_id", catId)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) {
      setItems(data);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Sunniland Supply — Florida</h3>
          <p className="text-sm text-muted-foreground">{items.length} items in catalog</p>
        </div>
        <Button variant="outline">
          <Upload className="h-4 w-4 mr-2" />
          Import CSV
        </Button>
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
                <TableHead>Base Price</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-sm">{item.sku}</TableCell>
                  <TableCell>{item.brand || "—"}</TableCell>
                  <TableCell className="max-w-md truncate">{item.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.category}</Badge>
                  </TableCell>
                  <TableCell>{item.uom}</TableCell>
                  <TableCell>
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
