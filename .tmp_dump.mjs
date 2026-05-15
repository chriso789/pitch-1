import { createClient } from '@supabase/supabase-js';
const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key);
const { data, error } = await sb.rpc('exec_sql_dummy').catch(()=>({data:null,error:null}));
// Use raw query via from? Not possible. Use REST with PostgREST RPC isn't there. Use direct SQL via fetch to admin? Skip — just call from() on tables.
const tenant='14de934e-7964-4afd-940a-620d2ace125d';
// Pull audit lines first to find suspect price_list_item_ids
let allAudit=[]; let from=0; const step=1000;
while(true){
  const { data:rows, error:e } = await sb.from('material_invoice_audit_lines')
    .select('price_list_item_id, charged_unit_price')
    .eq('company_id', tenant)
    .not('price_list_item_id','is',null)
    .not('charged_unit_price','is',null)
    .range(from, from+step-1);
  if(e){ console.error(e); process.exit(1);}
  allAudit=allAudit.concat(rows);
  if(rows.length<step) break; from+=step;
}
const byItem=new Map();
for(const r of allAudit){
  if(!byItem.has(r.price_list_item_id)) byItem.set(r.price_list_item_id,new Set());
  byItem.get(r.price_list_item_id).add(Number(r.charged_unit_price).toFixed(4));
}
const ids=[...byItem.keys()];
let items=[];
for(let i=0;i<ids.length;i+=200){
  const { data:rows } = await sb.from('supplier_price_list_items')
    .select('id, supplier_sku, manufacturer_sku, item_description, unit_of_measure, agreed_unit_price, created_at, supplier_id')
    .eq('company_id', tenant).in('id', ids.slice(i,i+200));
  items=items.concat(rows||[]);
}
const suspect=items.filter(it=>{
  const charged=byItem.get(it.id);
  return charged && charged.has(Number(it.agreed_unit_price).toFixed(4));
});
console.log('suspect items:', suspect.length);
const esc=v=>v==null?'':`"${String(v).replace(/"/g,'""')}"`;
const header=['price_list_item_id','supplier_sku','manufacturer_sku','item_description','unit_of_measure','current_agreed_price','correct_srs_price','created_at'];
const lines=[header.join(',')];
for(const it of suspect.sort((a,b)=>String(a.item_description).localeCompare(String(b.item_description)))){
  lines.push([it.id,it.supplier_sku,it.manufacturer_sku,it.item_description,it.unit_of_measure,it.agreed_unit_price,'',it.created_at].map(esc).join(','));
}
const fs=await import('fs');
fs.writeFileSync('/mnt/documents/srs_suspect_pricelist_items.csv', lines.join('\n'));
console.log('wrote /mnt/documents/srs_suspect_pricelist_items.csv');
