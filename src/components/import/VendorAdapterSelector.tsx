import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

interface Props { value: string; onChange: (v: string) => void; }

export function VendorAdapterSelector({ value, onChange }: Props) {
  const [adapters, setAdapters] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("vendor_import_adapters" as any).select("source_system, display_name").eq("is_active", true)
      .then(({ data }) => setAdapters(data ?? []));
  }, []);
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Choose vendor adapter" /></SelectTrigger>
      <SelectContent>
        {adapters.map((a) => <SelectItem key={a.source_system} value={a.source_system}>{a.display_name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
