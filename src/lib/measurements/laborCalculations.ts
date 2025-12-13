/**
 * Labor calculation engine for roofing projects
 * Rates are per unit (LF, SQ, each) based on industry standards
 */

export interface LaborRate {
  task: string;
  rate: number;
  unit: 'LF' | 'SQ' | 'each' | 'hour';
  description: string;
  category: 'tear-off' | 'installation' | 'flashing' | 'cleanup';
}

export const LABOR_RATES: LaborRate[] = [
  // Tear-off
  { task: 'tear_off_single_layer', rate: 45, unit: 'SQ', description: 'Single layer tear-off', category: 'tear-off' },
  { task: 'tear_off_double_layer', rate: 65, unit: 'SQ', description: 'Double layer tear-off', category: 'tear-off' },
  { task: 'tear_off_wood_shake', rate: 85, unit: 'SQ', description: 'Wood shake tear-off', category: 'tear-off' },
  
  // Installation
  { task: 'shingle_install', rate: 85, unit: 'SQ', description: 'Architectural shingle installation', category: 'installation' },
  { task: 'three_tab_install', rate: 65, unit: 'SQ', description: '3-tab shingle installation', category: 'installation' },
  { task: 'starter_strip', rate: 1.5, unit: 'LF', description: 'Starter strip installation', category: 'installation' },
  { task: 'ridge_cap', rate: 3.0, unit: 'LF', description: 'Ridge cap installation', category: 'installation' },
  { task: 'hip_cap', rate: 3.5, unit: 'LF', description: 'Hip cap installation', category: 'installation' },
  { task: 'drip_edge', rate: 1.5, unit: 'LF', description: 'Drip edge installation', category: 'installation' },
  { task: 'ice_water_shield', rate: 1.25, unit: 'LF', description: 'Ice & water shield installation', category: 'installation' },
  { task: 'underlayment', rate: 25, unit: 'SQ', description: 'Synthetic underlayment', category: 'installation' },
  
  // Flashing
  { task: 'valley_install', rate: 2.5, unit: 'LF', description: 'Valley flashing installation', category: 'flashing' },
  { task: 'step_flashing', rate: 4.0, unit: 'LF', description: 'Step flashing installation', category: 'flashing' },
  { task: 'pipe_boot', rate: 35, unit: 'each', description: 'Pipe boot flashing', category: 'flashing' },
  { task: 'chimney_flashing', rate: 350, unit: 'each', description: 'Chimney flashing complete', category: 'flashing' },
  { task: 'skylight_flashing', rate: 250, unit: 'each', description: 'Skylight re-flash', category: 'flashing' },
  { task: 'wall_flashing', rate: 5, unit: 'LF', description: 'Wall/headwall flashing', category: 'flashing' },
  
  // Cleanup
  { task: 'debris_removal', rate: 15, unit: 'SQ', description: 'Debris removal & cleanup', category: 'cleanup' },
  { task: 'magnet_sweep', rate: 8, unit: 'SQ', description: 'Magnetic nail sweep', category: 'cleanup' },
];

export interface LaborInput {
  totalSquares: number;
  ridgeLf: number;
  hipLf: number;
  valleyLf: number;
  eaveLf: number;
  rakeLf: number;
  stepFlashingLf: number;
  penetrationCount: number;
  tearOffLayers?: number;
  isWoodShake?: boolean;
}

export interface LaborLineItem {
  task: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  total: number;
  category: string;
}

export function calculateLaborCosts(input: LaborInput): LaborLineItem[] {
  const items: LaborLineItem[] = [];

  // Tear-off
  if (input.totalSquares > 0) {
    let tearOffRate: LaborRate;
    if (input.isWoodShake) {
      tearOffRate = LABOR_RATES.find(r => r.task === 'tear_off_wood_shake')!;
    } else if (input.tearOffLayers === 2) {
      tearOffRate = LABOR_RATES.find(r => r.task === 'tear_off_double_layer')!;
    } else {
      tearOffRate = LABOR_RATES.find(r => r.task === 'tear_off_single_layer')!;
    }

    items.push({
      task: tearOffRate.task,
      description: tearOffRate.description,
      quantity: input.totalSquares,
      unit: 'SQ',
      rate: tearOffRate.rate,
      total: input.totalSquares * tearOffRate.rate,
      category: tearOffRate.category,
    });
  }

  // Shingle installation
  if (input.totalSquares > 0) {
    const installRate = LABOR_RATES.find(r => r.task === 'shingle_install')!;
    items.push({
      task: installRate.task,
      description: installRate.description,
      quantity: input.totalSquares,
      unit: 'SQ',
      rate: installRate.rate,
      total: input.totalSquares * installRate.rate,
      category: installRate.category,
    });

    // Underlayment
    const underlaymentRate = LABOR_RATES.find(r => r.task === 'underlayment')!;
    items.push({
      task: underlaymentRate.task,
      description: underlaymentRate.description,
      quantity: input.totalSquares,
      unit: 'SQ',
      rate: underlaymentRate.rate,
      total: input.totalSquares * underlaymentRate.rate,
      category: underlaymentRate.category,
    });
  }

  // Starter strip (eaves + rakes)
  const starterLength = input.eaveLf + input.rakeLf;
  if (starterLength > 0) {
    const starterRate = LABOR_RATES.find(r => r.task === 'starter_strip')!;
    items.push({
      task: starterRate.task,
      description: starterRate.description,
      quantity: Math.round(starterLength),
      unit: 'LF',
      rate: starterRate.rate,
      total: starterLength * starterRate.rate,
      category: starterRate.category,
    });
  }

  // Ridge cap
  if (input.ridgeLf > 0) {
    const ridgeRate = LABOR_RATES.find(r => r.task === 'ridge_cap')!;
    items.push({
      task: ridgeRate.task,
      description: ridgeRate.description,
      quantity: Math.round(input.ridgeLf),
      unit: 'LF',
      rate: ridgeRate.rate,
      total: input.ridgeLf * ridgeRate.rate,
      category: ridgeRate.category,
    });
  }

  // Hip cap
  if (input.hipLf > 0) {
    const hipRate = LABOR_RATES.find(r => r.task === 'hip_cap')!;
    items.push({
      task: hipRate.task,
      description: hipRate.description,
      quantity: Math.round(input.hipLf),
      unit: 'LF',
      rate: hipRate.rate,
      total: input.hipLf * hipRate.rate,
      category: hipRate.category,
    });
  }

  // Drip edge
  const dripEdgeLength = input.eaveLf + input.rakeLf;
  if (dripEdgeLength > 0) {
    const dripRate = LABOR_RATES.find(r => r.task === 'drip_edge')!;
    items.push({
      task: dripRate.task,
      description: dripRate.description,
      quantity: Math.round(dripEdgeLength),
      unit: 'LF',
      rate: dripRate.rate,
      total: dripEdgeLength * dripRate.rate,
      category: dripRate.category,
    });
  }

  // Valley
  if (input.valleyLf > 0) {
    const valleyRate = LABOR_RATES.find(r => r.task === 'valley_install')!;
    items.push({
      task: valleyRate.task,
      description: valleyRate.description,
      quantity: Math.round(input.valleyLf),
      unit: 'LF',
      rate: valleyRate.rate,
      total: input.valleyLf * valleyRate.rate,
      category: valleyRate.category,
    });

    // Ice & water shield in valleys
    const iceWaterRate = LABOR_RATES.find(r => r.task === 'ice_water_shield')!;
    items.push({
      task: iceWaterRate.task,
      description: `${iceWaterRate.description} (valleys)`,
      quantity: Math.round(input.valleyLf),
      unit: 'LF',
      rate: iceWaterRate.rate,
      total: input.valleyLf * iceWaterRate.rate,
      category: iceWaterRate.category,
    });
  }

  // Step flashing
  if (input.stepFlashingLf > 0) {
    const stepRate = LABOR_RATES.find(r => r.task === 'step_flashing')!;
    items.push({
      task: stepRate.task,
      description: stepRate.description,
      quantity: Math.round(input.stepFlashingLf),
      unit: 'LF',
      rate: stepRate.rate,
      total: input.stepFlashingLf * stepRate.rate,
      category: stepRate.category,
    });
  }

  // Penetrations (pipe boots)
  if (input.penetrationCount > 0) {
    const pipeRate = LABOR_RATES.find(r => r.task === 'pipe_boot')!;
    items.push({
      task: pipeRate.task,
      description: pipeRate.description,
      quantity: input.penetrationCount,
      unit: 'each',
      rate: pipeRate.rate,
      total: input.penetrationCount * pipeRate.rate,
      category: pipeRate.category,
    });
  }

  // Cleanup
  if (input.totalSquares > 0) {
    const debrisRate = LABOR_RATES.find(r => r.task === 'debris_removal')!;
    items.push({
      task: debrisRate.task,
      description: debrisRate.description,
      quantity: input.totalSquares,
      unit: 'SQ',
      rate: debrisRate.rate,
      total: input.totalSquares * debrisRate.rate,
      category: debrisRate.category,
    });

    const magnetRate = LABOR_RATES.find(r => r.task === 'magnet_sweep')!;
    items.push({
      task: magnetRate.task,
      description: magnetRate.description,
      quantity: input.totalSquares,
      unit: 'SQ',
      rate: magnetRate.rate,
      total: input.totalSquares * magnetRate.rate,
      category: magnetRate.category,
    });
  }

  return items;
}

export function calculateTotalLaborCost(items: LaborLineItem[]): number {
  return items.reduce((sum, item) => sum + item.total, 0);
}

export function getLaborByCategory(items: LaborLineItem[]): Record<string, number> {
  return items.reduce((acc, item) => {
    acc[item.category] = (acc[item.category] || 0) + item.total;
    return acc;
  }, {} as Record<string, number>);
}
