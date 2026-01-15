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
  category_section?: string;
  attributes: Record<string, any>;
}

interface Category {
  id: string;
  code: string;
  name: string;
  description: string | null;
  order_index: number;
  section: string;
}

interface MaterialBrowserProps {
  onSelect: (material: Material) => void;
}

const SECTIONS = [
  { value: 'all', label: 'All Sections' },
  { value: 'roof', label: 'Roofing' },
  { value: 'gutter', label: 'Gutters' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
  { value: 'labor', label: 'Labor' }
];

export const MaterialBrowser = ({ onSelect }: MaterialBrowserProps) => {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [sectionFilter, setSectionFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  // Reset category filter when section changes
  useEffect(() => {
    setCategoryFilter('all');
  }, [sectionFilter]);

  const fetchData = async () => {
    setLoading(true);
    
    // Use RPC functions to bypass RLS (same as MaterialCatalogManager)
    const [materialsRes, categoriesRes] = await Promise.all([
      supabase.rpc('api_get_materials' as any),
      supabase.rpc('api_get_material_categories' as any)
    ]);

    if (materialsRes.data) {
      const cats = (categoriesRes.data || []) as Category[];
      const catMap = new Map(cats.map(c => [c.id, c]));
      
      setMaterials((materialsRes.data as any[]).filter(m => m.active !== false).map((m: any) => ({
        ...m,
        category_name: catMap.get(m.category_id)?.name,
        category_section: catMap.get(m.category_id)?.section || 'roof'
      })));
    }
    
    if (categoriesRes.data) {
      setCategories(categoriesRes.data as Category[]);
    }
    
    setLoading(false);
  };

  // Filter categories by selected section
  const filteredCategories = categories.filter(c => 
    sectionFilter === 'all' || c.section === sectionFilter
  );

  const filtered = materials.filter(m => {
    const matchesSearch = !search || 
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.code.toLowerCase().includes(search.toLowerCase());
    const matchesSection = sectionFilter === 'all' || m.category_section === sectionFilter;
    const matchesCategory = categoryFilter === 'all' || m.category_id === categoryFilter;
    return matchesSearch && matchesSection && matchesCategory;
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
      </div>
      
      <div className="flex gap-2">
        <Select value={sectionFilter} onValueChange={setSectionFilter}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Section" />
          </SelectTrigger>
          <SelectContent>
            {SECTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {filteredCategories.map((cat) => (
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
                    <div className="font-semibold">${(material.base_cost || 0).toFixed(2)}</div>
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
