import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { isSidingType } from '@/lib/templates/materialTypeLabels';

export interface SectionOption {
  value: string;
  label: string;
}

// Stable, always-available section vocabulary used across estimate templates.
const BUILTIN_SECTIONS: SectionOption[] = [
  { value: 'roofing', label: 'Roofing' },
  { value: 'siding', label: 'Siding' },
  { value: 'gutter', label: 'Gutters' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'interior', label: 'Interior' },
  { value: 'labor', label: 'Labor' },
];

const LABEL_OVERRIDES: Record<string, string> = {
  roof: 'Roofing',
  roofing: 'Roofing',
  siding: 'Siding',
  gutter: 'Gutters',
  gutters: 'Gutters',
  exterior: 'Exterior',
  interior: 'Interior',
  labor: 'Labor',
};

function prettify(value: string): string {
  if (LABEL_OVERRIDES[value]) return LABEL_OVERRIDES[value];
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Returns the section vocabulary for the active tenant, combining the built-in
 * trade list with any distinct trades inferred from the company's existing
 * calc templates. Adding a new trade-flavored template automatically surfaces
 * it as a section option for item assignment.
 */
export function useCompanyTemplateSections() {
  const tenantId = useEffectiveTenantId();
  const [sections, setSections] = useState<SectionOption[]>(BUILTIN_SECTIONS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    setLoading(true);

    (async () => {
      const { data, error } = await supabase
        .from('estimate_calculation_templates')
        .select('roof_type, name')
        .eq('tenant_id', tenantId);

      if (cancelled) return;

      if (error || !data) {
        setSections(BUILTIN_SECTIONS);
        setLoading(false);
        return;
      }

      // Derive trade from each template (roofing vs siding) and add any unknown raw values.
      const derived = new Set<string>();
      for (const row of data) {
        const rt = (row.roof_type || '').toString();
        const name = (row.name || '').toString().toLowerCase();
        if (isSidingType(rt) || /siding|vinyl|hardie|stucco/.test(name)) {
          derived.add('siding');
        } else if (rt) {
          derived.add('roofing');
        }
      }

      const merged: SectionOption[] = [...BUILTIN_SECTIONS];
      const seen = new Set(merged.map((s) => s.value));
      derived.forEach((value) => {
        if (!seen.has(value)) {
          merged.push({ value, label: prettify(value) });
          seen.add(value);
        }
      });

      setSections(merged);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  return { sections, loading };
}

export { BUILTIN_SECTIONS };
