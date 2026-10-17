import { useState } from 'react';
import { PhotoAnnotationEditor } from './PhotoAnnotationEditor';
import { parseAnnotationSet } from '@/lib/photo-intelligence/annotations';
import type { ReportSiteOverview } from '@/lib/photo-intelligence/reportModel';
import { evidencePhotoUrl } from '@/lib/photo-intelligence/findings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function SiteOverviewEditor({ paths, value, onChange }: { paths: string[]; value: ReportSiteOverview | null; onChange: (value: ReportSiteOverview | null) => void }) {
  const [path, setPath] = useState(value?.storagePath ?? '');
  const [attribution, setAttribution] = useState(value?.attribution ?? '');
  return <section className="space-y-3 border-t pt-4">
    <h2 className="font-semibold">Aerial property overview</h2>
    <div className="flex flex-wrap gap-3">
      <Select value={path} onValueChange={setPath}><SelectTrigger className="w-72" aria-label="Aerial photograph"><SelectValue placeholder="Choose aerial evidence" /></SelectTrigger><SelectContent>{paths.map((p, i) => <SelectItem key={p} value={p}>Evidence photograph {i + 1}</SelectItem>)}</SelectContent></Select>
      <Input className="w-72" aria-label="Aerial image attribution" placeholder="Source attribution" value={attribution} onChange={(e) => setAttribution(e.target.value)} />
      {value && <Button variant="outline" onClick={() => { setPath(''); onChange(null); }}>Remove overview</Button>}
    </div>
    {path && <PhotoAnnotationEditor key={path} imageUrl={evidencePhotoUrl(path)} initialAnnotations={{ version: 1, annotations: value?.storagePath === path ? value.markers.map((m, i) => ({ id: `site-${i}`, kind: 'callout', at: { x: m.x, y: m.y }, label: i + 1, color: '#ef4444', buildingLabel: m.buildingLabel })) : [] }} onSave={async (json) => {
      const marks = parseAnnotationSet(json).filter((a) => a.kind === 'callout');
      if (!attribution.trim() || !marks.length || marks.some((m) => !m.buildingLabel?.trim())) { toast.error('Record attribution and a building ID for each numbered location.'); return; }
      onChange({ storagePath: path, attribution: attribution.trim(), markers: marks.map((m) => ({ buildingLabel: m.buildingLabel?.trim() ?? '', x: m.at.x, y: m.at.y })) });
      toast.success('Overview added to the report draft.');
    }} />}
  </section>;
}