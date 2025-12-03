import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Search, Package } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface Material {
  id: string;
  code: string;
  name: string;
  uom: string;
  base_cost: number;
  default_markup_pct: number;
  coverage_per_unit: number;
  category_id: string;
  category_name?: string;
  attributes: Record<string, any>;
}

interface MaterialBrowserProps {
  onSelect: (material: Material) => void;
}

export const MaterialBrowser = ({ onSelect }: MaterialBrowserProps) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [materialsRes, categoriesRes] = await Promise.all([
      supabase
        .from('materials')
        .select('*, material_categories(name)')
        .eq('active', true)
        .order('name'),
      supabase
        .from('material_categories')
        .select('id, name')
        .order('name')
    ]);

    if (materialsRes.data) {
      setMaterials(materialsRes.data.map((m: any) => ({
        ...m,
        category_name: m.material_categories?.name
      })));
    }
    if (categoriesRes.data) {
      setCategories(categoriesRes.data);
    }
    setLoading(false);
  };

  const filtered = materials.filter(m => {
    const matchesSearch = !search || 
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || m.category_id === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search materials..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea className="h-[300px] border rounded-md">
        {loading ? (
          <div className="p-4 text-center text-muted-foreground">Loading materials...</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-center text-muted-foreground">No materials found</div>
        ) : (
          <div className="divide-y">
            {filtered.map((material) => (
              <div
                key={material.id}
                onClick={() => onSelect(material)}
                className="p-3 hover:bg-muted/50 cursor-pointer transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="font-medium truncate">{material.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-sm text-muted-foreground">
                      <span className="font-mono">{material.code}</span>
                      {material.category_name && (
                        <Badge variant="outline" className="text-xs">{material.category_name}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-semibold">${material.base_cost.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">per {material.uom}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
      
      <p className="text-xs text-muted-foreground text-center">
        {filtered.length} material{filtered.length !== 1 ? 's' : ''} • Click to select
      </p>
    </div>
  );
};
