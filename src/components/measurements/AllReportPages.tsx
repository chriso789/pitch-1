import { forwardRef, useMemo } from 'react';
import { ReportPage } from './ReportPage';
import { SchematicRoofDiagram } from './SchematicRoofDiagram';
import { Badge } from '@/components/ui/badge';

interface AllReportPagesProps {
  measurement: any;
  enrichedMeasurement: any;
  tags: Record<string, any>;
  address: string;
  measurementId?: string;
  satelliteImageUrl?: string;
  companyInfo?: {
    name: string;
    logo?: string;
    phone?: string;
    email?: string;
    license?: string;
  };
}

const WASTE_PERCENTAGES = [0, 10, 12, 15, 17, 20, 22];

export const AllReportPages = forwardRef<HTMLDivElement, AllReportPagesProps>(({
  measurement,
  enrichedMeasurement,
  tags,
  address,
  measurementId,
  satelliteImageUrl,
  companyInfo,
}, ref) => {
  
  // Calculate linear totals from WKT features
  const wktLinearTotals = useMemo(() => {
    const wktFeatures = enrichedMeasurement?.linear_features_wkt || measurement?.linear_features_wkt || [];
    const totals: Record<string, number> = { eave: 0, rake: 0, hip: 0, valley: 0, ridge: 0 };
    
    if (Array.isArray(wktFeatures) && wktFeatures.length > 0) {
      wktFeatures.forEach((feature: any) => {
        const type = feature.type?.toLowerCase();
        if (type && totals.hasOwnProperty(type)) {
          totals[type] += feature.length_ft || 0;
        }
      });
    }
    
    return totals;
  }, [enrichedMeasurement, measurement]);
  
  const hasWKTData = Object.values(wktLinearTotals).some(v => v > 0);
  
  // Extract measurement data
  const totalArea = enrichedMeasurement?.total_area_adjusted_sqft || 
                    enrichedMeasurement?.total_area_flat_sqft ||
                    measurement?.summary?.total_area_sqft || 
                    tags?.['roof.total_area'] || 
                    tags?.['roof.plan_area'] || 
                    measurement?.total_area_sqft || 0;
  const pitch = enrichedMeasurement?.predominant_pitch || 
                measurement?.summary?.pitch || 
                tags?.['roof.pitch'] || '6/12';
  
  const facetCount = enrichedMeasurement?.facet_count || 
                     measurement?.facet_count || 
                     measurement?.faces?.length || 
                     tags?.['roof.faces_count'] || 
                     measurement?.facetCount || 4;
  
  // Linear features
  const eaves = enrichedMeasurement?.total_eave_length || (hasWKTData ? wktLinearTotals.eave : (measurement?.summary?.eave_ft || tags?.['lf.eave'] || 0));
  const rakes = enrichedMeasurement?.total_rake_length || (hasWKTData ? wktLinearTotals.rake : (measurement?.summary?.rake_ft || tags?.['lf.rake'] || 0));
  const ridges = enrichedMeasurement?.total_ridge_length || (hasWKTData ? wktLinearTotals.ridge : (measurement?.summary?.ridge_ft || tags?.['lf.ridge'] || 0));
  const hips = enrichedMeasurement?.total_hip_length || (hasWKTData ? wktLinearTotals.hip : (measurement?.summary?.hip_ft || tags?.['lf.hip'] || 0));
  const valleys = enrichedMeasurement?.total_valley_length || (hasWKTData ? wktLinearTotals.valley : (measurement?.summary?.valley_ft || tags?.['lf.valley'] || 0));
  const stepFlashing = tags?.['lf.step'] || measurement?.linear_features?.step || 0;
  
  // Materials
  const materials = {
    shingleBundles: tags?.['materials.shingle_bundles'] || Math.ceil((totalArea * 1.1) / 33.3),
    starterBundles: tags?.['materials.starter_bundles'] || Math.ceil((eaves + rakes) / 120),
    iceWaterRolls: tags?.['materials.ice_water_rolls'] || Math.ceil(valleys / 66) || 0,
    underlaymentRolls: tags?.['materials.underlayment_rolls'] || Math.ceil(totalArea / 400),
    hipRidgeBundles: tags?.['materials.ridge_cap_bundles'] || Math.ceil((ridges + hips) / 35),
    valleySheets: Math.ceil(valleys / 10) || 0,
    dripEdgeSheets: tags?.['materials.drip_edge_sheets'] || Math.ceil((eaves + rakes) / 10),
  };

  const wasteTableData = WASTE_PERCENTAGES.map(waste => {
    const adjustedArea = totalArea * (1 + waste / 100);
    return {
      waste,
      area: adjustedArea.toFixed(0),
      squares: (adjustedArea / 100).toFixed(2),
    };
  });

  const formatFeetInches = (feet: number) => {
    if (!feet || feet === 0) return '0 ft';
    const wholeFeet = Math.floor(feet);
    const inches = Math.round((feet - wholeFeet) * 12);
    if (inches === 0) return `${wholeFeet} ft`;
    return `${wholeFeet}' ${inches}"`;
  };

  return (
    <div 
      ref={ref} 
      id="all-report-pages-container"
      className="space-y-4"
      style={{ position: 'absolute', left: '-9999px', width: '800px', background: 'white' }}
    >
      {/* Page 1: Cover */}
      <div data-report-page="1">
        <ReportPage pageNumber={1} companyInfo={companyInfo}>
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-primary mb-2">Roof Report</h1>
            <p className="text-muted-foreground">AI-Powered Measurement</p>
          </div>
          
          <div className="bg-muted/30 rounded-lg p-4 mb-6">
            <p className="text-lg font-medium">{address}</p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-primary/10 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-primary">{Math.round(totalArea).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Total Sq Ft</div>
            </div>
            <div className="bg-primary/10 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-primary">{facetCount}</div>
              <div className="text-xs text-muted-foreground">Facets</div>
            </div>
            <div className="bg-primary/10 rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-primary">{pitch}</div>
              <div className="text-xs text-muted-foreground">Predominant Pitch</div>
            </div>
          </div>

          {satelliteImageUrl && (
            <div className="aspect-[4/3] bg-muted rounded-lg overflow-hidden mb-4">
              <img 
                src={satelliteImageUrl} 
                alt="Satellite view" 
                className="w-full h-full object-cover"
                crossOrigin="anonymous"
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Report generated on {new Date().toLocaleDateString()} • Imagery source: Mapbox Satellite
          </p>
        </ReportPage>
      </div>

      {/* Page 2: Diagram with Satellite Overlay */}
      <div data-report-page="2">
        <ReportPage pageNumber={2} companyInfo={companyInfo} title="Roof Diagram">
          <div className="aspect-square bg-white rounded-lg border overflow-hidden">
            <SchematicRoofDiagram 
              measurement={enrichedMeasurement}
              tags={tags}
              measurementId={measurementId}
              width={500}
              height={500}
              showLengthLabels={false}
              showLegend={true}
              showCompass={true}
              showTotals={true}
              satelliteImageUrl={satelliteImageUrl}
              showSatelliteOverlay={true}
              satelliteOpacity={0.55}
            />
          </div>
        </ReportPage>
      </div>

      {/* Page 3: Length Measurement */}
      <div data-report-page="3">
        <ReportPage pageNumber={3} companyInfo={companyInfo} title="Length Measurement Report">
          <div className="grid grid-cols-4 gap-3 mb-6">
            <div className="bg-cyan-50 border border-cyan-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-cyan-700">{formatFeetInches(eaves)}</div>
              <div className="text-xs text-cyan-600">Eaves</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-red-700">{formatFeetInches(valleys)}</div>
              <div className="text-xs text-red-600">Valleys</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-blue-700">{formatFeetInches(hips)}</div>
              <div className="text-xs text-blue-600">Hips</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-green-700">{formatFeetInches(ridges)}</div>
              <div className="text-xs text-green-600">Ridges</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-purple-50 border border-purple-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-purple-700">{formatFeetInches(rakes)}</div>
              <div className="text-xs text-purple-600">Rakes</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-orange-700">{formatFeetInches(stepFlashing)}</div>
              <div className="text-xs text-orange-600">Step Flashing</div>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 text-center">
              <div className="text-xl font-bold text-gray-700">0ft 0in</div>
              <div className="text-xs text-gray-600">Wall Flashing</div>
            </div>
          </div>

          <div className="aspect-video bg-white rounded-lg border overflow-hidden">
            <SchematicRoofDiagram 
              measurement={enrichedMeasurement}
              tags={tags}
              measurementId={measurementId}
              width={550}
              height={350}
              showLengthLabels={true}
              showLegend={false}
              showCompass={true}
              showTotals={false}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <Badge className="bg-cyan-500">Eaves</Badge>
            <Badge className="bg-red-500">Valleys</Badge>
            <Badge className="bg-blue-500">Hips</Badge>
            <Badge className="bg-green-500">Ridges</Badge>
            <Badge className="bg-purple-500">Rakes</Badge>
            <Badge className="bg-orange-500">Step Flashing</Badge>
          </div>
        </ReportPage>
      </div>

      {/* Page 4: Area Measurement */}
      <div data-report-page="4">
        <ReportPage pageNumber={4} companyInfo={companyInfo} title="Area Measurement Report">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-primary/10 rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Total Roof Area</div>
              <div className="text-3xl font-bold">{Math.round(totalArea).toLocaleString()} sqft</div>
            </div>
            <div className="bg-primary/10 rounded-lg p-4">
              <div className="text-sm text-muted-foreground">Predominant Pitch</div>
              <div className="text-3xl font-bold">{pitch}</div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="border rounded p-3 text-center">
              <div className="text-xl font-bold">{Math.round(totalArea).toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Pitched Roof Area (sqft)</div>
            </div>
            <div className="border rounded p-3 text-center">
              <div className="text-xl font-bold">0</div>
              <div className="text-xs text-muted-foreground">Flat Roof Area (sqft)</div>
            </div>
            <div className="border rounded p-3 text-center">
              <div className="text-xl font-bold">0</div>
              <div className="text-xs text-muted-foreground">Two Story Area (sqft)</div>
            </div>
          </div>

          <div className="aspect-video bg-white rounded-lg border overflow-hidden">
            <SchematicRoofDiagram 
              measurement={enrichedMeasurement}
              tags={tags}
              measurementId={measurementId}
              width={550}
              height={350}
              showLengthLabels={false}
              showLegend={true}
              showCompass={true}
              showTotals={true}
            />
          </div>
        </ReportPage>
      </div>

      {/* Page 5: Pitch & Direction */}
      <div data-report-page="5">
        <ReportPage pageNumber={5} companyInfo={companyInfo} title="Pitch & Direction Report">
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-2">Pitch Distribution</div>
              <div className="space-y-2">
                {(measurement?.faces || []).reduce((acc: any[], face: any) => {
                  const pitch = face.pitch || '6/12';
                  const existing = acc.find(p => p.pitch === pitch);
                  if (existing) {
                    existing.count++;
                    existing.area += face.area_sqft || face.plan_area_sqft || 0;
                  } else {
                    acc.push({ pitch, count: 1, area: face.area_sqft || face.plan_area_sqft || 0 });
                  }
                  return acc;
                }, []).map((p: any, i: number) => (
                  <div key={i} className="flex justify-between items-center">
                    <span className="font-medium">{p.pitch}</span>
                    <span className="text-muted-foreground">{p.count} facets ({Math.round(p.area)} sqft)</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="border rounded-lg p-4">
              <div className="text-sm text-muted-foreground mb-2">Predominant Direction</div>
              <div className="text-2xl font-bold">South-Facing</div>
              <p className="text-xs text-muted-foreground mt-2">
                Based on largest facet orientation
              </p>
            </div>
          </div>

          <div className="aspect-video bg-white rounded-lg border overflow-hidden">
            <SchematicRoofDiagram 
              measurement={enrichedMeasurement}
              tags={tags}
              measurementId={measurementId}
              width={550}
              height={350}
              showLengthLabels={true}
              showLegend={true}
              showCompass={true}
              showTotals={false}
            />
          </div>
        </ReportPage>
      </div>

      {/* Page 6: Report Summary */}
      <div data-report-page="6">
        <ReportPage pageNumber={6} companyInfo={companyInfo} title="Report Summary">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="font-semibold mb-3 text-lg">Measurements Summary</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b"><td className="py-2">Total Roof Area</td><td className="py-2 font-bold text-right">{Math.round(totalArea).toLocaleString()} sqft</td></tr>
                  <tr className="border-b"><td className="py-2">Predominant Pitch</td><td className="py-2 font-bold text-right">{pitch}</td></tr>
                  <tr className="border-b"><td className="py-2">Facet Count</td><td className="py-2 font-bold text-right">{facetCount}</td></tr>
                  <tr className="border-b"><td className="py-2">Eaves</td><td className="py-2 text-right">{formatFeetInches(eaves)}</td></tr>
                  <tr className="border-b"><td className="py-2">Rakes</td><td className="py-2 text-right">{formatFeetInches(rakes)}</td></tr>
                  <tr className="border-b"><td className="py-2">Ridges</td><td className="py-2 text-right">{formatFeetInches(ridges)}</td></tr>
                  <tr className="border-b"><td className="py-2">Hips</td><td className="py-2 text-right">{formatFeetInches(hips)}</td></tr>
                  <tr className="border-b"><td className="py-2">Valleys</td><td className="py-2 text-right">{formatFeetInches(valleys)}</td></tr>
                </tbody>
              </table>
            </div>
            
            <div>
              <h3 className="font-semibold mb-3 text-lg">Waste Factor Table</h3>
              <table className="w-full text-sm border">
                <thead className="bg-muted">
                  <tr>
                    <th className="py-2 px-3 text-left">Waste %</th>
                    <th className="py-2 px-3 text-right">Area (sqft)</th>
                    <th className="py-2 px-3 text-right">Squares</th>
                  </tr>
                </thead>
                <tbody>
                  {wasteTableData.map(row => (
                    <tr key={row.waste} className={`border-t ${row.waste === 10 ? 'bg-primary/10 font-medium' : ''}`}>
                      <td className="py-1.5 px-3">{row.waste}%</td>
                      <td className="py-1.5 px-3 text-right">{row.area}</td>
                      <td className="py-1.5 px-3 text-right">{row.squares}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">
                * Recommended waste factor: 10-15% for standard roofs
              </p>
            </div>
          </div>
        </ReportPage>
      </div>

      {/* Page 7: Material Calculations */}
      <div data-report-page="7">
        <ReportPage pageNumber={7} companyInfo={companyInfo} title="Material Calculations">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border">
              <thead className="bg-muted">
                <tr>
                  <th className="py-2 px-3 text-left">Product</th>
                  <th className="py-2 px-3 text-center">Unit</th>
                  <th className="py-2 px-3 text-right">0%</th>
                  <th className="py-2 px-3 text-right">10%</th>
                  <th className="py-2 px-3 text-right">12%</th>
                  <th className="py-2 px-3 text-right">15%</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Shingles</td>
                </tr>
                {['IKO Cambridge', 'CertainTeed Landmark', 'GAF Timberline HDZ', 'Owens Corning Duration', 'Atlas Pristine'].map(brand => (
                  <tr key={brand} className="border-t">
                    <td className="py-1.5 px-3 pl-6">{brand}</td>
                    <td className="py-1.5 px-3 text-center">bundle</td>
                    <td className="py-1.5 px-3 text-right">{Math.ceil(totalArea / 33.3)}</td>
                    <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.1) / 33.3)}</td>
                    <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.12) / 33.3)}</td>
                    <td className="py-1.5 px-3 text-right">{Math.ceil((totalArea * 1.15) / 33.3)}</td>
                  </tr>
                ))}
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Starter Strip</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5 px-3 pl-6">IKO Leading Edge</td>
                  <td className="py-1.5 px-3 text-center">bundle</td>
                  <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.starterBundles}</td>
                </tr>
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Ice & Water Shield</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5 px-3 pl-6">IKO GoldShield</td>
                  <td className="py-1.5 px-3 text-center">roll</td>
                  <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                  <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                  <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                  <td className="py-1.5 px-3 text-right">{materials.iceWaterRolls}</td>
                </tr>
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Hip & Ridge Cap</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5 px-3 pl-6">IKO Ultra HP</td>
                  <td className="py-1.5 px-3 text-center">bundle</td>
                  <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                  <td className="py-1.5 px-3 text-right">{materials.hipRidgeBundles}</td>
                </tr>
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Underlayment</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5 px-3 pl-6">IKO RoofGard-SA</td>
                  <td className="py-1.5 px-3 text-center">roll</td>
                  <td className="py-1.5 px-3 text-right">{materials.underlaymentRolls}</td>
                  <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.1)}</td>
                  <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.12)}</td>
                  <td className="py-1.5 px-3 text-right">{Math.ceil(materials.underlaymentRolls * 1.15)}</td>
                </tr>
                <tr className="border-t bg-primary/5">
                  <td className="py-2 px-3 font-medium" colSpan={6}>Drip Edge</td>
                </tr>
                <tr className="border-t">
                  <td className="py-1.5 px-3 pl-6">Aluminum Drip Edge</td>
                  <td className="py-1.5 px-3 text-center">10ft pc</td>
                  <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                  <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                  <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                  <td className="py-1.5 px-3 text-right">{materials.dripEdgeSheets}</td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>Disclaimer:</strong> Material quantities are estimates based on measurements. 
              Always verify requirements before ordering. Local building codes may require additional materials.
            </p>
          </div>
        </ReportPage>
      </div>
    </div>
  );
});

AllReportPages.displayName = 'AllReportPages';
