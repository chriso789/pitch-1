DO $$
DECLARE v_contacts int; v_pipeline int;
BEGIN
  CREATE TEMP TABLE tmp_csv(full_name text PRIMARY KEY, target_status text);
  INSERT INTO tmp_csv VALUES
    ('abrahim aldani','completed'),('alexis patterson','estimate_sent'),('andrew kinney','ready_for_approval'),
    ('barb drummond','ready_for_approval'),('chuck','lead'),('duke herzel paint','completed'),
    ('elizabeth jules','estimate_sent'),('gene kragness','completed'),('henry germann','estimate_sent'),
    ('ina friedman','completed'),('ina meredith','closed'),('irina gorovits','estimate_sent'),
    ('james & evelyn white','estimate_sent'),('jennifer barriffe','lead'),('jim deering','closed'),
    ('josh rojas','estimate_sent'),('kari hawkins','closed'),('kevin moe','closed'),
    ('kevin scafheimer','closed'),('lucy desloge','ready_for_approval'),('mark fox','closed'),
    ('marsha winterhalter','completed'),('michael kelleher','ready_for_approval'),('mike cody','completed'),
    ('mike stipp','lead'),('noya brigham','completed'),('palm aire gutter job','ready_for_approval'),
    ('pat bonaventura','completed'),('patrica stevenson','closed'),('paul batcho','lead'),
    ('priscilla wolfe','closed'),('rafael perez','estimate_sent'),('rajen desai','closed'),
    ('rodney smith','completed'),('ron gagne','closed'),('russell kulp','completed'),
    ('sainy taha','ready_for_approval'),('tinah gaymon','closed'),('william brennan','estimate_sent');

  -- Update contacts.qualification_status for matched contacts (skip missing per user)
  WITH upd AS (
    UPDATE contacts c
    SET qualification_status = t.target_status, updated_at = now()
    FROM tmp_csv t
    WHERE c.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
      AND regexp_replace(lower(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))),'\s+',' ','g') = t.full_name
    RETURNING 1
  ) SELECT count(*) INTO v_contacts FROM upd;

  -- Re-apply pipeline status for matched contacts (idempotent)
  WITH upd AS (
    UPDATE pipeline_entries pe
    SET status = t.target_status, updated_at = now()
    FROM contacts c, tmp_csv t
    WHERE pe.contact_id = c.id
      AND pe.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
      AND pe.is_deleted = false
      AND c.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
      AND regexp_replace(lower(trim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''))),'\s+',' ','g') = t.full_name
    RETURNING 1
  ) SELECT count(*) INTO v_pipeline FROM upd;

  RAISE NOTICE 'Updated % contacts.qualification_status, % pipeline_entries.status', v_contacts, v_pipeline;
  DROP TABLE tmp_csv;
END $$;