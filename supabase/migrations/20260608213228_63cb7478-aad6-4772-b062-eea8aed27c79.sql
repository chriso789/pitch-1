
INSERT INTO public.estimate_templates (tenant_id, name, roof_type, template_data, is_active)
VALUES (
  '71fc0c5c-e8f6-48ca-aeed-05ba8239bf06',
  'Novatik NATURE Roman - Stone Coated Steel',
  'metal',
  jsonb_build_object(
    'description', 'Novatik NATURE Roman profile stone coated metal roof (Sand). Pricing FOB Fort Myers, FL. 60-year technical warranty. Quantities include 15% cutting waste; trim/flashing pieces sized at ~3 LF each.',
    'parameters', jsonb_build_array(
      jsonb_build_object('name','roof_area','type','number','label','Roof Area (sq ft)','required',true),
      jsonb_build_object('name','ridge_lf','type','number','label','Ridge (LF)','default',0),
      jsonb_build_object('name','hip_lf','type','number','label','Hips (LF)','default',0),
      jsonb_build_object('name','valley_lf','type','number','label','Valleys (LF)','default',0),
      jsonb_build_object('name','eave_lf','type','number','label','Eaves (LF)','default',0),
      jsonb_build_object('name','rake_lf','type','number','label','Rakes (LF)','default',0),
      jsonb_build_object('name','wall_lf','type','number','label','Wall Flashing (LF)','default',0),
      jsonb_build_object('name','color','type','select','label','Color','default','Nature Sand','options', jsonb_build_array('Nature Sand'))
    ),
    'materials', jsonb_build_array(
      jsonb_build_object('item','Novatik NATURE ROMAN Sand (tile)','unit','pcs','formula','roof_area / 100 * 1.15 * 20.61','unit_cost',15.00),
      jsonb_build_object('item','Barrel Trim 3 Mod Nature Sand','unit','pcs','formula','(ridge_lf + hip_lf) / 3','unit_cost',18.50),
      jsonb_build_object('item','Barrel Trim End Nature Sand','unit','pcs','formula','ridge_lf / 10','unit_cost',9.00),
      jsonb_build_object('item','Ridge Flashing (for ROMAN) Nature Sand','unit','pcs','formula','ridge_lf / 3','unit_cost',18.50),
      jsonb_build_object('item','Valley (painted) RAL 8004 Brick','unit','pcs','formula','valley_lf / 3','unit_cost',24.50),
      jsonb_build_object('item','Eaves Flashing (for ROMAN) Nature Sand','unit','pcs','formula','eave_lf / 3','unit_cost',18.50),
      jsonb_build_object('item','Wall Flashing Nature Sand','unit','pcs','formula','wall_lf / 3','unit_cost',11.50),
      jsonb_build_object('item','Wall Flashing Scribed Left Nature Sand','unit','pcs','formula','wall_lf / 6','unit_cost',13.00),
      jsonb_build_object('item','Wall Flashing Scribed Right Nature Sand','unit','pcs','formula','wall_lf / 6','unit_cost',13.00),
      jsonb_build_object('item','Box Barge Scribed Left Nature Sand','unit','pcs','formula','rake_lf / 20','unit_cost',17.00),
      jsonb_build_object('item','Box Barge Scribed Right Nature Sand','unit','pcs','formula','rake_lf / 20','unit_cost',17.00),
      jsonb_build_object('item','Flat Sheet Nature Sand','unit','pcs','formula','2','unit_cost',25.50),
      jsonb_build_object('item','Repair Kit Nature Sand','unit','pcs','formula','1','unit_cost',11.50),
      jsonb_build_object('item','Fasteners: 2-inch Pancake Head Screws (box)','unit','box','formula','roof_area / 100 * 1.15 * 0.43','unit_cost',20.00),
      jsonb_build_object('item','Painted Fasteners: 10 x 2-1/2 W/W Sand (box)','unit','box','formula','roof_area / 100 * 1.15 * 0.60','unit_cost',32.00),
      jsonb_build_object('item','Synthetic Underlayment','unit','sq','formula','roof_area / 100 * 1.10','unit_cost',30.00),
      jsonb_build_object('item','Ice & Water Shield (valleys/eaves)','unit','roll','formula','(valley_lf + eave_lf) / 65','unit_cost',95.00),
      jsonb_build_object('item','Freight (FOB Fort Myers, FL)','unit','ea','formula','1','unit_cost',800.00)
    ),
    'labor', jsonb_build_array(
      jsonb_build_object('task','Tear Off & Disposal','unit','sq','formula','roof_area / 100','rate',95.00),
      jsonb_build_object('task','Stone Coated Steel Installation','unit','sq','formula','roof_area / 100','rate',375.00),
      jsonb_build_object('task','Trim & Flashing Labor','unit','lf','formula','ridge_lf + hip_lf + valley_lf + eave_lf + rake_lf + wall_lf','rate',8.50)
    ),
    'waste_factor', 0.15,
    'tax_rate', 0.07
  ),
  true
);
