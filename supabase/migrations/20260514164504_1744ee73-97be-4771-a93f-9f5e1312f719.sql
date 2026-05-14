DO $$
DECLARE
  v_tenant uuid := '14de934e-7964-4afd-940a-620d2ace125d';
  v_updated int;
  v_unmatched int;
BEGIN
  CREATE TEMP TABLE tmp_csv_status (full_name text, new_status text) ON COMMIT DROP;

  INSERT INTO tmp_csv_status (full_name, new_status) VALUES
    ('paul batcho','lead'),
    ('mike stipp','lead'),
    ('chuck','lead'),
    ('jennifer barriffe','lead'),
    ('rafael perez','estimate_sent'),
    ('james & evelyn white','estimate_sent'),
    ('william brennan','estimate_sent'),
    ('alexis patterson','estimate_sent'),
    ('irina gorovits','estimate_sent'),
    ('elizabeth jules','estimate_sent'),
    ('henry germann','estimate_sent'),
    ('josh rojas','estimate_sent'),
    ('palm aire gutter job','ready_for_approval'),
    ('barb drummond','ready_for_approval'),
    ('sainy taha','ready_for_approval'),
    ('andrew kinney','ready_for_approval'),
    ('michael kelleher','ready_for_approval'),
    ('lucy desloge','ready_for_approval'),
    ('abrahim aldani','completed'),
    ('gene kragness','completed'),
    ('duke herzel paint','completed'),
    ('mike cody','completed'),
    ('marsha winterhalter','completed'),
    ('noya brigham','completed'),
    ('rodney smith','completed'),
    ('russell kulp','completed'),
    ('pat bonaventura','completed'),
    ('ina friedman','completed'),
    ('rajen desai','closed'),
    ('kari hawkins','closed'),
    ('ina meredith','closed'),
    ('jim deering','closed'),
    ('ron gagne','closed'),
    ('priscilla wolfe','closed'),
    ('kevin scafheimer','closed'),
    ('tinah gaymon','closed'),
    ('patrica stevenson','closed'),
    ('kevin moe','closed'),
    ('mark fox','closed');

  WITH upd AS (
    UPDATE pipeline_entries pe
       SET status = t.new_status,
           updated_at = now()
      FROM contacts c, tmp_csv_status t
     WHERE pe.contact_id = c.id
       AND pe.tenant_id = v_tenant
       AND pe.is_deleted = false
       AND regexp_replace(lower(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))), '\s+', ' ', 'g') = t.full_name
    RETURNING pe.id
  )
  SELECT count(*) INTO v_updated FROM upd;

  SELECT count(*) INTO v_unmatched
    FROM tmp_csv_status t
   WHERE NOT EXISTS (
     SELECT 1 FROM pipeline_entries pe
       JOIN contacts c ON c.id = pe.contact_id
      WHERE pe.tenant_id = v_tenant
        AND pe.is_deleted = false
        AND regexp_replace(lower(trim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,''))), '\s+', ' ', 'g') = t.full_name
   );

  RAISE NOTICE 'CSV backfill: % pipeline entries updated, % CSV names unmatched', v_updated, v_unmatched;
END $$;