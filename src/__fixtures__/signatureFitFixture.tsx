import React from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { EstimatePDFDocument } from '@/components/estimates/EstimatePDFDocument';

const mode = new URLSearchParams(location.search).get('mode') || 'items';
const rows = Number(new URLSearchParams(location.search).get('rows') || '30');
const items = Array.from({ length: rows }, (_, i) => ({
  id: `i${i}`, item_name: `Standing seam panel section ${i + 1}`, qty: 10, unit: 'SQ', unit_cost: 100, line_total: 1000,
  item_type: 'material', trade_type: 'roofing', sort_order: i,
})) as any[];
const fine = Array.from({ length: 28 }, (_, i) => `Clause ${i + 1}: The contractor warrants workmanship for the stated period; customer agrees to provide site access, and any hidden damage discovered during tear-off will be documented with photos and priced separately before work continues.`).join(' ');
const narrative = Array.from({ length: 14 }, (_, i) => `**Step ${i + 1}.** We will remove the existing roofing down to the deck, inspect and replace damaged decking, install ice and water shield in valleys and eaves, and install the new standing seam panels with matching trim.`).join('\n\n');

createRoot(document.getElementById('root')!).render(
  <div style={{ background: '#ccc', padding: 20 }} id="estimate-pdf-pages">
    <EstimatePDFDocument
      estimateNumber="OBR-TEST" customerName="Test Customer" customerAddress="1 Main St"
      materialItems={mode === 'items' ? items : []} laborItems={[]}
      breakdown={{ sellingPrice: 30000, directCost: 20000 } as any} config={{} as any}
      finePrintContent={fine}
      options={{ showCustomFinePrint: true, showTermsAndConditions: true, showSignatureBlock: true, showUnifiedItems: true,
        useScopeNarrative: mode === 'narrative', scopeNarrative: mode === 'narrative' ? narrative : undefined, showCoverPage: false } as any}
      skipCoverPage
    />
  </div>
);
