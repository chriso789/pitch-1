import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { 
  Calculator, 
  FileText, 
  DollarSign, 
  TrendingUp, 
  AlertTriangle,
  CheckCircle,
  Home,
  Wrench,
  Ruler,
  Droplets,
  Square,
  LayoutGrid,
  Package,
  Plus,
  Trash2,
  Edit2,
  X,
  Check
} from "lucide-react";
import { useState } from "react";

// Professional estimate templates with smart tag formulas
const ESTIMATE_TEMPLATES = {
  // ROOFING TEMPLATES
  shingle: {
    name: "Shingle Replacement",
    category: "roofing",
    categoryColor: "bg-emerald-500",
    description: "Complete asphalt shingle tear-off and replacement with 30-year warranty materials",
    icon: Home,
    materials: [
      { item: "Architectural Shingles (30-year)", quantity: "{{ roof.squares }}", unit: "squares", unitCost: 95, formula: "roof.squares" },
      { item: "Synthetic Underlayment", quantity: "{{ roof.squares }}", unit: "squares", unitCost: 15, formula: "roof.squares" },
      { item: "Ice & Water Shield", quantity: "{{ ceil(lf.valley / 50) + ceil(lf.eave / 100) }}", unit: "rolls", unitCost: 125, formula: "valleys_eaves" },
      { item: "Ridge Cap Shingles", quantity: "{{ ceil(lf.ridge_hip_total / 25) }}", unit: "bundles", unitCost: 55, formula: "lf.ridge_hip_total" },
      { item: "Starter Strip", quantity: "{{ ceil(lf.eave_rake_total / 100) }}", unit: "bundles", unitCost: 42, formula: "lf.eave_rake_total" },
      { item: "Drip Edge", quantity: "{{ ceil(lf.perimeter / 10) }}", unit: "sticks", unitCost: 12, formula: "lf.perimeter" },
      { item: "Pipe Boots", quantity: "{{ pen.pipe_vent }}", unit: "each", unitCost: 18, formula: "pen.pipe_vent" },
      { item: "Nails & Fasteners", quantity: "1", unit: "lot", unitCost: 145, formula: null },
    ],
    labor: [
      { item: "Tear-off & Disposal", hours: "{{ roof.squares * 0.5 }}", rate: 45, formula: "roof.squares" },
      { item: "Shingle Installation", hours: "{{ roof.squares * 0.75 }}", rate: 55, formula: "roof.squares" },
      { item: "Flashing & Detail Work", hours: "{{ pen.total * 0.5 + 4 }}", rate: 65, formula: "pen.total" },
      { item: "Final Cleanup", hours: "{{ ceil(roof.squares / 10) }}", rate: 40, formula: "roof.squares" },
    ]
  },
  metal: {
    name: "Standing Seam Metal",
    category: "roofing",
    categoryColor: "bg-emerald-500",
    description: "Premium standing seam metal roof with concealed fasteners and 50-year warranty",
    icon: Home,
    materials: [
      { item: "Metal Panels (24ga)", quantity: "{{ roof.squares }}", unit: "squares", unitCost: 225, formula: "roof.squares" },
      { item: "Synthetic Underlayment", quantity: "{{ roof.squares }}", unit: "squares", unitCost: 18, formula: "roof.squares" },
      { item: "Ridge Cap Metal", quantity: "{{ ceil(lf.ridge / 10) }}", unit: "pieces", unitCost: 45, formula: "lf.ridge" },
      { item: "Trim & Flashing", quantity: "{{ ceil(lf.perimeter / 10) }}", unit: "pieces", unitCost: 28, formula: "lf.perimeter" },
      { item: "Z-Closure & Clips", quantity: "{{ roof.squares * 12 }}", unit: "each", unitCost: 2.50, formula: "roof.squares" },
      { item: "Pipe Boots (Metal)", quantity: "{{ pen.pipe_vent }}", unit: "each", unitCost: 35, formula: "pen.pipe_vent" },
      { item: "Sealants & Butyl Tape", quantity: "1", unit: "lot", unitCost: 185, formula: null },
    ],
    labor: [
      { item: "Tear-off & Disposal", hours: "{{ roof.squares * 0.5 }}", rate: 45, formula: "roof.squares" },
      { item: "Panel Installation", hours: "{{ roof.squares * 1.25 }}", rate: 75, formula: "roof.squares" },
      { item: "Trim & Detail Work", hours: "{{ ceil(lf.perimeter / 20) }}", rate: 70, formula: "lf.perimeter" },
      { item: "Final Inspection", hours: "2", rate: 65, formula: null },
    ]
  },
  tile: {
    name: "Tile Roof Repair",
    category: "roofing",
    categoryColor: "bg-emerald-500",
    description: "Professional tile repair including underlayment and matching replacement tiles",
    icon: Home,
    materials: [
      { item: "Replacement Tiles", quantity: "{{ roof.squares * 3 }}", unit: "tiles", unitCost: 12, formula: "roof.squares" },
      { item: "Tile Adhesive", quantity: "{{ ceil(roof.squares / 3) }}", unit: "tubes", unitCost: 18, formula: "roof.squares" },
      { item: "Underlayment Patch", quantity: "{{ ceil(roof.squares / 5) }}", unit: "squares", unitCost: 15, formula: "roof.squares" },
      { item: "Flashing Repair Kit", quantity: "1", unit: "kit", unitCost: 145, formula: null },
      { item: "Mortar Mix", quantity: "{{ ceil(roof.squares / 5) }}", unit: "bags", unitCost: 15, formula: "roof.squares" },
    ],
    labor: [
      { item: "Tile Removal", hours: "{{ roof.squares * 1 }}", rate: 45, formula: "roof.squares" },
      { item: "Underlayment Repair", hours: "{{ roof.squares * 0.5 }}", rate: 55, formula: "roof.squares" },
      { item: "Tile Installation", hours: "{{ roof.squares * 1.5 }}", rate: 60, formula: "roof.squares" },
      { item: "Cleanup", hours: "2", rate: 40, formula: null },
    ]
  },
  
  // EXTERIOR TEMPLATES
  siding: {
    name: "Siding Installation",
    category: "siding",
    categoryColor: "bg-blue-500",
    description: "Complete vinyl or fiber cement siding replacement with insulation wrap",
    icon: Square,
    materials: [
      { item: "Siding Panels", quantity: "{{ siding.squares }}", unit: "squares", unitCost: 185, formula: "siding.squares" },
      { item: "House Wrap", quantity: "{{ ceil(siding.total_sqft / 1000) }}", unit: "rolls", unitCost: 145, formula: "siding.total_sqft" },
      { item: "J-Channel", quantity: "{{ ceil(siding.j_channel_lf / 12.5) }}", unit: "sticks", unitCost: 14, formula: "siding.j_channel_lf" },
      { item: "Inside Corners", quantity: "{{ siding.corners_inside }}", unit: "posts", unitCost: 28, formula: "siding.corners_inside" },
      { item: "Outside Corners", quantity: "{{ siding.corners_outside }}", unit: "posts", unitCost: 32, formula: "siding.corners_outside" },
      { item: "Starter Strip", quantity: "{{ ceil(siding.starter_strip_lf / 12) }}", unit: "pieces", unitCost: 18, formula: "siding.starter_strip_lf" },
      { item: "Nails & Fasteners", quantity: "1", unit: "lot", unitCost: 125, formula: null },
    ],
    labor: [
      { item: "Demo Existing Siding", hours: "{{ siding.squares * 0.75 }}", rate: 45, formula: "siding.squares" },
      { item: "Prep & House Wrap", hours: "{{ siding.squares * 0.25 }}", rate: 50, formula: "siding.squares" },
      { item: "Siding Installation", hours: "{{ siding.squares * 1.5 }}", rate: 60, formula: "siding.squares" },
      { item: "Trim & Detail Work", hours: "{{ ceil(window.count * 0.5) }}", rate: 55, formula: "window.count" },
    ]
  },
  gutters: {
    name: "Gutter System",
    category: "gutters",
    categoryColor: "bg-purple-500",
    description: "Seamless aluminum gutters with downspouts and optional leaf protection",
    icon: Droplets,
    materials: [
      { item: "Seamless Gutters (5\")", quantity: "{{ gutter.total_lf }}", unit: "LF", unitCost: 8.50, formula: "gutter.total_lf" },
      { item: "Downspouts (3x4)", quantity: "{{ gutter.downspout_lf }}", unit: "LF", unitCost: 6.50, formula: "gutter.downspout_lf" },
      { item: "Inside Corners", quantity: "{{ gutter.inside_corners }}", unit: "each", unitCost: 12, formula: "gutter.inside_corners" },
      { item: "Outside Corners", quantity: "{{ gutter.outside_corners }}", unit: "each", unitCost: 12, formula: "gutter.outside_corners" },
      { item: "End Caps", quantity: "{{ gutter.end_caps }}", unit: "each", unitCost: 8, formula: "gutter.end_caps" },
      { item: "Elbows", quantity: "{{ gutter.elbows }}", unit: "each", unitCost: 7, formula: "gutter.elbows" },
      { item: "Outlets/Drops", quantity: "{{ gutter.outlets }}", unit: "each", unitCost: 6, formula: "gutter.outlets" },
      { item: "Hidden Hangers", quantity: "{{ ceil(gutter.total_lf / 2) }}", unit: "each", unitCost: 3.50, formula: "gutter.total_lf" },
    ],
    labor: [
      { item: "Remove Old Gutters", hours: "{{ ceil(gutter.total_lf / 50) }}", rate: 45, formula: "gutter.total_lf" },
      { item: "Gutter Installation", hours: "{{ ceil(gutter.total_lf / 25) }}", rate: 55, formula: "gutter.total_lf" },
      { item: "Downspout Installation", hours: "{{ ceil(gutter.downspout_count * 0.5) }}", rate: 50, formula: "gutter.downspout_count" },
      { item: "Cleanup & Testing", hours: "1", rate: 45, formula: null },
    ]
  },
  soffit_fascia: {
    name: "Soffit & Fascia",
    category: "soffit",
    categoryColor: "bg-amber-500",
    description: "Aluminum or vinyl soffit and fascia replacement with ventilation",
    icon: LayoutGrid,
    materials: [
      { item: "Vented Soffit Panels", quantity: "{{ ceil(soffit.total_sqft / 12) }}", unit: "panels", unitCost: 28, formula: "soffit.total_sqft" },
      { item: "Fascia Coil (6\")", quantity: "{{ ceil(fascia.lf / 50) }}", unit: "rolls", unitCost: 145, formula: "fascia.lf" },
      { item: "F-Channel", quantity: "{{ ceil(soffit.lf / 12) }}", unit: "sticks", unitCost: 12, formula: "soffit.lf" },
      { item: "J-Channel", quantity: "{{ ceil(fascia.lf / 12) }}", unit: "sticks", unitCost: 14, formula: "fascia.lf" },
      { item: "Nails & Trim Coil", quantity: "1", unit: "lot", unitCost: 95, formula: null },
    ],
    labor: [
      { item: "Remove Old Soffit/Fascia", hours: "{{ ceil(soffit.lf / 30) }}", rate: 45, formula: "soffit.lf" },
      { item: "Wood Repair (if needed)", hours: "{{ ceil(fascia.lf / 100) * 2 }}", rate: 55, formula: "fascia.lf" },
      { item: "Soffit Installation", hours: "{{ ceil(soffit.lf / 20) }}", rate: 55, formula: "soffit.lf" },
      { item: "Fascia Wrap", hours: "{{ ceil(fascia.lf / 25) }}", rate: 60, formula: "fascia.lf" },
    ]
  },
  windows: {
    name: "Window Replacement",
    category: "windows",
    categoryColor: "bg-cyan-500",
    description: "Energy-efficient vinyl or impact window replacement with professional installation",
    icon: Square,
    materials: [
      { item: "Standard Windows", quantity: "{{ window.standard_count }}", unit: "each", unitCost: 385, formula: "window.standard_count" },
      { item: "Large Windows", quantity: "{{ window.large_count }}", unit: "each", unitCost: 625, formula: "window.large_count" },
      { item: "Picture Windows", quantity: "{{ window.picture_count }}", unit: "each", unitCost: 895, formula: "window.picture_count" },
      { item: "Exterior Trim (PVC)", quantity: "{{ ceil(window.trim_lf / 16) }}", unit: "sticks", unitCost: 45, formula: "window.trim_lf" },
      { item: "Flashing Tape", quantity: "{{ ceil(window.count / 5) }}", unit: "rolls", unitCost: 35, formula: "window.count" },
      { item: "Caulk & Sealant", quantity: "{{ ceil(window.count / 3) }}", unit: "tubes", unitCost: 12, formula: "window.count" },
    ],
    labor: [
      { item: "Window Removal", hours: "{{ window.count * 0.5 }}", rate: 45, formula: "window.count" },
      { item: "Window Installation", hours: "{{ window.count * 1.5 }}", rate: 65, formula: "window.count" },
      { item: "Trim & Finishing", hours: "{{ window.count * 0.75 }}", rate: 55, formula: "window.count" },
      { item: "Cleanup & Inspection", hours: "{{ ceil(window.count / 5) }}", rate: 45, formula: "window.count" },
    ]
  },
  complete_exterior: {
    name: "Complete Exterior",
    category: "bundle",
    categoryColor: "bg-rose-500",
    description: "Full exterior renovation: roofing, siding, gutters, soffit/fascia, and windows",
    icon: Package,
    materials: [
      { item: "Architectural Shingles", quantity: "{{ roof.squares }}", unit: "squares", unitCost: 95, formula: "roof.squares" },
      { item: "Siding Panels", quantity: "{{ siding.squares }}", unit: "squares", unitCost: 175, formula: "siding.squares" },
      { item: "Seamless Gutters", quantity: "{{ gutter.total_lf }}", unit: "LF", unitCost: 8, formula: "gutter.total_lf" },
      { item: "Soffit Panels", quantity: "{{ ceil(soffit.total_sqft / 12) }}", unit: "panels", unitCost: 26, formula: "soffit.total_sqft" },
      { item: "Fascia Coil", quantity: "{{ ceil(fascia.lf / 50) }}", unit: "rolls", unitCost: 135, formula: "fascia.lf" },
      { item: "Standard Windows", quantity: "{{ window.standard_count }}", unit: "each", unitCost: 365, formula: "window.standard_count" },
      { item: "Trim & Accessories", quantity: "1", unit: "lot", unitCost: 950, formula: null },
    ],
    labor: [
      { item: "Demo & Prep", hours: "{{ (roof.squares + siding.squares) * 0.5 }}", rate: 45, formula: "combined" },
      { item: "Roofing Work", hours: "{{ roof.squares * 1 }}", rate: 55, formula: "roof.squares" },
      { item: "Siding Work", hours: "{{ siding.squares * 1.5 }}", rate: 58, formula: "siding.squares" },
      { item: "Gutter Installation", hours: "{{ ceil(gutter.total_lf / 25) }}", rate: 52, formula: "gutter.total_lf" },
      { item: "Window Installation", hours: "{{ window.count * 1.5 }}", rate: 62, formula: "window.count" },
      { item: "Final Details & Cleanup", hours: "8", rate: 50, formula: null },
    ]
  }
};

const categoryLabels: Record<string, string> = {
  roofing: "Roofing",
  siding: "Siding",
  gutters: "Gutters",
  soffit: "Soffit & Fascia",
  windows: "Windows",
  bundle: "Bundle Package"
};

// Custom line item interface
interface CustomLineItem {
  id: string;
  type: 'material' | 'labor';
  item: string;
  quantity: number;
  unitCost: number;
  unit: string;
  total: number;
}

const EstimatePreview = () => {
  const [selectedTemplate, setSelectedTemplate] = useState("shingle");
  const [activeCategory, setActiveCategory] = useState("roofing");
  
  // Custom line items added by user
  const [customMaterials, setCustomMaterials] = useState<CustomLineItem[]>([]);
  const [customLabor, setCustomLabor] = useState<CustomLineItem[]>([]);
  
  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ item: string; quantity: number; unitCost: number; unit: string }>({
    item: '', quantity: 0, unitCost: 0, unit: ''
  });
  
  // Deleted template items (to exclude from calculations)
  const [deletedTemplateItems, setDeletedTemplateItems] = useState<Set<number>>(new Set());
  const [deletedLaborItems, setDeletedLaborItems] = useState<Set<number>>(new Set());

  // Mock measurement data for demonstration
  const mockMeasurements = {
    'roof.squares': 28,
    'roof.plan_sqft': 2800,
    'lf.ridge': 45,
    'lf.hip': 35,
    'lf.valley': 20,
    'lf.eave': 120,
    'lf.rake': 80,
    'lf.perimeter': 200,
    'lf.ridge_hip_total': 80,
    'lf.eave_rake_total': 200,
    'pen.pipe_vent': 5,
    'pen.total': 7,
    'siding.squares': 22,
    'siding.total_sqft': 2200,
    'siding.j_channel_lf': 180,
    'siding.corners_inside': 4,
    'siding.corners_outside': 8,
    'siding.starter_strip_lf': 145,
    'gutter.total_lf': 165,
    'gutter.downspout_lf': 80,
    'gutter.downspout_count': 8,
    'gutter.inside_corners': 4,
    'gutter.outside_corners': 6,
    'gutter.end_caps': 8,
    'gutter.elbows': 24,
    'gutter.outlets': 8,
    'soffit.total_sqft': 320,
    'soffit.lf': 210,
    'fascia.lf': 210,
    'window.count': 14,
    'window.standard_count': 10,
    'window.large_count': 3,
    'window.picture_count': 1,
    'window.trim_lf': 320,
  };

  // Simple formula evaluator for mock calculations
  const evaluateFormula = (quantity: string): number => {
    if (!quantity.includes('{{')) return parseFloat(quantity) || 1;
    
    // Extract the expression
    const expr = quantity.replace(/\{\{|\}\}/g, '').trim();
    
    // Replace tag references with values
    let evaluated = expr;
    Object.entries(mockMeasurements).forEach(([key, value]) => {
      evaluated = evaluated.replace(new RegExp(key.replace('.', '\\.'), 'g'), String(value));
    });
    
    // Safe eval using Function
    try {
      const fn = new Function('ceil', 'floor', 'round', `return (${evaluated});`);
      return fn(Math.ceil, Math.floor, Math.round);
    } catch {
      return 1;
    }
  };
  
  // Add new material item
  const addMaterialItem = () => {
    const newItem: CustomLineItem = {
      id: `custom-mat-${Date.now()}`,
      type: 'material',
      item: 'New Material',
      quantity: 1,
      unitCost: 0,
      unit: 'each',
      total: 0
    };
    setCustomMaterials([...customMaterials, newItem]);
    startEditing(newItem.id, newItem.item, newItem.quantity, newItem.unitCost, newItem.unit);
  };
  
  // Add new labor item
  const addLaborItem = () => {
    const newItem: CustomLineItem = {
      id: `custom-lab-${Date.now()}`,
      type: 'labor',
      item: 'New Labor',
      quantity: 1,
      unitCost: 45,
      unit: 'hours',
      total: 45
    };
    setCustomLabor([...customLabor, newItem]);
    startEditing(newItem.id, newItem.item, newItem.quantity, newItem.unitCost, newItem.unit);
  };
  
  // Delete custom item
  const deleteCustomItem = (id: string, type: 'material' | 'labor') => {
    if (type === 'material') {
      setCustomMaterials(items => items.filter(i => i.id !== id));
    } else {
      setCustomLabor(items => items.filter(i => i.id !== id));
    }
  };
  
  // Delete template item (mark as deleted)
  const deleteTemplateItem = (index: number, type: 'material' | 'labor') => {
    if (type === 'material') {
      setDeletedTemplateItems(prev => new Set([...prev, index]));
    } else {
      setDeletedLaborItems(prev => new Set([...prev, index]));
    }
  };
  
  // Start editing
  const startEditing = (id: string, item: string, quantity: number, unitCost: number, unit: string) => {
    setEditingId(id);
    setEditValues({ item, quantity, unitCost, unit });
  };
  
  // Save editing
  const saveEditing = (id: string, type: 'material' | 'labor') => {
    if (type === 'material') {
      setCustomMaterials(items => items.map(i => 
        i.id === id 
          ? { ...i, ...editValues, total: editValues.quantity * editValues.unitCost }
          : i
      ));
    } else {
      setCustomLabor(items => items.map(i => 
        i.id === id 
          ? { ...i, ...editValues, total: editValues.quantity * editValues.unitCost }
          : i
      ));
    }
    setEditingId(null);
  };
  
  // Cancel editing
  const cancelEditing = () => {
    setEditingId(null);
  };

  const currentTemplate = ESTIMATE_TEMPLATES[selectedTemplate as keyof typeof ESTIMATE_TEMPLATES];
  
  // Calculate materials with evaluated quantities (excluding deleted ones)
  const calculatedMaterials = currentTemplate.materials
    .map((item, index) => {
      const qty = evaluateFormula(item.quantity);
      return {
        ...item,
        templateIndex: index,
        calculatedQty: qty,
        total: qty * item.unitCost
      };
    })
    .filter((_, index) => !deletedTemplateItems.has(index));
  
  // Calculate labor with evaluated hours (excluding deleted ones)
  const calculatedLabor = currentTemplate.labor
    .map((item, index) => {
      const hrs = evaluateFormula(String(item.hours));
      return {
        ...item,
        templateIndex: index,
        calculatedHours: hrs,
        total: hrs * item.rate
      };
    })
    .filter((_, index) => !deletedLaborItems.has(index));
  
  // Combine template items with custom items
  const allMaterialCost = calculatedMaterials.reduce((sum, item) => sum + item.total, 0) 
    + customMaterials.reduce((sum, item) => sum + item.total, 0);
  const allLaborCost = calculatedLabor.reduce((sum, item) => sum + item.total, 0)
    + customLabor.reduce((sum, item) => sum + item.total, 0);
  const totalItemCount = calculatedMaterials.length + customMaterials.length + calculatedLabor.length + customLabor.length;
  
  const materialCost = allMaterialCost;
  const laborCost = allLaborCost;
  const totalJobCost = materialCost + laborCost;
  
  const overheadRate = 0.15;
  const targetMargin = 0.30;
  const overhead = totalJobCost * overheadRate;
  const totalCostWithOverhead = totalJobCost + overhead;
  const sellingPrice = totalCostWithOverhead / (1 - targetMargin);
  const actualProfit = sellingPrice - totalCostWithOverhead;
  const actualMargin = (actualProfit / sellingPrice) * 100;
  const commissionRate = 0.03;
  const salesRepPay = sellingPrice * commissionRate;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const filteredTemplates = Object.entries(ESTIMATE_TEMPLATES).filter(
    ([_, template]) => template.category === activeCategory
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">
            Professional Estimate Builder
          </h1>
          <p className="text-muted-foreground">
            Smart-tag powered estimates with auto-calculated quantities
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline">
            <FileText className="h-4 w-4 mr-2" />
            Save Draft
          </Button>
          <Button className="bg-primary hover:bg-primary/90">
            <CheckCircle className="h-4 w-4 mr-2" />
            Send Estimate
          </Button>
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={activeCategory} onValueChange={setActiveCategory}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="roofing" className="flex items-center gap-2">
            <Home className="h-4 w-4" />
            Roofing
          </TabsTrigger>
          <TabsTrigger value="siding" className="flex items-center gap-2">
            <Square className="h-4 w-4" />
            Siding
          </TabsTrigger>
          <TabsTrigger value="gutters" className="flex items-center gap-2">
            <Droplets className="h-4 w-4" />
            Gutters
          </TabsTrigger>
          <TabsTrigger value="soffit" className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4" />
            Soffit/Fascia
          </TabsTrigger>
          <TabsTrigger value="windows" className="flex items-center gap-2">
            <Square className="h-4 w-4" />
            Windows
          </TabsTrigger>
          <TabsTrigger value="bundle" className="flex items-center gap-2">
            <Package className="h-4 w-4" />
            Bundle
          </TabsTrigger>
        </TabsList>

        {Object.keys(categoryLabels).map(cat => (
          <TabsContent key={cat} value={cat} className="mt-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {filteredTemplates.map(([key, template]) => {
                const IconComponent = template.icon;
                return (
                  <Card 
                    key={key}
                    className={`cursor-pointer transition-all hover:shadow-md ${
                      selectedTemplate === key 
                        ? 'ring-2 ring-primary border-primary' 
                        : 'hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedTemplate(key)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded-lg ${template.categoryColor} text-white`}>
                          <IconComponent className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-sm truncate">{template.name}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                            {template.description}
                          </p>
                        </div>
                        {selectedTemplate === key && (
                          <CheckCircle className="h-5 w-5 text-primary flex-shrink-0" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* Property Measurements Summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Ruler className="h-4 w-4 text-primary" />
            Property Measurements (Auto-Populated)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Roof Area</span>
              <p className="font-semibold">{mockMeasurements['roof.squares']} squares</p>
            </div>
            <div>
              <span className="text-muted-foreground">Ridge/Hip</span>
              <p className="font-semibold">{mockMeasurements['lf.ridge_hip_total']} LF</p>
            </div>
            <div>
              <span className="text-muted-foreground">Eave/Rake</span>
              <p className="font-semibold">{mockMeasurements['lf.eave_rake_total']} LF</p>
            </div>
            <div>
              <span className="text-muted-foreground">Siding</span>
              <p className="font-semibold">{mockMeasurements['siding.squares']} squares</p>
            </div>
            <div>
              <span className="text-muted-foreground">Gutters</span>
              <p className="font-semibold">{mockMeasurements['gutter.total_lf']} LF</p>
            </div>
            <div>
              <span className="text-muted-foreground">Windows</span>
              <p className="font-semibold">{mockMeasurements['window.count']} total</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Materials Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-secondary" />
              Materials
              <Badge variant="outline" className="ml-auto">{calculatedMaterials.length + customMaterials.length} items</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px] pr-4">
              <div className="space-y-2">
                {/* Template materials */}
                {calculatedMaterials.map((item, index) => (
                  <div key={`template-${index}`} className="group flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.item}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.calculatedQty.toFixed(1)} {item.unit} × {formatCurrency(item.unitCost)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-right">
                        {formatCurrency(item.total)}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={() => deleteTemplateItem(item.templateIndex, 'material')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {/* Custom materials */}
                {customMaterials.map((item) => (
                  <div key={item.id} className="group flex justify-between items-center py-2 border-b border-border/50 last:border-0 bg-primary/5 -mx-2 px-2 rounded">
                    {editingId === item.id ? (
                      <div className="flex-1 flex gap-2 items-center">
                        <Input 
                          value={editValues.item} 
                          onChange={(e) => setEditValues({ ...editValues, item: e.target.value })}
                          className="h-7 text-sm flex-1"
                          placeholder="Item name"
                        />
                        <Input 
                          type="number"
                          value={editValues.quantity} 
                          onChange={(e) => setEditValues({ ...editValues, quantity: parseFloat(e.target.value) || 0 })}
                          className="h-7 text-sm w-16"
                          placeholder="Qty"
                        />
                        <Input 
                          type="number"
                          value={editValues.unitCost} 
                          onChange={(e) => setEditValues({ ...editValues, unitCost: parseFloat(e.target.value) || 0 })}
                          className="h-7 text-sm w-20"
                          placeholder="Cost"
                        />
                        <Button size="icon" className="h-6 w-6" onClick={() => saveEditing(item.id, 'material')}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEditing}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate flex items-center gap-1">
                            {item.item}
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">Custom</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.quantity.toFixed(1)} {item.unit} × {formatCurrency(item.unitCost)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-right">
                            {formatCurrency(item.total)}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => startEditing(item.id, item.item, item.quantity, item.unitCost, item.unit)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => deleteCustomItem(item.id, 'material')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <Button variant="outline" size="sm" className="w-full mt-3" onClick={addMaterialItem}>
              <Plus className="h-4 w-4 mr-2" />
              Add Material
            </Button>
            
            <Separator className="my-3" />
            <div className="flex justify-between items-center font-bold text-lg">
              <span>Material Total</span>
              <span className="text-secondary">{formatCurrency(materialCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Labor Breakdown */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Labor
              <Badge variant="outline" className="ml-auto">{calculatedLabor.length + customLabor.length} items</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[320px] pr-4">
              <div className="space-y-2">
                {/* Template labor */}
                {calculatedLabor.map((item, index) => (
                  <div key={`template-${index}`} className="group flex justify-between items-center py-2 border-b border-border/50 last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{item.item}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.calculatedHours.toFixed(1)}h × {formatCurrency(item.rate)}/hr
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-right">
                        {formatCurrency(item.total)}
                      </span>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                        onClick={() => deleteTemplateItem(item.templateIndex, 'labor')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
                
                {/* Custom labor */}
                {customLabor.map((item) => (
                  <div key={item.id} className="group flex justify-between items-center py-2 border-b border-border/50 last:border-0 bg-primary/5 -mx-2 px-2 rounded">
                    {editingId === item.id ? (
                      <div className="flex-1 flex gap-2 items-center">
                        <Input 
                          value={editValues.item} 
                          onChange={(e) => setEditValues({ ...editValues, item: e.target.value })}
                          className="h-7 text-sm flex-1"
                          placeholder="Item name"
                        />
                        <Input 
                          type="number"
                          value={editValues.quantity} 
                          onChange={(e) => setEditValues({ ...editValues, quantity: parseFloat(e.target.value) || 0 })}
                          className="h-7 text-sm w-16"
                          placeholder="Hours"
                        />
                        <Input 
                          type="number"
                          value={editValues.unitCost} 
                          onChange={(e) => setEditValues({ ...editValues, unitCost: parseFloat(e.target.value) || 0 })}
                          className="h-7 text-sm w-20"
                          placeholder="Rate"
                        />
                        <Button size="icon" className="h-6 w-6" onClick={() => saveEditing(item.id, 'labor')}>
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={cancelEditing}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate flex items-center gap-1">
                            {item.item}
                            <Badge variant="secondary" className="text-[10px] px-1 py-0">Custom</Badge>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {item.quantity.toFixed(1)}h × {formatCurrency(item.unitCost)}/hr
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-right">
                            {formatCurrency(item.total)}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => startEditing(item.id, item.item, item.quantity, item.unitCost, item.unit)}
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                            onClick={() => deleteCustomItem(item.id, 'labor')}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
            
            <Button variant="outline" size="sm" className="w-full mt-3" onClick={addLaborItem}>
              <Plus className="h-4 w-4 mr-2" />
              Add Labor
            </Button>
            
            <Separator className="my-3" />
            <div className="flex justify-between items-center font-bold text-lg">
              <span>Labor Total</span>
              <span className="text-primary">{formatCurrency(laborCost)}</span>
            </div>
          </CardContent>
        </Card>

        {/* Profit Analysis */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-success" />
              Profit Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm">Material Cost</span>
                <span className="font-medium">{formatCurrency(materialCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Labor Cost</span>
                <span className="font-medium">{formatCurrency(laborCost)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Overhead ({(overheadRate * 100).toFixed(0)}%)</span>
                <span className="font-medium">{formatCurrency(overhead)}</span>
              </div>
              <Separator />
              <div className="flex justify-between">
                <span className="text-sm font-medium">Total Job Cost</span>
                <span className="font-semibold">{formatCurrency(totalCostWithOverhead)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Target Margin</span>
                <Badge variant="outline">{(targetMargin * 100).toFixed(0)}%</Badge>
              </div>
              <Separator />
              <div className="flex justify-between text-lg bg-success/10 p-3 rounded-lg -mx-3">
                <span className="font-bold">Contract Price</span>
                <span className="font-bold text-success">{formatCurrency(sellingPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Profit Amount</span>
                <span className="font-semibold text-success">{formatCurrency(actualProfit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm">Actual Margin</span>
                <Badge className="bg-success text-success-foreground">
                  {actualMargin.toFixed(1)}%
                </Badge>
              </div>
            </div>

            {actualMargin < 25 && (
              <div className="p-3 bg-warning/10 border border-warning rounded-lg">
                <div className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="h-4 w-4" />
                  <span className="text-sm font-medium">Low Margin Warning</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Margin below company minimum of 25%
                </p>
              </div>
            )}

            <Separator />
            <div className="flex justify-between">
              <span className="text-sm">Sales Rep Pay ({(commissionRate * 100).toFixed(0)}%)</span>
              <span className="font-medium">{formatCurrency(salesRepPay)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Estimate Ready for Review</h3>
              <p className="text-sm text-muted-foreground">
                All calculations verified • {totalItemCount} line items • {currentTemplate.name}
              </p>
            </div>
            <div className="flex gap-3">
              <Button variant="outline">
                <Calculator className="h-4 w-4 mr-2" />
                Adjust Parameters
              </Button>
              <Button className="bg-primary hover:bg-primary/90">
                <FileText className="h-4 w-4 mr-2" />
                Generate PDF
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EstimatePreview;