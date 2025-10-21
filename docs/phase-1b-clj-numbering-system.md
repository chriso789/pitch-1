# Phase 1B: C-L-J Numbering System - Implementation Plan

## 🎯 Objective
Implement a unified Contact-Lead-Job (C-L-J) numbering system that provides clear traceability across the entire customer lifecycle. Format: `C-L-J` where:
- **C** = Contact sequence number
- **L** = Lead sequence number (per contact)
- **J** = Job/Project sequence number (per lead)

### Examples:
- `1-0-0` = Contact #1, no leads yet
- `1-2-0` = Contact #1, Lead #2, no job yet
- `1-2-3` = Contact #1, Lead #2, Job #3

---

## 📋 Current State Analysis

### ✅ Existing Infrastructure
- `contacts` table with basic fields
- `pipeline_entries` table (represents "leads")
- `projects` table (represents "jobs")
- Individual auto-increment IDs exist but not linked

### ❌ Missing Components
- C-L-J formatted number columns
- Sequence management for each entity
- Automatic number generation triggers
- Display components showing C-L-J format
- Search functionality by C-L-J number
- Validation to ensure uniqueness and consistency

---

## 🗄️ Database Implementation

### 1. Add C-L-J Columns to Existing Tables

```sql
-- Add C-L-J columns to contacts table
ALTER TABLE public.contacts
  ADD COLUMN contact_number INTEGER,
  ADD COLUMN clj_formatted_number TEXT;

-- Add C-L-J columns to pipeline_entries table (leads)
ALTER TABLE public.pipeline_entries
  ADD COLUMN contact_number INTEGER,
  ADD COLUMN lead_number INTEGER,
  ADD COLUMN clj_formatted_number TEXT;

-- Add C-L-J columns to projects table (jobs)
ALTER TABLE public.projects
  ADD COLUMN contact_number INTEGER,
  ADD COLUMN lead_number INTEGER,
  ADD COLUMN job_number INTEGER,
  ADD COLUMN clj_formatted_number TEXT;

-- Create indexes for fast lookups
CREATE INDEX idx_contacts_contact_number ON public.contacts(tenant_id, contact_number);
CREATE INDEX idx_contacts_clj_formatted ON public.contacts(tenant_id, clj_formatted_number);
CREATE INDEX idx_pipeline_entries_clj_formatted ON public.pipeline_entries(tenant_id, clj_formatted_number);
CREATE INDEX idx_projects_clj_formatted ON public.projects(tenant_id, clj_formatted_number);
```

### 2. Create Sequence Management Functions

```sql
-- Function to get next contact number for tenant
CREATE OR REPLACE FUNCTION public.get_next_contact_number(tenant_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(contact_number), 0) + 1 INTO next_number
  FROM public.contacts
  WHERE tenant_id = tenant_id_param;
  
  RETURN next_number;
END;
$$;

-- Function to get next lead number for a contact
CREATE OR REPLACE FUNCTION public.get_next_lead_number(contact_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
BEGIN
  SELECT COALESCE(MAX(lead_number), 0) + 1 INTO next_number
  FROM public.pipeline_entries
  WHERE contact_id = contact_id_param;
  
  RETURN next_number;
END;
$$;

-- Function to get next job number for a pipeline entry (lead)
CREATE OR REPLACE FUNCTION public.get_next_job_number(pipeline_entry_id_param UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_number INTEGER;
  contact_id_val UUID;
  lead_num INTEGER;
BEGIN
  -- Get contact_id and lead_number from pipeline_entry
  SELECT contact_id, lead_number INTO contact_id_val, lead_num
  FROM public.pipeline_entries
  WHERE id = pipeline_entry_id_param;
  
  -- Get next job number for this lead
  SELECT COALESCE(MAX(job_number), 0) + 1 INTO next_number
  FROM public.projects
  WHERE pipeline_entry_id = pipeline_entry_id_param;
  
  RETURN next_number;
END;
$$;

-- Function to format C-L-J number
CREATE OR REPLACE FUNCTION public.format_clj_number(
  contact_num INTEGER,
  lead_num INTEGER DEFAULT 0,
  job_num INTEGER DEFAULT 0
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN format('%s-%s-%s', contact_num, lead_num, job_num);
END;
$$;
```

### 3. Create Triggers for Automatic Number Assignment

```sql
-- Trigger function for contacts
CREATE OR REPLACE FUNCTION public.assign_contact_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only assign if not already set
  IF NEW.contact_number IS NULL THEN
    NEW.contact_number := public.get_next_contact_number(NEW.tenant_id);
  END IF;
  
  -- Format C-L-J as C-0-0 (no leads/jobs yet)
  NEW.clj_formatted_number := public.format_clj_number(NEW.contact_number, 0, 0);
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_contact_number
  BEFORE INSERT ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_contact_number();

-- Trigger function for pipeline_entries (leads)
CREATE OR REPLACE FUNCTION public.assign_lead_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  contact_num INTEGER;
BEGIN
  -- Get contact number
  SELECT contact_number INTO contact_num
  FROM public.contacts
  WHERE id = NEW.contact_id;
  
  -- Assign lead number if not set
  IF NEW.lead_number IS NULL THEN
    NEW.lead_number := public.get_next_lead_number(NEW.contact_id);
  END IF;
  
  -- Store contact number for denormalization
  NEW.contact_number := contact_num;
  
  -- Format C-L-J as C-L-0 (no job yet)
  NEW.clj_formatted_number := public.format_clj_number(contact_num, NEW.lead_number, 0);
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_lead_number
  BEFORE INSERT ON public.pipeline_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_lead_number();

-- Trigger function for projects (jobs)
CREATE OR REPLACE FUNCTION public.assign_job_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  contact_num INTEGER;
  lead_num INTEGER;
BEGIN
  -- Get contact and lead numbers from pipeline_entry
  SELECT 
    pe.contact_number,
    pe.lead_number
  INTO contact_num, lead_num
  FROM public.pipeline_entries pe
  WHERE pe.id = NEW.pipeline_entry_id;
  
  -- Assign job number if not set
  IF NEW.job_number IS NULL THEN
    NEW.job_number := public.get_next_job_number(NEW.pipeline_entry_id);
  END IF;
  
  -- Store denormalized values
  NEW.contact_number := contact_num;
  NEW.lead_number := lead_num;
  
  -- Format full C-L-J
  NEW.clj_formatted_number := public.format_clj_number(contact_num, lead_num, NEW.job_number);
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_assign_job_number
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_job_number();
```

### 4. Create Search Function

```sql
-- Function to search by C-L-J number
CREATE OR REPLACE FUNCTION public.search_by_clj_number(
  tenant_id_param UUID,
  clj_search TEXT
)
RETURNS TABLE (
  entity_type TEXT,
  entity_id UUID,
  clj_number TEXT,
  entity_name TEXT,
  entity_status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Search contacts
  RETURN QUERY
  SELECT 
    'contact'::TEXT,
    c.id,
    c.clj_formatted_number,
    (c.first_name || ' ' || c.last_name)::TEXT,
    c.status,
    c.created_at
  FROM public.contacts c
  WHERE c.tenant_id = tenant_id_param
    AND c.clj_formatted_number ILIKE '%' || clj_search || '%';
  
  -- Search pipeline entries (leads)
  RETURN QUERY
  SELECT 
    'lead'::TEXT,
    pe.id,
    pe.clj_formatted_number,
    (c.first_name || ' ' || c.last_name || ' - ' || pe.stage)::TEXT,
    pe.status,
    pe.created_at
  FROM public.pipeline_entries pe
  JOIN public.contacts c ON c.id = pe.contact_id
  WHERE pe.tenant_id = tenant_id_param
    AND pe.clj_formatted_number ILIKE '%' || clj_search || '%';
  
  -- Search projects (jobs)
  RETURN QUERY
  SELECT 
    'job'::TEXT,
    p.id,
    p.clj_formatted_number,
    p.name::TEXT,
    p.status,
    p.created_at
  FROM public.projects p
  WHERE p.tenant_id = tenant_id_param
    AND p.clj_formatted_number ILIKE '%' || clj_search || '%';
END;
$$;
```

### 5. Backfill Existing Records

```sql
-- Migration script to backfill C-L-J numbers for existing data
DO $$
DECLARE
  tenant_rec RECORD;
  contact_rec RECORD;
  lead_rec RECORD;
  project_rec RECORD;
  contact_counter INTEGER;
  lead_counter INTEGER;
  job_counter INTEGER;
BEGIN
  -- Loop through each tenant
  FOR tenant_rec IN SELECT DISTINCT tenant_id FROM public.contacts LOOP
    
    contact_counter := 1;
    
    -- Assign contact numbers
    FOR contact_rec IN 
      SELECT id FROM public.contacts 
      WHERE tenant_id = tenant_rec.tenant_id 
      ORDER BY created_at, id
    LOOP
      UPDATE public.contacts
      SET 
        contact_number = contact_counter,
        clj_formatted_number = format_clj_number(contact_counter, 0, 0)
      WHERE id = contact_rec.id;
      
      -- Assign lead numbers for this contact
      lead_counter := 1;
      FOR lead_rec IN 
        SELECT id FROM public.pipeline_entries 
        WHERE contact_id = contact_rec.id 
        ORDER BY created_at, id
      LOOP
        UPDATE public.pipeline_entries
        SET 
          contact_number = contact_counter,
          lead_number = lead_counter,
          clj_formatted_number = format_clj_number(contact_counter, lead_counter, 0)
        WHERE id = lead_rec.id;
        
        -- Assign job numbers for this lead
        job_counter := 1;
        FOR project_rec IN 
          SELECT id FROM public.projects 
          WHERE pipeline_entry_id = lead_rec.id 
          ORDER BY created_at, id
        LOOP
          UPDATE public.projects
          SET 
            contact_number = contact_counter,
            lead_number = lead_counter,
            job_number = job_counter,
            clj_formatted_number = format_clj_number(contact_counter, lead_counter, job_counter)
          WHERE id = project_rec.id;
          
          job_counter := job_counter + 1;
        END LOOP;
        
        lead_counter := lead_counter + 1;
      END LOOP;
      
      contact_counter := contact_counter + 1;
    END LOOP;
    
  END LOOP;
  
  RAISE NOTICE 'C-L-J backfill completed successfully';
END $$;
```

---

## 🎨 UI Components

### 1. Create `CLJBadge.tsx` Component

```typescript
// src/components/CLJBadge.tsx
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CLJBadgeProps {
  cljNumber: string;
  variant?: 'default' | 'outline' | 'secondary';
  className?: string;
  showLabel?: boolean;
}

export const CLJBadge = ({ 
  cljNumber, 
  variant = 'secondary',
  className,
  showLabel = false
}: CLJBadgeProps) => {
  return (
    <Badge variant={variant} className={cn('font-mono', className)}>
      {showLabel && 'C-L-J: '}
      {cljNumber}
    </Badge>
  );
};
```

### 2. Create `CLJSearchBar.tsx` Component

```typescript
// src/components/CLJSearchBar.tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDebounce } from '@/hooks/use-debounce';

interface CLJSearchBarProps {
  onResultSelected?: (result: any) => void;
}

export const CLJSearchBar = ({ onResultSelected }: CLJSearchBarProps) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const debouncedSearch = useDebounce(searchTerm, 300);

  // Search logic using the RPC function
  // Implementation details...
  
  return (
    <div className="relative">
      <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
      <Input
        placeholder="Search by C-L-J number (e.g., 1-2-3)"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="pl-9 font-mono"
      />
      {/* Results dropdown */}
    </div>
  );
};
```

### 3. Update Existing Components

**Update `src/components/ContactCard.tsx`:**
- Add CLJBadge display
- Show C-L-J number prominently

**Update `src/components/PipelineCard.tsx`:**
- Display lead's C-L-J number
- Link to parent contact

**Update `src/components/ProjectCard.tsx`:**
- Display full C-L-J number
- Show traceability back to contact and lead

**Update `src/components/ManagerApprovalDialog.tsx`:**
- Display C-L-J number in approval requests (already has placeholder)

---

## 🔍 Search & Navigation Features

### 1. Global Search Integration

```typescript
// Add to existing search functionality
const searchByCLJ = async (query: string) => {
  const { data, error } = await supabase.rpc('search_by_clj_number', {
    tenant_id_param: currentTenantId,
    clj_search: query
  });
  
  return data;
};
```

### 2. Quick Navigation Component

```typescript
// src/components/CLJQuickNav.tsx
// Allows jumping directly to any entity by C-L-J number
// Navigate to /contact/{id}, /pipeline/{id}, or /project/{id}
```

---

## 📊 Reporting & Analytics

### 1. C-L-J Based Reports

```typescript
// Queries to add:
// - Contacts with multiple leads
// - Leads converted to multiple jobs
// - Average time from C to L to J
// - Conversion rates at each stage
```

### 2. Dashboard Metrics

- Total Contacts (C-x-0-0)
- Active Leads (C-x-L-x-0)
- Jobs in Progress (C-x-L-x-J-x)
- Conversion funnel visualization

---

## 🧪 Testing Plan

### Unit Tests

```typescript
// tests/clj-numbering.test.ts
describe('C-L-J Numbering System', () => {
  test('Contact gets sequential number on creation', async () => {
    // Test contact numbering
  });
  
  test('Lead inherits contact number and gets sequential lead number', async () => {
    // Test lead numbering
  });
  
  test('Job inherits C-L and gets sequential job number', async () => {
    // Test job numbering
  });
  
  test('C-L-J numbers are unique within tenant', async () => {
    // Test uniqueness
  });
  
  test('Search by C-L-J returns correct results', async () => {
    // Test search functionality
  });
});
```

### Integration Tests

1. Create contact → verify C-0-0
2. Create lead for contact → verify C-1-0
3. Create another lead → verify C-2-0
4. Convert first lead to job → verify C-1-1
5. Search for "C-1" → returns lead and job
6. Verify uniqueness across tenants

---

## 🔄 User Workflows

### Creating a New Contact
```
1. User creates contact "John Smith"
2. System assigns contact_number = 1
3. Display: "C-L-J: 1-0-0"
4. User sees badge on contact card
```

### Creating a Lead
```
1. User creates lead for contact #1
2. System assigns lead_number = 1 (first lead for this contact)
3. Display: "C-L-J: 1-1-0"
4. User sees full traceability
```

### Converting to Job
```
1. Manager approves lead 1-1-0
2. System creates project with job_number = 1
3. Display: "C-L-J: 1-1-1"
4. Full lifecycle visible
```

### Searching
```
1. User types "1-1" in search
2. System returns:
   - Lead: 1-1-0
   - Job: 1-1-1 (if exists)
3. User clicks result to navigate
```

---

## 📈 Business Value

### Benefits

1. **Clear Traceability**: Instantly see relationship between contact, leads, jobs
2. **Easy Communication**: "Hey, what's the status of 1-2-3?" - everyone knows what you mean
3. **Quick Lookup**: Search by memorable numbers instead of UUIDs
4. **Audit Trail**: Historical tracking built into the number
5. **Customer Service**: Easily reference customer history

### Example Scenarios

**Scenario 1: Multiple Leads**
- Contact #5 requests 3 different estimates
- Leads: 5-1-0, 5-2-0, 5-3-0
- Lead #2 converts to job: 5-2-1
- Easy to track which estimate became the job

**Scenario 2: Repeat Customer**
- Contact #10 had job 10-1-1 last year
- New lead this year: 10-2-0
- Converts to: 10-2-1
- Clear history of both jobs

**Scenario 3: Customer Service**
- Customer calls: "I have question about my project"
- Rep searches contact name, sees: 3-4-2
- Instantly knows: 4th lead, 2nd job for this customer
- Full context immediately available

---

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] Test all database functions in development
- [ ] Run backfill script on staging data
- [ ] Verify triggers fire correctly
- [ ] Test search functionality
- [ ] Create UI components

### Deployment
- [ ] Execute SQL migrations in order:
  1. Add columns
  2. Create functions
  3. Create triggers
  4. Run backfill
  5. Create indexes
- [ ] Deploy updated UI components
- [ ] Verify no duplicate numbers generated

### Post-Deployment
- [ ] Spot check C-L-J numbers on existing records
- [ ] Create new test contact and verify numbering
- [ ] Test search across all entity types
- [ ] Monitor for any numbering conflicts
- [ ] Update user documentation

---

## ⏱️ Estimated Implementation Time

- **Database Schema**: 3 hours
- **Functions & Triggers**: 4 hours
- **Backfill Script**: 2 hours
- **UI Components**: 5 hours
- **Search Integration**: 3 hours
- **Testing**: 4 hours
- **Documentation**: 2 hours

**Total**: ~23 hours (3 working days)

---

## 🔐 Security Considerations

### RLS Policies
- Ensure C-L-J searches respect tenant boundaries
- Prevent cross-tenant number collisions
- Validate user permissions before showing results

### Data Integrity
- Use transactions for number assignment
- Handle concurrent inserts gracefully
- Implement retry logic for conflicts

---

## 📝 Future Enhancements

### Phase 2 Improvements
1. **C-L-J Analytics Dashboard**: Visual funnel showing C→L→J conversions
2. **QR Codes**: Generate QR codes with C-L-J for job site identification
3. **Voice Search**: "Alexa, find job one dash two dash one"
4. **Email Integration**: Auto-detect C-L-J in emails and link to records
5. **Mobile App**: Scan C-L-J from business cards or documents

---

## 📚 Documentation Required

### User Guide Sections
1. **Understanding C-L-J Numbers**: What they mean
2. **Searching by C-L-J**: How to use quick search
3. **Reading the Numbers**: Interpreting what you see
4. **Common Patterns**: Examples of typical sequences

### Developer Documentation
1. **Database Schema**: Entity relationships
2. **Trigger Logic**: How numbers are assigned
3. **API Endpoints**: How to query by C-L-J
4. **Testing Guide**: How to validate numbering

---

## ✅ Success Metrics

1. ✅ All new contacts receive sequential C numbers
2. ✅ All leads receive correct C-L format
3. ✅ All jobs receive full C-L-J format
4. ✅ No duplicate numbers within tenant
5. ✅ Search returns results in < 100ms
6. ✅ Users can navigate using C-L-J in < 3 clicks
7. ✅ 100% of existing records backfilled correctly

---

## 🔄 Rollback Plan

If issues occur:

1. **Disable Triggers**: Stop automatic assignment
2. **Revert UI Changes**: Remove C-L-J displays
3. **Keep Data**: C-L-J columns remain but aren't used
4. **Analyze Issues**: Fix problems before re-enabling
5. **Re-enable**: Turn triggers back on when ready

Numbers already assigned are preserved to avoid confusion.

---

*This C-L-J numbering system provides the foundation for clear communication and traceability throughout the entire customer lifecycle.*
