// ============================================================================
// GENERATE PROPOSAL - MAIN EDGE FUNCTION
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calculateTierPricing, PricingInput, TierPricing } from './pricing-engine.ts';
import { generateProposalHTML, generatePreviewHTML, ProposalData } from './pdf-generator.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GenerateRequest {
  action: 'generate' | 'preview' | 'finalize' | 'send' | 'track' | 'get-pricing';
  estimateId?: string;
  measurementId?: string;
  pipelineEntryId?: string;
  tenantId: string;
  
  // For generate action
  pricingInput?: PricingInput;
  customTiers?: Partial<Record<'good' | 'better' | 'best', Partial<any>>>;
  
  // For track action
  eventType?: string;
  viewerEmail?: string;
  selectedTier?: 'good' | 'better' | 'best';
  durationSeconds?: number;
  
  // For send action
  recipientEmail?: string;
  recipientName?: string;
  customMessage?: string;
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const body: GenerateRequest = await req.json();
    const { action, tenantId } = body;

    console.log(`[generate-proposal] Action: ${action}, Tenant: ${tenantId}`);

    switch (action) {
      case 'get-pricing': {
        // Calculate pricing from measurement data
        const { pricingInput, customTiers } = body;
        
        if (!pricingInput) {
          throw new Error('pricingInput is required for get-pricing action');
        }
        
        const tiers = calculateTierPricing(pricingInput, customTiers);
        
        return new Response(JSON.stringify({ 
          ok: true, 
          data: { tiers } 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'generate': {
        // Generate a new proposal from measurement data
        const { measurementId, pipelineEntryId, pricingInput, customTiers } = body;
        
        if (!pricingInput) {
          throw new Error('pricingInput is required');
        }
        
        // Calculate tier pricing
        const tiers = calculateTierPricing(pricingInput, customTiers);
        
        // Get company info
        const { data: tenant } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', tenantId)
          .single();
        
        // Get customer info from pipeline entry
        let customerInfo = { name: '', address: '', phone: '', email: '' };
        let contactId: string | null = null;
        
        if (pipelineEntryId) {
          const { data: entry } = await supabase
            .from('pipeline_entries')
            .select(`
              *,
              contacts (
                first_name,
                last_name,
                email,
                phone,
                property_address
              )
            `)
            .eq('id', pipelineEntryId)
            .single();
          
          if (entry?.contacts) {
            customerInfo = {
              name: `${entry.contacts.first_name || ''} ${entry.contacts.last_name || ''}`.trim(),
              address: entry.contacts.property_address || '',
              phone: entry.contacts.phone || '',
              email: entry.contacts.email || ''
            };
            contactId = entry.contact_id;
          }
        }
        
        // Generate estimate number
        const estimateNumber = `EST-${Date.now().toString(36).toUpperCase()}`;
        
        // Generate share token
        const shareToken = crypto.randomUUID().replace(/-/g, '').substring(0, 24);
        
        // Calculate expiry date (30 days)
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);
        
        // Create the enhanced estimate
        const { data: estimate, error: estimateError } = await supabase
          .from('enhanced_estimates')
          .insert({
            tenant_id: tenantId,
            estimate_number: estimateNumber,
            pipeline_entry_id: pipelineEntryId,
            measurement_report_id: measurementId,
            customer_name: customerInfo.name || 'Customer',
            customer_address: customerInfo.address || '',
            property_details: { phone: customerInfo.phone, email: customerInfo.email },
            roof_area_sq_ft: pricingInput.roofAreaSqFt,
            roof_pitch: pricingInput.pitch,
            complexity_level: pricingInput.complexity,
            season: getCurrentSeason(),
            material_cost: tiers[1].materialSubtotal, // Better tier as default
            material_markup_percent: 20,
            material_total: tiers[1].materialSubtotal,
            labor_hours: tiers[1].labor.reduce((sum, l) => sum + l.hours, 0),
            labor_rate_per_hour: 55,
            labor_cost: tiers[1].laborSubtotal,
            labor_markup_percent: 15,
            labor_total: tiers[1].laborSubtotal,
            overhead_percent: 8,
            overhead_amount: tiers[1].overhead,
            sales_rep_commission_percent: 0,
            sales_rep_commission_amount: 0,
            subtotal: tiers[1].subtotal,
            target_profit_percent: tiers[1].profitMargin * 100,
            target_profit_amount: tiers[1].profitAmount,
            actual_profit_amount: tiers[1].profitAmount,
            actual_profit_percent: tiers[1].profitMargin * 100,
            selling_price: tiers[1].totalPrice,
            price_per_sq_ft: tiers[1].totalPrice / pricingInput.roofAreaSqFt,
            permit_costs: 0,
            waste_factor_percent: pricingInput.wastePercent,
            contingency_percent: 0,
            line_items: tiers[1].materials.concat(tiers[1].labor as any),
            status: 'draft',
            approval_required: false,
            expires_at: expiresAt.toISOString(),
            calculation_metadata: {
              generated_by: 'proposal-generator',
              measurement_id: measurementId,
              linear_measurements: pricingInput.linearMeasurements
            },
            // Tier-specific fields
            good_tier_total: tiers[0].totalPrice,
            better_tier_total: tiers[1].totalPrice,
            best_tier_total: tiers[2].totalPrice,
            tier_line_items: {
              good: { materials: tiers[0].materials, labor: tiers[0].labor },
              better: { materials: tiers[1].materials, labor: tiers[1].labor },
              best: { materials: tiers[2].materials, labor: tiers[2].labor }
            },
            share_token: shareToken,
            warranty_tier_details: {
              good: tiers[0].warranty,
              better: tiers[1].warranty,
              best: tiers[2].warranty
            },
            financing_options: tiers[1].financing
          })
          .select()
          .single();
        
        if (estimateError) {
          console.error('[generate-proposal] Error creating estimate:', estimateError);
          throw estimateError;
        }
        
        // Insert tier items
        const tierItems = tiers.flatMap(tier => [
          ...tier.materials.map((m, i) => ({
            tenant_id: tenantId,
            estimate_id: estimate.id,
            tier: tier.tier,
            item_type: 'material',
            category: m.category,
            name: m.name,
            quantity: m.quantity,
            unit: m.unit,
            unit_cost: m.unitCost,
            markup_percent: tier.tier === 'good' ? 15 : tier.tier === 'better' ? 20 : 25,
            final_price: m.totalCost,
            sort_order: i
          })),
          ...tier.labor.map((l, i) => ({
            tenant_id: tenantId,
            estimate_id: estimate.id,
            tier: tier.tier,
            item_type: 'labor',
            category: 'Labor',
            name: l.task,
            quantity: l.hours,
            unit: 'hour',
            unit_cost: l.ratePerHour,
            markup_percent: tier.tier === 'good' ? 10 : tier.tier === 'better' ? 15 : 20,
            final_price: l.totalCost,
            sort_order: tier.materials.length + i
          }))
        ]);
        
        await supabase.from('proposal_tier_items').insert(tierItems);
        
        // Insert financing options
        const financingRecords = tiers.flatMap(tier => 
          tier.financing.map(f => ({
            tenant_id: tenantId,
            estimate_id: estimate.id,
            tier: tier.tier,
            provider: f.provider,
            term_months: f.termMonths,
            apr_percent: f.aprPercent,
            monthly_payment: f.monthlyPayment,
            total_financed: f.totalFinanced,
            down_payment: f.downPayment,
            promo_text: f.promoText,
            is_featured: f.termMonths === 12 // Feature 0% APR
          }))
        );
        
        await supabase.from('proposal_financing').insert(financingRecords);
        
        // Log tracking event
        await supabase.from('proposal_tracking').insert({
          tenant_id: tenantId,
          estimate_id: estimate.id,
          event_type: 'created'
        });
        
        console.log(`[generate-proposal] Created estimate ${estimate.id} with ${tierItems.length} line items`);
        
        return new Response(JSON.stringify({
          ok: true,
          data: {
            estimateId: estimate.id,
            estimateNumber,
            shareToken,
            tiers,
            expiresAt: expiresAt.toISOString()
          }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'preview': {
        // Generate HTML preview
        const { estimateId } = body;
        
        if (!estimateId) {
          throw new Error('estimateId is required for preview');
        }
        
        // Get estimate with all data
        const { data: estimate } = await supabase
          .from('enhanced_estimates')
          .select('*')
          .eq('id', estimateId)
          .single();
        
        if (!estimate) {
          throw new Error('Estimate not found');
        }
        
        // Get tenant info
        const { data: tenant } = await supabase
          .from('tenants')
          .select('*')
          .eq('id', estimate.tenant_id)
          .single();
        
        // Get tier items
        const { data: tierItems } = await supabase
          .from('proposal_tier_items')
          .select('*')
          .eq('estimate_id', estimateId)
          .order('tier')
          .order('sort_order');
        
        // Get financing
        const { data: financing } = await supabase
          .from('proposal_financing')
          .select('*')
          .eq('estimate_id', estimateId);
        
        // Build tiers from stored data
        const tiers: TierPricing[] = ['good', 'better', 'best'].map(tier => {
          const items = tierItems?.filter(i => i.tier === tier) || [];
          const materials = items.filter(i => i.item_type === 'material');
          const labor = items.filter(i => i.item_type === 'labor');
          const tierFinancing = financing?.filter(f => f.tier === tier) || [];
          
          const totalPrice = tier === 'good' ? estimate.good_tier_total :
                           tier === 'better' ? estimate.better_tier_total :
                           estimate.best_tier_total;
          
          return {
            tier: tier as 'good' | 'better' | 'best',
            label: tier.charAt(0).toUpperCase() + tier.slice(1),
            description: '',
            materials: materials.map(m => ({
              name: m.name,
              category: m.category || '',
              quantity: m.quantity,
              unit: m.unit || '',
              unitCost: m.unit_cost,
              totalCost: m.final_price
            })),
            labor: labor.map(l => ({
              task: l.name,
              hours: l.quantity,
              ratePerHour: l.unit_cost,
              totalCost: l.final_price
            })),
            materialSubtotal: materials.reduce((sum, m) => sum + m.final_price, 0),
            laborSubtotal: labor.reduce((sum, l) => sum + l.final_price, 0),
            overhead: estimate.overhead_amount,
            subtotal: totalPrice * 0.75,
            profitMargin: 0.25,
            profitAmount: totalPrice * 0.25,
            totalPrice,
            pricePerSquare: totalPrice / (estimate.roof_area_sq_ft / 100),
            warranty: estimate.warranty_tier_details?.[tier] || { years: 10, type: 'Standard', description: '' },
            features: [],
            financing: tierFinancing.map(f => ({
              provider: f.provider,
              termMonths: f.term_months,
              aprPercent: f.apr_percent,
              monthlyPayment: f.monthly_payment,
              totalFinanced: f.total_financed,
              downPayment: f.down_payment,
              promoText: f.promo_text
            })),
            recommended: tier === 'better'
          };
        });
        
        // Get measurements
        const linearMeasurements = estimate.calculation_metadata?.linear_measurements || {
          ridge: 0, hip: 0, valley: 0, eave: 0, rake: 0
        };
        
        const proposalData: ProposalData = {
          companyName: tenant?.name || 'Roofing Company',
          companyLogo: tenant?.logo_url,
          companyAddress: tenant?.address || '',
          companyPhone: tenant?.phone || '',
          companyEmail: tenant?.email || '',
          companyLicense: tenant?.license_number,
          customerName: estimate.customer_name,
          customerAddress: estimate.customer_address,
          customerPhone: estimate.property_details?.phone,
          customerEmail: estimate.property_details?.email,
          projectName: 'Roof Replacement',
          estimateNumber: estimate.estimate_number,
          createdAt: new Date(estimate.created_at).toLocaleDateString(),
          validUntil: estimate.expires_at ? new Date(estimate.expires_at).toLocaleDateString() : '',
          roofAreaSqFt: estimate.roof_area_sq_ft,
          roofSquares: estimate.roof_area_sq_ft / 100,
          pitch: estimate.roof_pitch,
          linearMeasurements,
          tiers,
          selectedTier: estimate.selected_tier,
          scopeOfWork: [
            'Complete tear-off of existing roofing materials',
            'Inspection and repair of roof decking as needed',
            'Installation of new underlayment',
            'Installation of ice and water shield',
            'Installation of new drip edge',
            'Installation of new shingles per selected tier',
            'Installation of ridge cap and ventilation',
            'Complete cleanup and debris removal',
            'Final inspection and walkthrough'
          ],
          exclusions: [
            'Structural repairs beyond minor decking replacement',
            'Gutter replacement or repair',
            'Interior damage repair',
            'Chimney rebuilding or major repairs'
          ],
          warranty: 'Your selected warranty begins upon project completion and covers materials and workmanship.',
          paymentTerms: 'A deposit of 10% is required to schedule the project. Balance is due upon completion.',
          termsAndConditions: 'This proposal is valid for 30 days. All work is subject to weather conditions. Any changes to the scope must be agreed upon in writing.'
        };
        
        const html = generateProposalHTML(proposalData);
        
        return new Response(JSON.stringify({
          ok: true,
          data: { html }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'track': {
        // Track proposal view/interaction
        const { estimateId, eventType, viewerEmail, selectedTier, durationSeconds } = body;
        
        if (!estimateId || !eventType) {
          throw new Error('estimateId and eventType are required');
        }
        
        // Increment view count if viewing
        if (eventType === 'viewed') {
          await supabase.rpc('increment_estimate_views', { p_estimate_id: estimateId });
        }
        
        // Update selected tier if applicable
        if (eventType === 'tier_selected' && selectedTier) {
          await supabase
            .from('enhanced_estimates')
            .update({ selected_tier: selectedTier })
            .eq('id', estimateId);
        }
        
        // Log tracking event
        await supabase.from('proposal_tracking').insert({
          tenant_id: tenantId,
          estimate_id: estimateId,
          event_type: eventType,
          viewer_email: viewerEmail,
          selected_tier: selectedTier,
          duration_seconds: durationSeconds,
          viewer_ip: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip'),
          viewer_user_agent: req.headers.get('user-agent')
        });
        
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      case 'send': {
        // Send proposal via email
        const { estimateId, recipientEmail, recipientName, customMessage } = body;
        
        if (!estimateId || !recipientEmail) {
          throw new Error('estimateId and recipientEmail are required');
        }
        
        // Get estimate
        const { data: estimate } = await supabase
          .from('enhanced_estimates')
          .select('*, tenants(*)')
          .eq('id', estimateId)
          .single();
        
        if (!estimate) {
          throw new Error('Estimate not found');
        }
        
        // Generate shareable link
        const shareUrl = `${Deno.env.get('PUBLIC_URL') || 'https://app.pitchcrm.com'}/proposal/${estimate.share_token}`;
        
        // Update estimate status
        await supabase
          .from('enhanced_estimates')
          .update({ 
            status: 'sent',
            sent_to_customer_at: new Date().toISOString()
          })
          .eq('id', estimateId);
        
        // Log tracking
        await supabase.from('proposal_tracking').insert({
          tenant_id: tenantId,
          estimate_id: estimateId,
          event_type: 'sent',
          viewer_email: recipientEmail,
          metadata: { recipient_name: recipientName, custom_message: customMessage }
        });
        
        // TODO: Integrate with email sending function
        console.log(`[generate-proposal] Would send email to ${recipientEmail} with link: ${shareUrl}`);
        
        return new Response(JSON.stringify({
          ok: true,
          data: { shareUrl, sentTo: recipientEmail }
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  } catch (error) {
    console.error('[generate-proposal] Error:', error);
    return new Response(JSON.stringify({
      ok: false,
      error: error.message
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Helper to get current season
function getCurrentSeason(): string {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'fall';
  return 'winter';
}
