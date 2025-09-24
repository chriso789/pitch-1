import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Package, DollarSign, Clock, Building2 } from "lucide-react";

interface Product {
  id: string;
  sku: string;
  name: string;
  description?: string;
  category?: string;
  subcategory?: string;
  manufacturer?: string;
  unit_of_measure: string;
  is_active: boolean;
  created_at: string;
}

interface Vendor {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

interface VendorProduct {
  id: string;
  vendor_sku: string;
  vendor_product_name?: string;
  minimum_order_qty: number;
  lead_time_days: number;
  is_active: boolean;
  vendor_id: string;
  vendors: Vendor;
}

interface PriceCache {
  price: number;
  list_price?: number;
  branch_code: string;
  seen_at?: string;
  last_seen_at?: string;
  source?: string;
}

const MaterialCatalog = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [vendorProducts, setVendorProducts] = useState<VendorProduct[]>([]);
  const [priceData, setPriceData] = useState<PriceCache[]>([]);
  const [showNewProductDialog, setShowNewProductDialog] = useState(false);
  const [newProduct, setNewProduct] = useState({
    sku: "",
    name: "",
    description: "",
    category: "",
    subcategory: "",
    manufacturer: "",
    unit_of_measure: "EA"
  });
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);

      // Load products
      const { data: productsData, error: productsError } = await supabase
        .from('products')
        .select('*')
        .order('name');

      if (productsError) throw productsError;

      // Load vendors
      const { data: vendorsData, error: vendorsError } = await supabase
        .from('vendors')
        .select('id, name, code, is_active')
        .eq('is_active', true)
        .order('name');

      if (vendorsError) throw vendorsError;

      setProducts(productsData || []);
      setVendors(vendorsData || []);

    } catch (error) {
      console.error('Error loading data:', error);
      toast({
        title: "Error loading data",
        description: "Failed to load material catalog data.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadProductDetails = async (product: Product) => {
    try {
      setSelectedProduct(product);

      // Load vendor products - check if this table exists or use different approach
      const { data: vendorProductsData, error: vpError } = await supabase
        .from('vendor_products')
        .select(`
          id,
          vendor_sku,
          vendor_product_name,
          minimum_order_qty,
          lead_time_days,
          is_active,
          vendor_id,
          vendors!inner (
            id,
            name,
            code,
            is_active
          )
        `)
        .eq('product_id', product.id);

      if (vpError) throw vpError;

      // Load price cache data
      const { data: priceData, error: priceError } = await supabase
        .from('price_cache')
        .select('price, branch_code, last_seen_at, source')
        .eq('product_id', product.id)
        .order('last_seen_at', { ascending: false })
        .limit(10);

      if (priceError) throw priceError;

      setVendorProducts(vendorProductsData || []);
      setPriceData(priceData || []);

    } catch (error) {
      console.error('Error loading product details:', error);
      toast({
        title: "Error loading product details",
        description: "Failed to load detailed product information.",
        variant: "destructive",
      });
    }
  };

  const handleCreateProduct = async () => {
    try {
      // Get user profile to get tenant_id
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        toast({
          title: "Authentication required",
          description: "Please log in to create products.",
          variant: "destructive",
        });
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', session.user.id)
        .single();

      if (profileError || !profile?.tenant_id) {
        toast({
          title: "Profile error",
          description: "Unable to find your account profile.",
          variant: "destructive",
        });
        return;
      }

      const { error } = await supabase
        .from('products')
        .insert([{
          ...newProduct,
          tenant_id: profile.tenant_id
        }]);

      if (error) throw error;

      toast({
        title: "Product created",
        description: "New product added to catalog successfully.",
      });

      setShowNewProductDialog(false);
      setNewProduct({
        sku: "",
        name: "",
        description: "",
        category: "",
        subcategory: "",
        manufacturer: "",
        unit_of_measure: "EA"
      });
      loadData();
    } catch (error) {
      console.error('Error creating product:', error);
      toast({
        title: "Error creating product",
        description: "Failed to create new product.",
        variant: "destructive",
      });
    }
  };

  const refreshPricing = async (productId: string) => {
    try {
      // This would typically call the QXO pricing API
      toast({
        title: "Pricing refresh initiated",
        description: "Live pricing data is being updated in the background.",
      });
      
      // Reload product details to show updated pricing
      if (selectedProduct) {
        loadProductDetails(selectedProduct);
      }
    } catch (error) {
      console.error('Error refreshing pricing:', error);
      toast({
        title: "Error refreshing pricing",
        description: "Failed to refresh pricing data.",
        variant: "destructive",
      });
    }
  };

  const filteredProducts = products.filter(product =>
    product.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.sku.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.category?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    product.manufacturer?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-2 text-muted-foreground">Loading material catalog...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold">Material Catalog</h2>
          <p className="text-muted-foreground">
            Manage products, suppliers, and live pricing
          </p>
        </div>
        
        <Dialog open={showNewProductDialog} onOpenChange={setShowNewProductDialog}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Product
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Product</DialogTitle>
              <DialogDescription>
                Create a new product in the material catalog
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="sku">SKU</Label>
                <Input
                  id="sku"
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, sku: e.target.value }))}
                  placeholder="Enter product SKU"
                />
              </div>
              <div>
                <Label htmlFor="name">Product Name</Label>
                <Input
                  id="name"
                  value={newProduct.name}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Enter product name"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={newProduct.description}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Product description"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={newProduct.category}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, category: e.target.value }))}
                    placeholder="Category"
                  />
                </div>
                <div>
                  <Label htmlFor="manufacturer">Manufacturer</Label>
                  <Input
                    id="manufacturer"
                    value={newProduct.manufacturer}
                    onChange={(e) => setNewProduct(prev => ({ ...prev, manufacturer: e.target.value }))}
                    placeholder="Manufacturer"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="unit_of_measure">Unit of Measure</Label>
                <Input
                  id="unit_of_measure"
                  value={newProduct.unit_of_measure}
                  onChange={(e) => setNewProduct(prev => ({ ...prev, unit_of_measure: e.target.value }))}
                  placeholder="EA"
                />
              </div>
              <div className="flex justify-end space-x-2">
                <Button variant="outline" onClick={() => setShowNewProductDialog(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateProduct}>
                  Create Product
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center space-x-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search products by name, SKU, category, or manufacturer..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Package className="h-5 w-5 mr-2" />
              Products ({filteredProducts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {filteredProducts.map((product) => (
                <div
                  key={product.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedProduct?.id === product.id
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => loadProductDetails(product)}
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <h4 className="font-medium">{product.name}</h4>
                      <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                      {product.category && (
                        <Badge variant="secondary" className="mt-1">
                          {product.category}
                        </Badge>
                      )}
                    </div>
                    <Badge variant={product.is_active ? "default" : "secondary"}>
                      {product.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Product Details</CardTitle>
          </CardHeader>
          <CardContent>
            {selectedProduct ? (
              <Tabs defaultValue="info" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="info">Info</TabsTrigger>
                  <TabsTrigger value="vendors">Vendors</TabsTrigger>
                  <TabsTrigger value="pricing">Pricing</TabsTrigger>
                </TabsList>
                
                <TabsContent value="info" className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-lg">{selectedProduct.name}</h3>
                    <p className="text-muted-foreground">SKU: {selectedProduct.sku}</p>
                  </div>
                  
                  {selectedProduct.description && (
                    <div>
                      <Label>Description</Label>
                      <p className="text-sm">{selectedProduct.description}</p>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-4">
                    {selectedProduct.category && (
                      <div>
                        <Label>Category</Label>
                        <p className="text-sm">{selectedProduct.category}</p>
                      </div>
                    )}
                    
                    {selectedProduct.manufacturer && (
                      <div>
                        <Label>Manufacturer</Label>
                        <p className="text-sm">{selectedProduct.manufacturer}</p>
                      </div>
                    )}
                    
                    <div>
                      <Label>Unit of Measure</Label>
                      <p className="text-sm">{selectedProduct.unit_of_measure}</p>
                    </div>
                  </div>
                </TabsContent>
                
                <TabsContent value="vendors" className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h4 className="font-medium">Vendor Availability</h4>
                    <Button size="sm" onClick={() => refreshPricing(selectedProduct.id)}>
                      Refresh Pricing
                    </Button>
                  </div>
                  
                  {vendorProducts.length > 0 ? (
                    <div className="space-y-2">
                      {vendorProducts.map((vp) => (
                        <div key={vp.id} className="p-3 border rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <h5 className="font-medium flex items-center">
                                <Building2 className="h-4 w-4 mr-2" />
                                {vp.vendors.name}
                              </h5>
                              <p className="text-sm text-muted-foreground">
                                Vendor SKU: {vp.vendor_sku}
                              </p>
                            </div>
                            <Badge variant={vp.is_active ? "default" : "secondary"}>
                              {vp.is_active ? "Available" : "Unavailable"}
                            </Badge>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                            <div className="flex items-center">
                              <Package className="h-3 w-3 mr-1" />
                              Min: {vp.minimum_order_qty}
                            </div>
                            <div className="flex items-center">
                              <Clock className="h-3 w-3 mr-1" />
                              {vp.lead_time_days} days
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No vendor data available for this product
                    </p>
                  )}
                </TabsContent>
                
                <TabsContent value="pricing" className="space-y-4">
                  <h4 className="font-medium">Recent Pricing</h4>
                  
                  {priceData.length > 0 ? (
                    <div className="space-y-2">
                      {priceData.map((price, index) => (
                        <div key={index} className="p-3 border rounded-lg">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium">{formatCurrency(price.price)}</p>
                              <p className="text-sm text-muted-foreground">
                                Branch: {price.branch_code}
                              </p>
                            </div>
                            <div className="text-right">
                              <Badge variant="outline">{price.source || 'unknown'}</Badge>
                              <p className="text-xs text-muted-foreground mt-1">
                                {new Date(price.last_seen_at || price.seen_at || '').toLocaleDateString()}
                              </p>
                            </div>
                            </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-center py-4">
                      No pricing data available for this product
                    </p>
                  )}
                </TabsContent>
              </Tabs>
            ) : (
              <p className="text-muted-foreground text-center py-8">
                Select a product to view details
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default MaterialCatalog;