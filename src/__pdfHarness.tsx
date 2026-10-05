import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { EstimatePDFDocument } from '@/components/estimates/EstimatePDFDocument';
const narrative = `**Scope of Work**
- Replace designated roof decking with OSB sheathing to provide a sound base for the new roofing system.
- Install Tribuilt Ice & Water protection at eaves and valleys to help resist water intrusion.
- Cover the roof deck with Tribuilt Synthetic Underlayment for an additional layer of weather protection.
- Install drip edge along roof perimeters to direct runoff away from exposed decking edges.
- Fit new pipe boots and seal penetration details to help prevent leaks.
- Install Tribuilt starter shingles along roof edges to support proper shingle attachment.
- Secure Tamko Titan XT laminated shingles according to manufacturer specifications for dependable roof protection and warranty eligibility.
- Install ridge ventilation to support attic airflow.
- Finish hips and ridges with Tamko JP Hip & Ridge Cap shingles for a coordinated, weather-resistant finish.
- Leave the jobsite broom-clean and complete a final inspection of the installed roofing system.

**Closing**
Tristate Contracting Group provides a Tamko Titan XT laminated shingle system with coordinated underlayment, edge, ventilation, and finishing details. Manufacturer-specified installation and a final quality inspection support warranty coverage subject to manufacturer terms. **All required permits and debris removal / trash hauling are included in this cost, with no separate billing for these services.** The next step is coordination of scheduling and installation details.`;
const fine = ('Cancel / Rescission (Required) Owner may rescind this contract without penalty within three (3) business days of signing. Any additional/repairs outside the written scope (including code-driven items discovered) require a written change order. ').repeat(12);
const b = { materialsTotal: 10000, laborTotal: 8000, directCost: 18000, overheadAmount: 2000, totalCost: 20000, profitAmount: 6572, repCommissionAmount: 0, sellingPrice: 26572, actualProfitMargin: 25 };
createRoot(document.getElementById('root')!).render(
  <div id="pdf-root"><EstimatePDFDocument estimateNumber="EST-1" customerName="Test" customerAddress="127 West Chester Pike" companyName="Tristate Contracting Group"
    materialItems={[]} laborItems={[]} breakdown={b} config={{ overheadPercent: 10, profitMarginPercent: 25, repCommissionPercent: 0 }}
    finePrintContent={fine} options={{ useScopeNarrative: true, scopeNarrative: narrative, showCoverPage: false, showManufacturerWarranty: false, showWorkmanshipWarranty: false }} /></div>
);
