// Estimate Preview Panel with live toggle controls
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useGoogleMapsToken } from '@/hooks/useGoogleMapsToken';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Building2,
  User,
  List,
  DollarSign,
  FileSignature,
  Download,
  Loader2,
  Eye,
  AlertTriangle,
  Image,
  Ruler,
  RotateCcw,
  FileText,
  Paperclip,
  ChevronDown,
  Layers,
  Share2,
  Save,
  X,
  ArrowLeft,
  Files,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  type PDFComponentOptions,
  type PDFViewMode,
  getDefaultOptions,
} from './PDFComponentOptions';
import { EstimatePDFDocument } from './EstimatePDFDocument';
import { AttachmentPagesRenderer } from './AttachmentPagesRenderer';
import { EstimateAttachmentsManager, type TemplateAttachment } from './EstimateAttachmentsManager';
import { PageOrderManager, DEFAULT_PAGE_ORDER, type PageOrderItem } from './PageOrderManager';
import { type LineItem } from '@/hooks/useEstimatePricing';
import { useMultiPagePDFGeneration } from '@/hooks/useMultiPagePDFGeneration';
import { useToast } from '@/hooks/use-toast';
import { ShareEstimateDialog } from './ShareEstimateDialog';
import { saveEstimatePdf } from '@/lib/estimates/estimatePdfSaver';

interface CompanyInfo {
  name: string;
  logo_url?: string | null;
  phone?: string | null;
  email?: string | null;
  address_street?: string | null;
  address_city?: string | null;
  address_state?: string | null;
  address_zip?: string | null;
  license_number?: string | null;
  established_year?: number | null;
  brand_story?: string | null;
  brand_mission?: string | null;
  brand_certifications?: string | null;
}

interface MeasurementSummary {
  totalSquares: number;
  totalSqFt: number;
  eaveLength: number;
  ridgeLength: number;
  hipLength: number;
  valleyLength: number;
  rakeLength: number;
  wastePercent: number;
}

interface EstimatePreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  estimateNumber: string;
  estimateDisplayName?: string;
  templateName?: string;
  customerName: string;
  customerAddress: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  companyInfo?: CompanyInfo | null;
  templateStyle?: string | null;
  materialItems: LineItem[];
  laborItems: LineItem[];
  breakdown: {
    materialsTotal: number;
    laborTotal: number;
    directCost: number;
    overheadAmount: number;
    totalCost: number;
    profitAmount: number;
    repCommissionAmount: number;
    sellingPrice: number;
    actualProfitMargin: number;
    salesTaxAmount?: number;
    totalWithTax?: number;
  };
  config: {
    overheadPercent: number;
    profitMarginPercent: number;
    repCommissionPercent: number;
    salesTaxEnabled?: boolean;
    salesTaxRate?: number;
  };
  finePrintContent?: string;
  warrantyTerms?: string;
  measurementSummary?: MeasurementSummary | null;
  templateAttachments?: TemplateAttachment[];
  // Callbacks for managing attachments
  onAttachmentsChange?: (attachments: TemplateAttachment[]) => void;
  // Share functionality props
  estimateId?: string;
  pipelineEntryId?: string;
  contactId?: string;
  // For PDF regeneration before sharing
  tenantId?: string;
  userId?: string;
  // Multi-estimate selection
  allEstimates?: Array<{
    id: string;
    display_name: string | null;
    estimate_number: string;
    selling_price: number;
  }>;
}

// Fetched estimate data for additional estimates
interface FetchedEstimateData {
  estimateNumber: string;
  estimateName?: string;
  materialItems: LineItem[];
  laborItems: LineItem[];
  breakdown: EstimatePreviewPanelProps['breakdown'];
  config: EstimatePreviewPanelProps['config'];
}

export function EstimatePreviewPanel({
  open,
  onOpenChange,
  estimateNumber,
  estimateDisplayName,
  templateName,
  customerName,
  customerAddress,
  customerPhone,
  customerEmail,
  companyInfo,
  templateStyle,
  materialItems,
  laborItems,
  breakdown,
  config,
  finePrintContent,
  warrantyTerms,
  measurementSummary,
  templateAttachments = [],
  onAttachmentsChange,
  estimateId,
  pipelineEntryId,
  contactId,
  tenantId,
  userId,
  allEstimates = [],
}: EstimatePreviewPanelProps) {
  const [viewMode, setViewMode] = useState<PDFViewMode>('customer');
  // Tenant-aware default overrides (e.g., O'Brien Contracting hides manufacturer warranty)
  const applyTenantDefaults = (opts: PDFComponentOptions): PDFComponentOptions => {
    const name = (companyInfo?.name || '').toLowerCase();
    const isObrien = name.includes("o'brien") || name.includes('obrien');
    if (isObrien) {
      return { ...opts, showManufacturerWarranty: false };
    }
    return opts;
  };
  const [options, setOptions] = useState<PDFComponentOptions>(() => applyTenantDefaults(getDefaultOptions('customer')));
  const [isExporting, setIsExporting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [additionalAttachments, setAdditionalAttachments] = useState<TemplateAttachment[]>([]);
  const [removedTemplateIds, setRemovedTemplateIds] = useState<Set<string>>(new Set());
  const [pageOrder, setPageOrder] = useState<PageOrderItem[]>(DEFAULT_PAGE_ORDER);
  const [isPageOrderOpen, setIsPageOrderOpen] = useState(false);
  const [isAttachmentsOpen, setIsAttachmentsOpen] = useState(true);
  const [showShareDialog, setShowShareDialog] = useState(false);
  const [signaturePageIndex, setSignaturePageIndex] = useState<number | null>(null);
  // Multi-estimate selection state
  const [selectedAdditionalIds, setSelectedAdditionalIds] = useState<Set<string>>(new Set());
  const [fetchedEstimates, setFetchedEstimates] = useState<Map<string, FetchedEstimateData>>(new Map());
  const [isEstimatesOpen, setIsEstimatesOpen] = useState(true);
  const { generateMultiPagePDF, isGenerating: isGeneratingPDF } = useMultiPagePDFGeneration();
  const { toast } = useToast();
  const previewRef = useRef<HTMLDivElement>(null);
  const photoUploadRef = useRef<HTMLInputElement>(null);

  // Cover photo source state
  type CoverPhotoSource = 'none' | 'uploaded' | 'streetview' | 'aerial';
  const [coverPhotoSource, setCoverPhotoSource] = useState<CoverPhotoSource>('none');
  const [selectedUploadedPhotoId, setSelectedUploadedPhotoId] = useState<string | null>(null);
  const [streetViewUrl, setStreetViewUrl] = useState<string | null>(null);
  const [aerialUrl, setAerialUrl] = useState<string | null>(null);
  const [propertyCoords, setPropertyCoords] = useState<{ lat: number; lng: number } | null>(null);
  const { apiKey: googleMapsApiKey } = useGoogleMapsToken();

  // Fetch saved estimates for this pipeline entry (for multi-estimate selection)
  const [siblingEstimates, setSiblingEstimates] = useState<Array<{
    id: string;
    display_name: string | null;
    estimate_number: string;
    selling_price: number;
  }>>([]);

  useEffect(() => {
    if (!open || !pipelineEntryId) return;
    const fetchSiblings = async () => {
      const { data } = await supabase
        .from('enhanced_estimates')
        .select('id, display_name, estimate_number, selling_price')
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });
      setSiblingEstimates(data || []);
    };
    fetchSiblings();
  }, [open, pipelineEntryId]);

  // Combine explicit prop with fetched data
  const estimatesList = allEstimates.length > 0 ? allEstimates : siblingEstimates;

  const [jobPhotos, setJobPhotos] = useState<Array<{
    id: string;
    file_url: string;
    description?: string | null;
    category?: string | null;
  }>>([]);

  useEffect(() => {
    if (!open || (!pipelineEntryId && !contactId)) return;

    const fetchPhotos = async () => {
      // First try: photos explicitly marked for estimate inclusion
      let query = supabase
        .from('customer_photos')
        .select('id, file_url, description, category, include_in_estimate');

      // Query by lead_id first, fall back to contact_id
      if (pipelineEntryId) {
        query = query.eq('lead_id', pipelineEntryId);
      } else if (contactId) {
        query = query.eq('contact_id', contactId);
      }

      const { data } = await query.order('display_order');

      let photos: typeof jobPhotos = [];

      if (data && data.length > 0) {
        const estimateMarked = data.filter(p => p.include_in_estimate === true);
        photos = estimateMarked.length > 0 ? estimateMarked : data;
      } else if (contactId && pipelineEntryId) {
        const { data: contactPhotos } = await supabase
          .from('customer_photos')
          .select('id, file_url, description, category, include_in_estimate')
          .eq('contact_id', contactId)
          .order('display_order');
        if (contactPhotos && contactPhotos.length > 0) {
          const estimateMarked = contactPhotos.filter(p => p.include_in_estimate === true);
          photos = estimateMarked.length > 0 ? estimateMarked : contactPhotos;
        }
      }

      // Fallback: query documents table for image files linked to this lead
      if (photos.length === 0 && pipelineEntryId) {
        const { data: docPhotos } = await supabase
          .from('documents')
          .select('id, file_path, filename, document_type, mime_type, description')
          .eq('pipeline_entry_id', pipelineEntryId)
          .or('mime_type.ilike.image/%,document_type.in.(photo,inspection_photo,job_photo,progress_photo,completion_photo,required_photos)')
          .order('created_at', { ascending: false });

        if (docPhotos && docPhotos.length > 0) {
          const existingIds = new Set(photos.map(p => p.id));
          const mapped = await Promise.all(
            docPhotos
              .filter(d => !existingIds.has(d.id) && d.file_path)
              .map(async (d) => {
                const bucket = resolveStorageBucket(d.document_type, d.file_path);
                const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(d.file_path!, 3600);
                if (!urlData?.signedUrl) return null;
                return {
                  id: d.id,
                  file_url: urlData.signedUrl,
                  description: d.description || d.filename,
                  category: d.document_type,
                };
              })
          );
          photos = [...photos, ...mapped.filter(Boolean)];
        }
      }

      setJobPhotos(photos);
    };
    fetchPhotos();
  }, [pipelineEntryId, contactId, open]);

  // Aerial image fallback: if no job photos, pull from roof_measurements
  useEffect(() => {
    if (!open || jobPhotos.length > 0 || !contactId) return;

    const fetchAerial = async () => {
      const { data } = await supabase
        .from('roof_measurements')
        .select('google_maps_image_url, mapbox_image_url')
        .eq('customer_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const aerialUrl = data?.google_maps_image_url || data?.mapbox_image_url;
      if (aerialUrl) {
        setJobPhotos([{
          id: 'aerial',
          file_url: aerialUrl,
          description: 'Aerial View',
          category: 'aerial',
        }]);
      }
    };
    fetchAerial();
  }, [open, jobPhotos.length, contactId]);

  // Fetch property coordinates for Street View / Aerial
  useEffect(() => {
    if (!open || !contactId) return;
    const fetchCoords = async () => {
      // Try contacts table first
      const { data: contact } = await supabase
        .from('contacts')
        .select('latitude, longitude')
        .eq('id', contactId)
        .maybeSingle();
      if (contact?.latitude && contact?.longitude) {
        setPropertyCoords({ lat: contact.latitude, lng: contact.longitude });
        return;
      }
      // Fallback: roof_measurements gps_coordinates JSON
      const { data: rm } = await supabase
        .from('roof_measurements')
        .select('gps_coordinates')
        .eq('customer_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const gps = rm?.gps_coordinates as any;
      if (gps?.lat && gps?.lng) {
        setPropertyCoords({ lat: gps.lat, lng: gps.lng });
        return;
      }
      // Fallback: Geocode from customer address string
      if (googleMapsApiKey && customerAddress) {
        try {
          const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(customerAddress)}&key=${googleMapsApiKey}`;
          const resp = await fetch(geocodeUrl);
          const geo = await resp.json();
          if (geo.results?.[0]?.geometry?.location) {
            const { lat, lng } = geo.results[0].geometry.location;
            setPropertyCoords({ lat, lng });
          }
        } catch (err) {
          console.warn('Geocoding fallback failed:', err);
        }
      }
    };
    fetchCoords();
  }, [open, contactId, googleMapsApiKey, customerAddress]);

  // Generate Street View URL — verify imagery exists via Metadata API first.
  // If Google reports ZERO_RESULTS / no imagery, leave streetViewUrl null so
  // the cover automatically falls through to aerial.
  useEffect(() => {
    if (!propertyCoords || !googleMapsApiKey) return;
    let cancelled = false;
    const checkAndSet = async () => {
      try {
        const metaUrl = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${propertyCoords.lat},${propertyCoords.lng}&key=${googleMapsApiKey}`;
        const resp = await fetch(metaUrl);
        const meta = await resp.json();
        if (cancelled) return;
        if (meta.status === 'OK') {
          setStreetViewUrl(
            `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${propertyCoords.lat},${propertyCoords.lng}&key=${googleMapsApiKey}`
          );
        } else {
          // No street view imagery available — clear so aerial wins.
          setStreetViewUrl(null);
        }
      } catch (err) {
        console.warn('Street View metadata check failed:', err);
        if (!cancelled) setStreetViewUrl(null);
      }
    };
    checkAndSet();
    return () => { cancelled = true; };
  }, [propertyCoords, googleMapsApiKey]);

  // Fetch aerial URL from roof_measurements, fallback to Google Static Maps
  useEffect(() => {
    if (!open || !contactId) return;
    const fetchAerialUrl = async () => {
      const { data } = await supabase
        .from('roof_measurements')
        .select('google_maps_image_url, mapbox_image_url')
        .eq('customer_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const url = data?.google_maps_image_url || data?.mapbox_image_url;
      if (url) {
        setAerialUrl(url);
        return;
      }
      // Fallback: generate aerial from coords via Google Static Maps
      if (propertyCoords && googleMapsApiKey) {
        setAerialUrl(
          `https://maps.googleapis.com/maps/api/staticmap?center=${propertyCoords.lat},${propertyCoords.lng}&zoom=19&size=800x400&maptype=satellite&key=${googleMapsApiKey}`
        );
      }
    };
    fetchAerialUrl();
  }, [open, contactId, propertyCoords, googleMapsApiKey]);

  // Auto-default cover photo source — prefer uploaded > street view (only if
  // imagery actually exists) > aerial. If street view becomes unavailable
  // after selection, auto-fall through to aerial.
  useEffect(() => {
    if (!open) return;
    if (jobPhotos.length > 0 && jobPhotos[0].id !== 'aerial') {
      setCoverPhotoSource('uploaded');
      setSelectedUploadedPhotoId(jobPhotos[0].id);
    } else if (streetViewUrl) {
      setCoverPhotoSource('streetview');
    } else if (aerialUrl) {
      setCoverPhotoSource('aerial');
    } else {
      setCoverPhotoSource('none');
    }
  }, [open, jobPhotos, streetViewUrl, aerialUrl]);

  // Wire coverPagePropertyPhoto based on source selection.
  // Auto-fall through if the requested source isn't actually available.
  useEffect(() => {
    let photoUrl: string | undefined;
    if (coverPhotoSource === 'uploaded' && selectedUploadedPhotoId) {
      const photo = jobPhotos.find(p => p.id === selectedUploadedPhotoId);
      photoUrl = photo?.file_url;
    } else if (coverPhotoSource === 'streetview') {
      photoUrl = streetViewUrl || aerialUrl || undefined;
    } else if (coverPhotoSource === 'aerial') {
      photoUrl = aerialUrl || streetViewUrl || undefined;
    }
    setOptions(prev => ({ ...prev, coverPagePropertyPhoto: photoUrl }));
  }, [coverPhotoSource, selectedUploadedPhotoId, jobPhotos, streetViewUrl, aerialUrl]);

  // Fetch additional estimate data when selected
  const handleToggleEstimate = useCallback(async (estId: string) => {
    setSelectedAdditionalIds(prev => {
      const next = new Set(prev);
      if (next.has(estId)) {
        next.delete(estId);
      } else {
        next.add(estId);
      }
      return next;
    });

    // If not already fetched, fetch it
    if (!fetchedEstimates.has(estId)) {
      try {
        const { data: est } = await (supabase
          .from('enhanced_estimates') as any)
          .select('estimate_number, display_name, line_items, selling_price, material_total, labor_total, overhead_amount, overhead_percent, actual_profit_amount, actual_profit_percent, rep_commission_amount, rep_commission_percent, sales_tax_amount, sales_tax_rate, total_with_tax')
          .eq('id', estId)
          .single();

        if (est) {
          const lineItemsData = est.line_items as any;
          const materials: LineItem[] = (lineItemsData?.materials || []).map((item: any) => ({ ...item, item_type: 'material' as const }));
          const labor: LineItem[] = (lineItemsData?.labor || []).map((item: any) => ({ ...item, item_type: 'labor' as const }));

          const matTotal = est.material_total || 0;
          const labTotal = est.labor_total || 0;
          const directCost = matTotal + labTotal;
          const overheadAmt = est.overhead_amount || 0;
          const profitAmt = est.actual_profit_amount || 0;
          const repComm = (est.rep_commission_amount as number) || 0;

          const fetched: FetchedEstimateData = {
            estimateNumber: est.estimate_number,
            estimateName: est.display_name || undefined,
            materialItems: materials,
            laborItems: labor,
            breakdown: {
              materialsTotal: matTotal,
              laborTotal: labTotal,
              directCost,
              overheadAmount: overheadAmt,
              totalCost: directCost + overheadAmt,
              profitAmount: profitAmt,
              repCommissionAmount: repComm,
              sellingPrice: est.selling_price || 0,
              actualProfitMargin: est.actual_profit_percent || 0,
              salesTaxAmount: (est.sales_tax_amount as number) || 0,
              totalWithTax: (est.total_with_tax as number) || undefined,
            },
            config: {
              overheadPercent: est.overhead_percent || 0,
              profitMarginPercent: est.actual_profit_percent || 0,
              repCommissionPercent: (est.rep_commission_percent as number) || 0,
              salesTaxEnabled: !!(est.sales_tax_rate && est.sales_tax_rate > 0),
              salesTaxRate: (est.sales_tax_rate as number) || 0,
            },
          };

          setFetchedEstimates(prev => new Map(prev).set(estId, fetched));
        }
      } catch (err) {
        console.error('Failed to fetch estimate:', estId, err);
      }
    }
  }, [fetchedEstimates]);

  const handleUploadPhotos = useCallback(() => {
    photoUploadRef.current?.click();
  }, []);

  const handlePhotoFilesSelected = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;

    const leadId = pipelineEntryId;
    if (!leadId && !contactId) {
      toast({ title: 'Cannot upload', description: 'No lead or contact linked', variant: 'destructive' });
      return;
    }

    let uploaded = 0;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      if (file.size > 10 * 1024 * 1024) {
        toast({ title: 'File too large', description: `${file.name} exceeds 10MB`, variant: 'destructive' });
        continue;
      }

      const tid = tenantId || '';
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${tid}/leads/${leadId || contactId}/photos/${timestamp}_${safeName}`;

      const { error: uploadErr } = await supabase.storage
        .from('customer-photos')
        .upload(storagePath, file, { contentType: file.type, upsert: false });

      if (uploadErr) {
        console.error('Photo upload error:', uploadErr);
        continue;
      }

      const { data: urlData } = supabase.storage.from('customer-photos').getPublicUrl(storagePath);

      await (supabase.from('customer_photos') as any).insert({
        lead_id: leadId || null,
        contact_id: contactId || null,
        tenant_id: tid,
        file_url: urlData.publicUrl,
        file_path: storagePath,
        category: 'before',
        uploaded_by: userId || null,
        include_in_estimate: true,
      });
      uploaded++;
    }

    if (uploaded > 0) {
      toast({ title: 'Photos uploaded', description: `${uploaded} photo(s) added to estimate` });
      // Re-fetch photos
      const query = supabase
        .from('customer_photos')
        .select('id, file_url, description, category, include_in_estimate')
        .order('display_order');

      const { data } = leadId
        ? await query.eq('lead_id', leadId)
        : await query.eq('contact_id', contactId!);

      if (data && data.length > 0) {
        const estimateMarked = data.filter(p => p.include_in_estimate === true);
        setJobPhotos(estimateMarked.length > 0 ? estimateMarked : data);
      }

      // Auto-enable job_photos in page order
      setPageOrder(prev => prev.map(p => p.id === 'job_photos' ? { ...p, enabled: true } : p));
    }

    if (photoUploadRef.current) photoUploadRef.current.value = '';
  }, [pipelineEntryId, contactId, tenantId, userId, toast]);

  // Filter template attachments to exclude removed ones
  const activeTemplateAttachments = useMemo(() => 
    templateAttachments.filter(a => !removedTemplateIds.has(a.document_id)),
    [templateAttachments, removedTemplateIds]
  );

  // Combine active template attachments with additional ones (memoized to prevent re-renders)
  const allAttachments = useMemo(
    () => [...activeTemplateAttachments, ...additionalAttachments],
    [activeTemplateAttachments, additionalAttachments]
  );

  // Handlers for attachment management
  const handleAddAttachment = useCallback((attachment: TemplateAttachment) => {
    setAdditionalAttachments(prev => [...prev, attachment]);
  }, []);

  const handleRemoveAttachment = useCallback((documentId: string) => {
    // Check if it's a template attachment
    const isTemplateAttachment = templateAttachments.some(a => a.document_id === documentId);
    if (isTemplateAttachment) {
      // Track as removed (don't delete from DB, just hide in this session)
      setRemovedTemplateIds(prev => new Set([...prev, documentId]));
      toast({
        title: 'Attachment Removed',
        description: 'Template attachment hidden from this estimate',
      });
    } else {
      // Remove additional attachment normally
      setAdditionalAttachments(prev => prev.filter(a => a.document_id !== documentId));
    }
  }, [templateAttachments, toast]);

  const handleReorderAttachments = useCallback((reordered: TemplateAttachment[]) => {
    // Split back into template and additional
    const newAdditionalOrder = reordered.filter(a => !a.isFromTemplate);
    setAdditionalAttachments(newAdditionalOrder);
    // Could notify parent of reorder if needed: onAttachmentsChange?.(reordered);
  }, []);

  const handleViewModeChange = (mode: PDFViewMode) => {
    setViewMode(mode);
    setOptions(applyTenantDefaults(getDefaultOptions(mode)));
  };

  const updateOption = (key: keyof PDFComponentOptions, value: boolean) => {
    setOptions(prev => {
      const next: PDFComponentOptions = { ...prev, [key]: value };
      // Smart overrides: certain toggles need to flip conflicting unified-view flags
      // so the change is actually visible in the customer preset.
      if (key === 'showMaterialsSection' || key === 'showLaborSection') {
        if (value) {
          // Turning a section ON → switch out of unified view so the section renders
          next.showUnifiedItems = false;
        } else {
          // If both sections are OFF, fall back to unified view so something renders
          if (!next.showMaterialsSection && !next.showLaborSection) {
            next.showUnifiedItems = true;
          }
        }
      }
      if (key === 'showLineItemPricing' && value) {
        // Unit pricing lives inside materials/labor tables → must use sectioned view
        next.showUnifiedItems = false;
        if (!next.showMaterialsSection && !next.showLaborSection) {
          next.showMaterialsSection = true;
          next.showLaborSection = true;
        }
      }
      if (key === 'showSubtotals' && value) {
        // Subtotals are gated by !hideSectionSubtotals
        next.hideSectionSubtotals = false;
      }
      return next;
    });
  };

  const handleResetToDefaults = () => {
    setOptions(applyTenantDefaults(getDefaultOptions(viewMode)));
    // Also restore removed template attachments
    setRemovedTemplateIds(new Set());
  };

  // Generate safe filename from display name, template name, or estimate number
  const getFilename = useCallback(() => {
    // Priority: user-set display name > template name > estimate number
    const displaySource = estimateDisplayName?.trim() || templateName?.trim();
    
    if (displaySource) {
      // Sanitize: remove special chars, limit length
      const sanitized = displaySource
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '_')
        .slice(0, 50);
      return `${sanitized}.pdf`;
    }
    return `${estimateNumber}.pdf`;
  }, [estimateDisplayName, templateName, estimateNumber]);

  const handleExportPDF = async () => {
    setIsExporting(true);
    const filename = getFilename();
    
    try {
      // Wait for any attachments to finish rendering
      const container = document.getElementById('estimate-preview-template');
      if (!container) throw new Error('Preview template not found');
      
      // Poll for attachment loading completion (max 10 seconds)
      const maxWaitMs = 10000;
      const pollIntervalMs = 200;
      let waited = 0;
      
      while (waited < maxWaitMs) {
        const loadingIndicators = container.querySelectorAll('.animate-spin');
        const pageCount = container.querySelectorAll('[data-report-page]').length;
        
        if (loadingIndicators.length === 0 && pageCount > 0) {
          console.log(`[PreviewExport] Ready after ${waited}ms, ${pageCount} pages found`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }
      
      // Small delay for final render stability (reduced for performance)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Count actual pages
      const pageCount = container.querySelectorAll('[data-report-page]').length;
      console.log(`[PreviewExport] Generating PDF with ${pageCount} pages`);
      
      // Generate multi-page PDF (captures each [data-report-page] separately)
      const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
        filename,
        format: 'letter',
        orientation: 'portrait',
      });

      if (result.success && result.blob) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        toast({
          title: 'PDF Downloaded',
          description: `${filename} has been downloaded (${pageCount} pages)`,
        });
      } else {
        throw new Error(result.error || 'PDF generation failed');
      }
    } catch (error: any) {
      console.error('Error exporting PDF:', error);
      toast({
        title: 'Export Failed',
        description: error.message || 'Failed to generate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // Regenerate PDF with current attachments before sharing
  const handlePrepareAndShare = async () => {
    // If no estimate ID, just open share dialog (can't regenerate)
    if (!estimateId) {
      setShowShareDialog(true);
      return;
    }

    setIsExporting(true);
    try {
      // Wait for any attachments to finish rendering
      const container = document.getElementById('estimate-preview-template');
      if (!container) throw new Error('Preview template not found');
      
      // Poll for attachment loading completion (max 10 seconds)
      const maxWaitMs = 10000;
      const pollIntervalMs = 200;
      let waited = 0;
      
      while (waited < maxWaitMs) {
        const loadingIndicators = container.querySelectorAll('.animate-spin');
        const pageCount = container.querySelectorAll('[data-report-page]').length;
        
        if (loadingIndicators.length === 0 && pageCount > 0) {
          console.log(`[Share] Ready after ${waited}ms, ${pageCount} pages found`);
          break;
        }
        
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }
      
      // Small delay for final render stability
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Count actual pages
      const pageCount = container.querySelectorAll('[data-report-page]').length;
      
      // Find the signature page using the data-signature-page marker
      const allPages = Array.from(container.querySelectorAll('[data-report-page]'));
      const sigPage = container.querySelector('[data-signature-page]');
      let sigPageIdx: number | null = null;
      if (sigPage) {
        sigPageIdx = allPages.indexOf(sigPage as Element);
      }
      setSignaturePageIndex(sigPageIdx);
      console.log(`[Share] Generating PDF with ${pageCount} pages, signature on page ${sigPageIdx} (found via data-signature-page)`);
      
      // Generate multi-page PDF (captures each [data-report-page] separately)
      const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
        filename: `${estimateNumber}.pdf`,
        format: 'letter',
        orientation: 'portrait',
      });

      if (result.success && result.blob && pipelineEntryId && tenantId && userId) {
        const saveResult = await saveEstimatePdf({
          pdfBlob: result.blob,
          pipelineEntryId,
          tenantId,
          estimateNumber,
          description: `Estimate ${estimateDisplayName || estimateNumber}`,
          userId,
          estimateDisplayName: estimateDisplayName || null,
          estimatePricingTier: null,
          estimateId: estimateId || null,
          signatureAnchor: result.signatureAnchor || null,
        });

        if (!saveResult.success) {
          console.error('[Share] PDF upload failed:', saveResult.error);
        } else if (saveResult.filePath) {
          const { error: updateError } = await supabase
            .from('enhanced_estimates')
            .update({ pdf_url: saveResult.filePath })
            .eq('id', estimateId);

          if (updateError) {
            console.error('[Share] PDF URL update failed:', updateError);
          } else {
            console.log('[Share] PDF regenerated with attachments before sharing');
          }
        }
      } else if (result.success && result.blob && pipelineEntryId) {
        console.warn('[Share] Skipped PDF save before sharing because tenant or user context is missing');
      }
    } catch (err) {
      console.error('[Share] PDF regeneration failed:', err);
      // Continue with share anyway - will use existing PDF
    } finally {
      setIsExporting(false);
    }
    
    // Open share dialog
    setShowShareDialog(true);
  };

  // Save PDF to documents for later retrieval
  const handleSaveToDocuments = async () => {
    if (!pipelineEntryId || !tenantId || !userId) {
      toast({
        title: 'Cannot Save',
        description: 'Missing required context. Please save the estimate first.',
        variant: 'destructive',
      });
      return;
    }

    setIsSaving(true);
    try {
      const container = document.getElementById('estimate-preview-template');
      if (!container) throw new Error('Preview template not found');

      const maxWaitMs = 10000;
      const pollIntervalMs = 200;
      let waited = 0;

      while (waited < maxWaitMs) {
        const loadingIndicators = container.querySelectorAll('.animate-spin');
        const pageCount = container.querySelectorAll('[data-report-page]').length;
        if (loadingIndicators.length === 0 && pageCount > 0) break;
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
      }

      await new Promise(resolve => setTimeout(resolve, 100));

      const pageCount = container.querySelectorAll('[data-report-page]').length;
      const filename = getFilename();

      const result = await generateMultiPagePDF('estimate-preview-template', pageCount, {
        filename,
        format: 'letter',
        orientation: 'portrait',
      });

      if (!result.success || !result.blob) {
        throw new Error(result.error || 'PDF generation failed');
      }

      const saveResult = await saveEstimatePdf({
        pdfBlob: result.blob,
        pipelineEntryId,
        tenantId,
        estimateNumber,
        description: `Estimate ${estimateDisplayName || estimateNumber}`,
        userId,
        estimateDisplayName: estimateDisplayName || null,
        estimatePricingTier: null,
        estimateId: estimateId || null,
        signatureAnchor: result.signatureAnchor || null,
      });

      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save PDF');
      }

      if (estimateId && saveResult.filePath) {
        await supabase
          .from('enhanced_estimates')
          .update({ pdf_url: saveResult.filePath })
          .eq('id', estimateId);
      }

      toast({
        title: 'Estimate Saved ✓',
        description: `${filename} saved to documents (${pageCount} pages)`,
      });
    } catch (error: any) {
      console.error('Error saving estimate:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'Failed to save estimate PDF',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
    <input
      ref={photoUploadRef}
      type="file"
      accept="image/*"
      multiple
      className="hidden"
      onChange={handlePhotoFilesSelected}
    />
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[95vw] md:w-full max-h-[95vh] p-0 overflow-hidden [&>button:last-child]:hidden sm:rounded-lg">
        <DialogHeader className="px-6 py-4 border-b relative z-10">
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Preview Estimate
          </DialogTitle>
           <button
            type="button"
            className="absolute right-4 top-4 z-[70] rounded-md border bg-background p-1.5 shadow-sm transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </DialogHeader>

        <div className="flex flex-col md:flex-row h-[calc(95vh-120px)] min-h-0">
          {/* Left Panel - Toggle Controls (full width on mobile, sidebar on desktop) */}
          <div className="w-full md:w-80 md:shrink-0 border-b md:border-b-0 md:border-r flex flex-col bg-muted/30 overflow-hidden min-h-0 flex-1 md:flex-initial">
            {/* Native scroll container */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
              <div className="p-4 pr-5 pb-32 space-y-4">
              {/* View Mode Tabs */}
              <Tabs value={viewMode} onValueChange={(v) => handleViewModeChange(v as PDFViewMode)} className="mb-4">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="customer" className="text-xs">
                    <User className="h-3 w-3 mr-1" />
                    Customer
                  </TabsTrigger>
                  <TabsTrigger value="internal" className="text-xs">
                    <Building2 className="h-3 w-3 mr-1" />
                    Internal
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="customer" className="mt-2">
                  <div className="flex items-center gap-2 p-2 bg-green-500/10 border border-green-500/20 rounded text-xs">
                    <Eye className="h-3 w-3 text-green-600 shrink-0" />
                    <span className="text-green-700 dark:text-green-400">
                      Customer-safe view
                    </span>
                  </div>
                </TabsContent>

                <TabsContent value="internal" className="mt-2">
                  <div className="flex items-center gap-2 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
                    <span className="text-amber-700 dark:text-amber-400">
                      Contains internal data
                    </span>
                  </div>
                </TabsContent>
              </Tabs>

              {/* Toggle Sections */}
              <div className="space-y-4">
                {/* Header Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <Building2 className="h-3 w-3" />
                    Header
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Company Logo"
                      checked={options.showCompanyLogo}
                      onChange={(v) => updateOption('showCompanyLogo', v)}
                    />
                    <ToggleRow
                      label="Company Info"
                      checked={options.showCompanyInfo}
                      onChange={(v) => updateOption('showCompanyInfo', v)}
                    />
                    <ToggleRow
                      label="Page Header"
                      checked={options.showPageHeader}
                      onChange={(v) => updateOption('showPageHeader', v)}
                    />
                    <ToggleRow
                      label="Page Footer"
                      checked={options.showPageFooter}
                      onChange={(v) => updateOption('showPageFooter', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Customer Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <User className="h-3 w-3" />
                    Customer
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Customer Name"
                      checked={options.showCustomerName}
                      onChange={(v) => updateOption('showCustomerName', v)}
                    />
                    <ToggleRow
                      label="Property Address"
                      checked={options.showCustomerAddress}
                      onChange={(v) => updateOption('showCustomerAddress', v)}
                    />
                    <ToggleRow
                      label="Phone/Email"
                      checked={options.showCustomerContact}
                      onChange={(v) => updateOption('showCustomerContact', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Content Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <List className="h-3 w-3" />
                    Content
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Materials Section"
                      checked={options.showMaterialsSection}
                      onChange={(v) => updateOption('showMaterialsSection', v)}
                    />
                    <ToggleRow
                      label="Labor Section"
                      checked={options.showLaborSection}
                      onChange={(v) => updateOption('showLaborSection', v)}
                    />
                    <ToggleRow
                      label="Show Quantities"
                      checked={options.showLineItemQuantities}
                      onChange={(v) => updateOption('showLineItemQuantities', v)}
                    />
                    <ToggleRow
                      label="Unit Pricing"
                      checked={options.showLineItemPricing}
                      onChange={(v) => updateOption('showLineItemPricing', v)}
                    />
                  </div>
                </div>

                <Separator />

                {/* Pricing Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <DollarSign className="h-3 w-3" />
                    Pricing
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Subtotals"
                      checked={options.showSubtotals}
                      onChange={(v) => updateOption('showSubtotals', v)}
                    />
                    <ToggleRow
                      label="Show Only Total"
                      checked={options.showOnlyTotal}
                      onChange={(v) => updateOption('showOnlyTotal', v)}
                    />
                    {viewMode === 'internal' && (
                      <>
                        <ToggleRow
                          label="Cost Breakdown"
                          checked={options.showCostBreakdown}
                          onChange={(v) => updateOption('showCostBreakdown', v)}
                          badge="Internal"
                        />
                        <ToggleRow
                          label="Profit Margin"
                          checked={options.showProfitInfo}
                          onChange={(v) => updateOption('showProfitInfo', v)}
                          badge="Internal"
                        />
                        <ToggleRow
                          label="Rep Commission"
                          checked={options.showRepCommission}
                          onChange={(v) => updateOption('showRepCommission', v)}
                          badge="Internal"
                        />
                      </>
                    )}
                  </div>
                </div>

                {/* Multi-Estimate Selector */}
                {estimatesList.length > 1 && (
                  <>
                    <Separator />
                    <Collapsible open={isEstimatesOpen} onOpenChange={setIsEstimatesOpen}>
                      <CollapsibleTrigger className="flex items-center justify-between w-full py-1 hover:bg-muted/50 rounded -mx-1 px-1">
                        <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                          <Files className="h-3 w-3" />
                          Estimates to Include ({1 + selectedAdditionalIds.size})
                        </h4>
                        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isEstimatesOpen ? '' : '-rotate-90'}`} />
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 space-y-1.5">
                        {estimatesList.map(est => {
                          const isCurrent = est.id === estimateId;
                          const isSelected = isCurrent || selectedAdditionalIds.has(est.id);
                          return (
                            <label
                              key={est.id}
                              className={`flex items-start gap-2 p-2 rounded-md cursor-pointer transition-colors text-sm ${isSelected ? 'bg-primary/10 border border-primary/20' : 'hover:bg-muted/50 border border-transparent'}`}
                            >
                              <Checkbox
                                checked={isSelected}
                                disabled={isCurrent}
                                onCheckedChange={() => {
                                  if (!isCurrent) handleToggleEstimate(est.id);
                                }}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium truncate">
                                  {est.display_name || est.estimate_number}
                                  {isCurrent && (
                                    <Badge variant="outline" className="ml-1 text-[9px] py-0 px-1">Current</Badge>
                                  )}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {est.estimate_number} • ${est.selling_price?.toLocaleString() || '0'}
                                </p>
                              </div>
                            </label>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  </>
                )}

                <Separator />

                {/* Extra Pages Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <FileText className="h-3 w-3" />
                    Extra Pages
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Cover Page"
                      checked={options.showCoverPage}
                      onChange={(v) => updateOption('showCoverPage', v)}
                    />
                    {options.showCoverPage && (
                      <div className="pl-4 pt-1 space-y-2">
                        <Label className="text-xs text-muted-foreground mb-1 block">Cover Photo</Label>
                        <Select
                          value={coverPhotoSource}
                          onValueChange={(v) => {
                            setCoverPhotoSource(v as CoverPhotoSource);
                            if (v === 'uploaded' && jobPhotos.length > 0 && jobPhotos[0].id !== 'aerial') {
                              setSelectedUploadedPhotoId(jobPhotos[0].id);
                            }
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">None</SelectItem>
                            {jobPhotos.some(p => p.id !== 'aerial') && (
                              <SelectItem value="uploaded">Uploaded Photo</SelectItem>
                            )}
                            <SelectItem value="streetview">
                              {streetViewUrl ? 'Street View' : 'Street View (loading…)'}
                            </SelectItem>
                            <SelectItem value="aerial">
                              {aerialUrl ? 'Aerial View' : 'Aerial View (loading…)'}
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        {/* Thumbnail picker for uploaded photos */}
                        {coverPhotoSource === 'uploaded' && jobPhotos.filter(p => p.id !== 'aerial').length > 0 && (
                          <div className="flex gap-1.5 overflow-x-auto pb-1">
                            {jobPhotos.filter(p => p.id !== 'aerial').map(photo => (
                              <button
                                key={photo.id}
                                type="button"
                                onClick={() => setSelectedUploadedPhotoId(photo.id)}
                                className={`shrink-0 w-12 h-12 rounded overflow-hidden border-2 transition-colors ${
                                  selectedUploadedPhotoId === photo.id
                                    ? 'border-primary'
                                    : 'border-transparent hover:border-muted-foreground/30'
                                }`}
                              >
                                <img src={photo.file_url} alt={photo.description || ''} className="w-full h-full object-cover" />
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Preview thumbnail */}
                        {coverPhotoSource !== 'none' && options.coverPagePropertyPhoto && (
                          <div className="rounded overflow-hidden border border-border">
                            <img
                              src={options.coverPagePropertyPhoto}
                              alt="Cover photo preview"
                              className="w-full h-20 object-cover"
                            />
                          </div>
                        )}
                      </div>
                    )}
                    <ToggleRow
                      label="Measurement Details"
                      checked={options.showMeasurementDetails}
                      onChange={(v) => updateOption('showMeasurementDetails', v)}
                      disabled={!measurementSummary}
                    />
                    <ToggleRow
                      label="Job Photos"
                      checked={options.showJobPhotos}
                      onChange={(v) => updateOption('showJobPhotos', v)}
                      badge={jobPhotos.length > 0 ? `${jobPhotos.length}` : undefined}
                      disabled={jobPhotos.length === 0}
                    />
                    {options.showJobPhotos && jobPhotos.length > 0 && (
                      <div className="pl-4 pt-1">
                        <Label className="text-xs text-muted-foreground mb-1 block">Photo Layout</Label>
                        <Select
                          value={options.photoLayout || 'auto'}
                          onValueChange={(v) => setOptions(prev => ({ ...prev, photoLayout: v as any }))}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto</SelectItem>
                            <SelectItem value="1col">1 Column (Large)</SelectItem>
                            <SelectItem value="2col">2×2 Grid</SelectItem>
                            <SelectItem value="3col">3×3 Grid</SelectItem>
                            <SelectItem value="4col">4×4 Grid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <ToggleRow
                      label="Manufacturer Warranty"
                      checked={options.showManufacturerWarranty}
                      onChange={(v) => updateOption('showManufacturerWarranty', v)}
                    />
                    <ToggleRow
                      label="Workmanship Warranty"
                      checked={options.showWorkmanshipWarranty}
                      onChange={(v) => updateOption('showWorkmanshipWarranty', v)}
                    />
                  </div>
                </div>

                {/* Attachments Manager Section */}
                <Separator />
                <Collapsible open={isAttachmentsOpen} onOpenChange={setIsAttachmentsOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-1 hover:bg-muted/50 rounded -mx-1 px-1">
                    <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      <Paperclip className="h-3 w-3" />
                      Attachments ({allAttachments.length})
                    </h4>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isAttachmentsOpen ? '' : '-rotate-90'}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <EstimateAttachmentsManager
                      templateAttachments={activeTemplateAttachments}
                      additionalAttachments={additionalAttachments}
                      onAddAttachment={handleAddAttachment}
                      onRemoveAttachment={handleRemoveAttachment}
                      onReorderAttachments={handleReorderAttachments}
                    />
                  </CollapsibleContent>
                </Collapsible>

                {/* Page Order Manager Section */}
                <Separator />
                <Collapsible open={isPageOrderOpen} onOpenChange={setIsPageOrderOpen}>
                  <CollapsibleTrigger className="flex items-center justify-between w-full py-1 hover:bg-muted/50 rounded -mx-1 px-1">
                    <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                      <Layers className="h-3 w-3" />
                      Page Order
                    </h4>
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${isPageOrderOpen ? '' : '-rotate-90'}`} />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <PageOrderManager
                      pageOrder={pageOrder}
                      onPageOrderChange={setPageOrder}
                      hasAttachments={allAttachments.length > 0}
                      hasMeasurements={!!measurementSummary}
                      hasPhotos={jobPhotos.length > 0}
                      onUploadPhotos={handleUploadPhotos}
                    />
                  </CollapsibleContent>
                </Collapsible>

                <Separator />

                {/* Terms Section */}
                <div className="space-y-2">
                  <h4 className="font-medium flex items-center gap-2 text-xs text-muted-foreground uppercase tracking-wide">
                    <FileSignature className="h-3 w-3" />
                    Terms
                  </h4>
                  <div className="space-y-2 pl-2">
                    <ToggleRow
                      label="Terms & Conditions"
                      checked={options.showTermsAndConditions}
                      onChange={(v) => updateOption('showTermsAndConditions', v)}
                    />
                    <ToggleRow
                      label="Custom Fine Print"
                      checked={options.showCustomFinePrint}
                      onChange={(v) => updateOption('showCustomFinePrint', v)}
                      disabled={!finePrintContent}
                    />
                    <ToggleRow
                      label="Signature Block"
                      checked={options.showSignatureBlock}
                      onChange={(v) => updateOption('showSignatureBlock', v)}
                    />
                  </div>
                </div>
              </div>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="sticky bottom-0 z-20 shrink-0 border-t bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 p-3 md:p-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-[calc(1rem+env(safe-area-inset-bottom))] space-y-2 relative pointer-events-auto">
              {/* Row 1: Reset + Save */}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetToDefaults}
                  className="flex-1"
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset Defaults
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveToDocuments}
                  disabled={isSaving || isExporting || isGeneratingPDF || !pipelineEntryId || !tenantId || !userId}
                  className="flex-1"
                  title={!pipelineEntryId ? 'Save the estimate first' : 'Save to documents'}
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" />
                      Save
                    </>
                  )}
                </Button>
              </div>
              {/* Row 2: Share + Export */}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handlePrepareAndShare}
                  disabled={isSaving || isExporting || isGeneratingPDF || !(estimateId || pipelineEntryId)}
                  className="flex-1"
                  title={!(estimateId || pipelineEntryId) ? 'Save the estimate first to share' : 'Share via email'}
                >
                  {isExporting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Preparing...
                    </>
                  ) : (
                    <>
                      <Share2 className="h-4 w-4 mr-2" />
                      Share
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleExportPDF}
                  disabled={isSaving || isExporting || isGeneratingPDF}
                  className="flex-1"
                >
                  {isExporting || isGeneratingPDF ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Export PDF
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Live Preview */}
          <div className="hidden md:block flex-1 bg-muted/50 overflow-auto p-6">
            <div className="flex justify-center">
              <div
                ref={previewRef}
                className=""
                style={{ transform: 'scale(0.75)', transformOrigin: 'top center' }}
              >
                <div id="estimate-preview-template" className="pdf-render-container" style={{
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
                  WebkitFontSmoothing: 'antialiased',
                  MozOsxFontSmoothing: 'grayscale',
                  textRendering: 'optimizeLegibility',
                  letterSpacing: '0.01em',
                }}>
                  <EstimatePDFDocument
                    estimateNumber={estimateNumber}
                    estimateName={estimateDisplayName}
                    customerName={customerName}
                    customerAddress={customerAddress}
                    customerPhone={customerPhone}
                    customerEmail={customerEmail}
                    companyInfo={companyInfo || undefined}
                    companyName={companyInfo?.name || 'Company'}
                    companyLogo={companyInfo?.logo_url || undefined}
                    materialItems={materialItems}
                    laborItems={laborItems}
                    breakdown={breakdown}
                    config={config}
                    finePrintContent={options.showCustomFinePrint ? finePrintContent : undefined}
                    warrantyTerms={warrantyTerms}
                    options={options}
                    measurementSummary={measurementSummary || undefined}
                    createdAt={new Date().toISOString()}
                    templateAttachments={[]}
                    jobPhotos={jobPhotos}
                    skipWarrantyAndTerms={selectedAdditionalIds.size > 0}
                    templateStyle={templateStyle}
                  />
                  
                  {/* Additional selected estimates */}
                  {(() => {
                    const additionalIds = Array.from(selectedAdditionalIds);
                    return additionalIds.map((estId, idx) => {
                      const data = fetchedEstimates.get(estId);
                      if (!data) return (
                        <div key={estId} className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          <span className="ml-2 text-sm text-muted-foreground">Loading estimate...</span>
                        </div>
                      );
                      const isLast = idx === additionalIds.length - 1;
                      return (
                        <EstimatePDFDocument
                          key={estId}
                          estimateNumber={data.estimateNumber}
                          estimateName={data.estimateName}
                          customerName={customerName}
                          customerAddress={customerAddress}
                          customerPhone={customerPhone}
                          customerEmail={customerEmail}
                          companyInfo={companyInfo || undefined}
                          companyName={companyInfo?.name || 'Company'}
                          companyLogo={companyInfo?.logo_url || undefined}
                          materialItems={data.materialItems}
                          laborItems={data.laborItems}
                          breakdown={data.breakdown}
                          config={data.config}
                          warrantyTerms={warrantyTerms}
                          options={options}
                          measurementSummary={measurementSummary || undefined}
                          createdAt={new Date().toISOString()}
                          jobPhotos={jobPhotos}
                          skipCoverPage={true}
                          skipWarrantyAndTerms={!isLast}
                        />
                      );
                    });
                  })()}
                  
                  {/* Render attachments at the very end, after all estimates */}
                  {allAttachments.length > 0 && (
                    <AttachmentPagesRenderer attachments={allAttachments} />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>

    </Dialog>

    {/* Share Estimate Dialog - rendered outside Dialog root to prevent Radix context conflicts */}
    <ShareEstimateDialog
      open={showShareDialog}
      onOpenChange={setShowShareDialog}
      estimateId={estimateId}
      pipelineEntryId={pipelineEntryId}
      contactId={contactId}
      customerEmail={customerEmail || ''}
      customerName={customerName}
      estimateNumber={estimateNumber}
      estimateDisplayName={estimateDisplayName}
      signaturePageIndex={signaturePageIndex}
    />
    </>
  );
}

// Toggle Row Component - uses CSS grid for bulletproof layout
function ToggleRow({
  label,
  checked,
  onChange,
  badge,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  badge?: string;
  disabled?: boolean;
}) {
  // Generate stable id from label for accessibility
  const switchId = `toggle-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 w-full ${disabled ? 'opacity-50' : ''}`}>
      <Label 
        htmlFor={switchId}
        className="text-sm flex items-center gap-1.5 cursor-pointer min-w-0"
      >
        <span className="truncate">{label}</span>
        {badge && (
          <Badge variant="outline" className="text-[10px] py-0 px-1 shrink-0">
            {badge}
          </Badge>
        )}
      </Label>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
        className="shrink-0"
      />
    </div>
  );
}

export default EstimatePreviewPanel;
